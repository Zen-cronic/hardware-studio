import { selectedAiKey } from "./ai-provider";
import Fastify, { type FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { createCollaborationServer, NOTES_MESSAGE_LIMIT, ROOM_MESSAGE_LIMIT } from "./collaboration";
export { createCollaborationServer } from "./collaboration";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  createReadStream,
  readFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { startCadWorker } from "./cad-worker";
import { AiProviderAdmission } from "./ai-admission";
import { ResourceAdmission, type ResourceTicket } from "./resource-admission";
import { resourceConfig, aiBudgetConfig, aiProviderConfig, designAdmissionConfig, type AiBudgetPolicy, type DesignAdmissionPolicy } from "./config";
import type { WebSocket } from "ws";
import { CATALOG } from "../src/shared/catalog";
import { DesignError } from "../src/shared/engine";
import type {
  BuildJob,
  Snapshot,
  Command,
  ProductKind,
  Part,
  Presence,
} from "../src/shared/types";
import { Store, HttpError } from "./store";
import { propose } from "./proposals";
import { EngineeringJobs, registerEngineeringRoutes } from "./engineering-jobs";
import { registerVersionRoutes } from "./versions";
import { registerClipRoutes } from "./clips";
import { ImportJobs, registerImportRoutes } from "./imports";
import { registerModelRoutes } from "./model-view";
import { registerExampleRoutes } from "./examples";
const tokenOf = (r: FastifyRequest) => {
  const header = r.headers.authorization;
  return header?.startsWith("Bearer ")
    ? header.slice(7)
    : String((r.query as any)?.token || "");
};
const designId = (r: FastifyRequest) => String((r.params as any).id);
interface Options {
  dataDir?: string;
  dbPath?: string;
  serveStatic?: boolean;
  aiKey?: string;
  python?: string;
  resources?: ResourceAdmission;
  aiPolicy?: AiBudgetPolicy;
  aiProvider?: AiProviderAdmission;
  designPolicy?: DesignAdmissionPolicy;
  collabTransport?: "separate" | "shared";
}
export async function createApp(options: Options = {}) {
  const dataDir = resolve(options.dataDir || process.env.DATA_DIR || ".data");
  mkdirSync(dataDir, { recursive: true });
  const resources = options.resources || new ResourceAdmission({ dataDir, ...resourceConfig(process.env) });
  const aiProvider = options.aiProvider || new AiProviderAdmission(aiProviderConfig(process.env).concurrency);
  const store = new Store(options.dbPath || join(dataDir, "studio.sqlite"), options.aiPolicy || aiBudgetConfig(process.env), aiProvider, options.designPolicy || designAdmissionConfig(process.env));
  const app = Fastify({ logger: false, bodyLimit: 13_000_000 });
  // Send page visits on an old address to the main address, keeping the path and query.
  // Set CANONICAL_HOST (e.g. "example.com") and LEGACY_HOSTS (comma-separated) to turn it on.
  const canonicalHost = process.env.CANONICAL_HOST?.trim();
  const legacyHosts = new Set((process.env.LEGACY_HOSTS ?? "").split(",").map(h => h.trim().toLowerCase()).filter(Boolean));
  if (canonicalHost && legacyHosts.size) {
    app.addHook("onRequest", async (request, reply) => {
      const host = String(request.headers.host ?? "").split(":")[0].toLowerCase();
      if (!legacyHosts.has(host) || request.method !== "GET" || request.url.startsWith("/api/") || request.url.startsWith("/collab")) return;
      return reply.redirect(`https://${canonicalHost}${request.url}`, 301);
    });
  }
  const python =
    options.python ||
    process.env.CAD_PYTHON ||
    join(homedir(), ".pyenv/versions/.victoria-hardware/bin/python");
  const imports = new ImportJobs(store, dataDir, python, resources);
  registerImportRoutes(app, store, imports);
  const engineering = new EngineeringJobs(store, dataDir, python, resources);
  registerEngineeringRoutes(app, store, engineering);
  const clips = registerClipRoutes(app, {store, dataDir, resources, serverBaseUrl: () => {
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Video rendering needs a listening HTTP server.");
    return `http://127.0.0.1:${address.port}`;
  }});
  const rooms = new Map<
    string,
    Map<WebSocket, { presence: Presence; role: "editor" | "viewer" }>
  >();
  const jobs: { job: BuildJob; snapshot: Snapshot; ticket: ResourceTicket }[] = [];
  let activeTicket: ResourceTicket | undefined;
  const activeBuilds = new Map<string, string>();
  const buildKey = (id: string, revision: number) => `${id}:${revision}`;
  let running = false;
  let worker: ReturnType<typeof startCadWorker> | undefined;
  let activeDone: Promise<void> | undefined;
  let finishActive: (() => void) | undefined;
  let stopping = false;
  function send(ws: WebSocket, payload: unknown) {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload));
  }
  function peers(id: string) {
    const room = rooms.get(id);
    if (room)
      for (const ws of room.keys())
        send(ws, {
          type: "presence",
          peers: [...room.values()].map((v) => v.presence),
        });
  }
  function broadcast(id: string, snapshot: Snapshot) {
    const room = rooms.get(id);
    if (room)
      for (const [ws, p] of room)
        send(ws, { type: "snapshot", snapshot: { ...snapshot, role: p.role } });
  }
  const agentRuntime = registerVersionRoutes(app, {
    store, broadcast, aiKey: options.aiKey ?? selectedAiKey(), studies: id => engineering.list(id),
    latestBuild: id => store.latestBuild(id),
    analyze: async (snapshot, input, signal) => {
      const runStudy = async (request: Record<string, unknown>) => {
        const job = engineering.submit(snapshot, request);
        const cancel = () => engineering.cancel(job.id);
        if (signal?.aborted) cancel();
        signal?.addEventListener("abort", cancel, {once:true});
        try { return await engineering.wait(job.id); } finally { signal?.removeEventListener("abort",cancel); }
      };
      if ((input as any).mode !== "review") return await runStudy(input);
      const checks = [];
      for (const part of snapshot.derived.parts.filter(p => p.role !== "reference" && p.process !== "buy")) {
        if (signal?.aborted) throw new Error("Agent review cancelled.");
        const job = await runStudy({type:"manufacturing",partId:part.id,profile:part.process === "print" ? "fdm" : "cnc"});
        checks.push({component:part.name,status:job.result?.status||job.status,profile:job.result?.profile?.name,
          findings:job.result?.findings,minimumWallMm:job.result?.minimumRecognizedWallMm,error:job.error||job.result?.error});
      }
      return {status: checks.every(c=>c.status==="solved")?"reviewed":"needs_inputs",revision:snapshot.design.revision,checks,
        limits:"These are component manufacturing checks against editable example process profiles. No load capacity, assembly contacts or fabrication certification was established."};
    },
  });
  async function processQueue() {
    if (running || stopping) return;
    const work = jobs.shift();
    if (!work) return;
    running = true;
    activeDone = new Promise<void>((resolve) => { finishActive = resolve; });
    const { job, snapshot, ticket } = work;
    activeTicket = ticket;
    const jobDir = join(dataDir, "builds", job.id);
    const dir = join(jobDir, "package");
    const input = join(jobDir, "input.json");
    try {
      await ticket.wait();
      if (stopping) throw new Error("Build interrupted. Please start a new package.");
      mkdirSync(jobDir, { recursive: true });
      writeFileSync(input, JSON.stringify(snapshot, null, 2));
      store.setBuild({ ...job, status: "running" });
      if (!existsSync(python))
        throw new Error(
          "CAD environment is not installed. Follow the setup instructions and retry.",
        );
      worker = startCadWorker(
        python,
        ["-m", "cad.build", "--input", input, "--output", dir],
        { cwd: process.cwd() },
      );
      const output = await worker.result;
      let result: any;
      try {
        result = JSON.parse(output.trim().split("\n").at(-1) || "");
      } catch {
        throw new Error("CAD returned an unreadable build result.");
      }
      const archive = resolve(result.archive || "");
      if (!result.ok || !archive.startsWith(dir + "/") || !existsSync(archive))
        throw new Error("CAD did not produce a complete package.");
      store.setBuild(
        {
          ...job,
          status: "ready",
          downloadUrl: "/api/builds/" + job.id + "/download",
          archiveSha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
        },
        archive,
      );
    } catch (error) {
      store.setBuild({
        ...job,
        status: "failed",
        error:
          error instanceof Error ? error.message : "Package generation failed.",
      });
    } finally {
      ticket.release();
      activeTicket = undefined;
      activeBuilds.delete(buildKey(job.designId, job.revision));
      worker = undefined;
      running = false;
      const finished = finishActive;
      finishActive = undefined;
      activeDone = undefined;
      finished?.();
      void processQueue();
    }
  }
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      if (error.retryAfterSeconds !== undefined) reply.header("Retry-After", error.retryAfterSeconds);
      return reply.code(error.status).send({
        error: error.message,
        code: error.code,
        conflicts: error.conflicts,
        ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      });
    }
    if (error instanceof DesignError)
      return reply.code(422).send({
        error: error.message,
        code: error.code,
        conflicts: error.conflicts,
      });
    const e = error as any;
    if (e.statusCode && e.statusCode < 500)
      return reply.code(e.statusCode).send({ error: e.message });
    return reply.code(500).send({
      error:
        "The request could not be completed. Your last saved design is unchanged.",
    });
  });
  const collaboration = options.collabTransport === "shared" ? createCollaborationServer(store) : undefined;
  // Close document transports and await their final stores before SQLite closes.
  if (collaboration) app.addHook("preClose", async () => { await collaboration.destroy(); });
  await app.register(websocket, { options: { maxPayload: collaboration ? NOTES_MESSAGE_LIMIT : ROOM_MESSAGE_LIMIT } });
  if (collaboration) app.get("/collab", { websocket: true }, (socket, request) => {
    collaboration.handleConnection(socket, request.raw);
  });
  app.get("/api/health", async () => ({
    ok: true,
    ai: Boolean(options.aiKey ?? selectedAiKey()),
    cad: existsSync(python),
  }));
  app.get("/api/catalog", async () => CATALOG);
  app.post("/api/designs", async (request, reply) => {
    const b = request.body as any;
    if (
      !b ||
      ![
        "turntable",
        "slider",
        "conveyor",
        "lamp",
        "planter",
        "holder",
        "custom",
      ].includes(b.kind) ||
      (b.name !== undefined &&
        (typeof b.name !== "string" || b.name.length > 120))
    )
      throw new HttpError(422, "Choose a product or a new design.");
    return reply
      .code(201)
      .send(
        store.create(b.kind as ProductKind, b.name, b.customParts as Part[]),
      );
  });
  app.get("/api/designs/:id", async (r) => {
    const id = designId(r),
      role = store.authorize(id, tokenOf(r));
    return { ...store.get(id), role };
  });
  app.post("/api/designs/:id/commands", async (r) => {
    const id = designId(r);
    store.authorize(id, tokenOf(r), true);
    const snapshot = store.apply(id, r.body as Command);
    broadcast(id, store.get(id));
    return { ...snapshot, role: "editor" };
  });
  app.post("/api/designs/:id/undo", async (r) => {
    const id = designId(r);
    store.authorize(id, tokenOf(r), true);
    const b = r.body as any;
    if (
      !b ||
      typeof b.actor !== "string" ||
      typeof b.operationId !== "string" ||
      typeof b.id !== "string"
    )
      throw new HttpError(422, "Choose one of your previous changes.");
    const snapshot = store.undo(id, b.actor, b.operationId, b.id);
    broadcast(id, store.get(id));
    return { ...snapshot, role: "editor" };
  });
  app.post("/api/designs/:id/fork", async (r) => {
    const id = designId(r);
    store.authorize(id, tokenOf(r));
    return store.fork(id);
  });
  app.post("/api/designs/:id/propose", async (r, reply) => {
    const id = designId(r);
    store.authorize(id, tokenOf(r), true);
    const controller = new AbortController();
    const onClose = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.once("close", onClose);
    try {
      return await propose(store, store.get(id), r.body as any,
        options.aiKey ?? selectedAiKey(), controller.signal);
    } finally { reply.raw.off("close", onClose); }
  });
  app.post("/api/designs/:id/build", async (r) => {
    const id = designId(r);
    store.authorize(id, tokenOf(r), true);
    const snapshot = store.get(id);
    const key = buildKey(id, snapshot.design.revision);
    const existing = activeBuilds.get(key);
    if (existing) return store.getBuild(existing).job;
    if (jobs.length > 12)
      throw new HttpError(
        429,
        "Several packages are being prepared. Please try again shortly.",
      );
    const ticket = resources.reserve();
    const job: BuildJob = {
      id: randomUUID(),
      designId: id,
      revision: snapshot.design.revision,
      status: "queued",
    };
    try { store.setBuild(job); } catch (error) { ticket.release(); throw error; }
    activeBuilds.set(key, job.id);
    jobs.push({ job, snapshot, ticket });
    void processQueue();
    return job;
  });
  app.get("/api/designs/:id/builds/latest", async (r) => {
    const id = designId(r);
    store.authorize(id, tokenOf(r));
    return store.latestBuild(id);
  });
  registerModelRoutes(app, store);
  registerExampleRoutes(app);
  app.get("/api/builds/:jobId", async (r) => {
    const { job } = store.getBuild((r.params as any).jobId);
    store.authorize(job.designId, tokenOf(r));
    return job;
  });
  app.get("/api/builds/:jobId/download", async (r, reply) => {
    const { job, archive } = store.getBuild((r.params as any).jobId);
    store.authorize(job.designId, tokenOf(r));
    if (job.status !== "ready" || !archive)
      throw new HttpError(409, "This package is not ready yet.");
    return reply
      .header(
        "Content-Disposition",
        'attachment; filename="hardware-design-r' + job.revision + '.zip"',
      )
      .type("application/zip")
      .send(createReadStream(archive));
  });
  app.get(
    "/api/rooms/:id",
    {
      websocket: true,
      preValidation: async (r) => {
        store.authorize(designId(r), tokenOf(r));
      },
    },
    (ws, r) => {
      const id = designId(r),
        role = store.authorize(id, tokenOf(r)),
        q = r.query as any;
      const clientId = String(q.clientId || randomUUID()).slice(0, 80),
        name = String(q.name || "Guest").slice(0, 40),
        colors = ["#9A2E60", "#276C4B", "#28637C", "#7C5800"];
      if (!rooms.has(id)) rooms.set(id, new Map());
      const room = rooms.get(id)!;
      const presence: Presence = {
        clientId,
        name,
        color: colors[room.size % colors.length],
      };
      room.set(ws, { presence, role });
      send(ws, { type: "snapshot", snapshot: { ...store.get(id), role } });
      peers(id);
      ws.on("message", (raw) => {
        // The shared transport permits larger Notes frames, but rooms keep their own bound.
        const length = Array.isArray(raw) ? raw.reduce((sum, part) => sum + part.byteLength, 0) : raw.byteLength;
        if (length > ROOM_MESSAGE_LIMIT) { ws.close(1009, "Collaboration message is too large."); return; }
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type !== "presence") return;
          if (typeof msg.selection === "string")
            presence.selection = msg.selection.slice(0, 100);
          if (
            msg.camera &&
            ["position", "target"].every(
              (k) =>
                Array.isArray(msg.camera[k]) &&
                msg.camera[k].length === 3 &&
                msg.camera[k].every(
                  (n: any) => Number.isFinite(n) && Math.abs(n) < 100000,
                ),
            )
          )
            presence.camera = msg.camera;
          peers(id);
        } catch {
          send(ws, {
            type: "error",
            message: "The collaboration message could not be read.",
          });
        }
      });
      ws.on("close", () => {
        room.delete(ws);
        if (!room.size) rooms.delete(id);
        else peers(id);
      });
    },
  );
  if (options.serveStatic !== false && existsSync(resolve("dist/index.html"))) {
    await app.register(fastifyStatic, { root: resolve("dist"), prefix: "/" });
    app.setNotFoundHandler((r, reply) => {
      if (r.url.startsWith("/api/"))
        return reply.code(404).send({ error: "This API route was not found." });
      return reply.sendFile("index.html");
    });
  }
  // preClose runs before HTTP draining and any agent onClose waits.
  app.addHook("preClose", async () => {
    aiProvider.stop();
    agentRuntime.agents.stop();
  });
  app.addHook("onClose", async () => {
    stopping = true;
    resources.close();
    const otherQueues = Promise.all([agentRuntime.agents.close(), engineering.close(), clips.close(), imports.close()]);
    activeTicket?.cancel();
    worker?.cancel();
    await activeDone;
    await otherQueues;
    await aiProvider.close();
    for (const { job, ticket } of jobs.splice(0)) {
      ticket.release();
      store.setBuild({ ...job, status: "failed", error: "Build interrupted. Please start a new package." });
    }
    activeBuilds.clear();
    for (const room of rooms.values()) for (const ws of room.keys()) ws.close();
    store.close();
  });
  return { app, store, broadcast, python, collaboration };
}
