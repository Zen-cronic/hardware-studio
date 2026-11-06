import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, HttpError } from "./store";
import { canonicalClipSource, makeClipProject, type ClipJob, type ClipProject } from "../src/lib/clip-timeline";
import type { Snapshot } from "../src/shared/types";

interface Receipt { frames: number; width: number; height: number; fps: number; durationSeconds: number; snapshotHash: string }
interface RenderInput {
  project: ClipProject; input: string; output: string; url: string; signal: AbortSignal;
  progress: (frame: number) => void;
}
export type ClipRenderer = (input: RenderInput) => Promise<Receipt>;
interface ClipOptions {
  store: Store; dataDir: string; serverBaseUrl: string | (() => string);
  renderer?: ClipRenderer; queueLimit?: number;
}
const token = (request: FastifyRequest) => request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : "";
const workerScript = fileURLToPath(new URL("../scripts/render-clip.mjs", import.meta.url));

export const renderClip: ClipRenderer = ({ project, input, output, url, signal, progress }) => new Promise((resolveResult, reject) => {
  if (signal.aborted) { reject(new Error("Video export cancelled.")); return; }
  const environment = Object.fromEntries(["PATH", "HOME", "TMPDIR", "PLAYWRIGHT_BROWSERS_PATH", "LANG", "LC_ALL"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
  const child = spawn(process.execPath, ["--max-old-space-size=2048", workerScript, "--input", input, "--output", output, "--url", url],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), env: environment, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  let failure: Error | undefined, receipt: Receipt | undefined, closed = false, buffer = "", stderr = "", outputBytes = 0;
  let killTimer: ReturnType<typeof setTimeout> | undefined, stopping = false;
  const kill = (name: NodeJS.Signals) => {
    try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, name); else child.kill(name); } catch { /* Process already exited. */ }
  };
  const stop = (error: Error) => {
    if (closed || stopping) return;
    stopping = true; failure ||= error; kill("SIGTERM"); killTimer = setTimeout(() => { if (!closed) kill("SIGKILL"); }, 5000);
  };
  const cancelled = () => stop(new Error("Video export cancelled."));
  signal.addEventListener("abort", cancelled, { once: true });
  const timeout = setTimeout(() => stop(new Error("The video took too long to render. Try again with a simpler design.")), 12 * 60 * 1000);
  child.stdout.on("data", (chunk: Buffer) => {
    if (failure) return;
    outputBytes += chunk.length; buffer += chunk.toString();
    if (outputBytes > 256_000 || buffer.length > 32000) { stop(new Error("Video renderer output exceeded its limit.")); return; }
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (item.type === "progress") {
          if (!Number.isInteger(item.frame) || item.frame < 0 || item.frame > project.format.durationSeconds * project.format.fps || item.total !== project.format.durationSeconds * project.format.fps) throw new Error();
          progress(item.frame);
        } else if (item.type === "done") receipt = item;
        else if (item.type === "error") failure = new Error(String(item.message || "Video export failed.").slice(0, 500));
      } catch { stop(new Error("The video renderer returned invalid progress.")); return; }
    }
  });
  child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
  child.once("error", error => { failure ||= error; });
  child.once("close", code => {
    closed = true; clearTimeout(timeout); clearTimeout(killTimer); signal.removeEventListener("abort", cancelled);
    if (failure) reject(failure);
    else if (code !== 0 || !receipt) reject(new Error("Video rendering failed. Check that Chromium and FFmpeg are installed." + (stderr.includes("Executable doesn't exist") ? " The Chromium browser is missing." : "")));
    else resolveResult(receipt);
  });
});

export class ClipJobs {
  private queue: string[] = [];
  private active?: { id: string; controller: AbortController; done: Promise<void> };
  private stopping = false;
  private readonly root: string;
  constructor(private options: ClipOptions) {
    this.root = resolve(options.dataDir, "clips");
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    options.store.db.exec("CREATE TABLE IF NOT EXISTS clips(id TEXT PRIMARY KEY,design_id TEXT NOT NULL REFERENCES designs(id),job TEXT NOT NULL,project TEXT NOT NULL)");
    options.store.db.prepare("UPDATE clips SET job=json_set(job,'$.status','failed','$.error','Video export interrupted. Start a new clip.') WHERE json_extract(job,'$.status') IN ('queued','running')").run();
  }
  private save(job: ClipJob) { this.options.store.db.prepare("UPDATE clips SET job=? WHERE id=?").run(JSON.stringify(job), job.id); }
  get(id: string): ClipJob {
    const row = this.options.store.db.prepare("SELECT job FROM clips WHERE id=?").get(id) as { job: string } | undefined;
    if (!row) throw new HttpError(404, "Video export not found.");
    const job: ClipJob = JSON.parse(row.job);
    return { ...job, stale: this.options.store.get(job.designId).design.revision !== job.revision };
  }
  project(id: string): ClipProject {
    const row = this.options.store.db.prepare("SELECT project FROM clips WHERE id=?").get(id) as { project: string } | undefined;
    if (!row) throw new HttpError(404, "Video export not found.");
    return JSON.parse(row.project);
  }
  list(designId: string) {
    return (this.options.store.db.prepare("SELECT id FROM clips WHERE design_id=? ORDER BY rowid DESC LIMIT 30").all(designId) as { id: string }[]).map(row => this.get(row.id));
  }
  submit(snapshot: Snapshot, body: unknown): ClipJob {
    const request = body as { revision?: unknown };
    if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).some(key => key !== "revision") || !Number.isInteger(request.revision))
      throw new HttpError(422, "Choose a saved design revision for the video.");
    if (request.revision !== snapshot.design.revision) throw new HttpError(409, "The design changed. Review the latest revision before creating a video.");
    if (this.stopping) throw new HttpError(503, "The video renderer is restarting. Try again shortly.");
    const snapshotHash = createHash("sha256").update(canonicalClipSource(snapshot)).digest("hex");
    const existing = this.list(snapshot.design.id).find(job => job.snapshotHash === snapshotHash && ["queued", "running"].includes(job.status));
    if (existing) return existing;
    if (this.queue.length >= (this.options.queueLimit ?? 4)) throw new HttpError(429, "Several videos are waiting. Try again when an export finishes.");
    const project = makeClipProject(snapshot, snapshotHash), serialized = JSON.stringify(project);
    if (serialized.length > 2_000_000) throw new HttpError(413, "This design is too large for a product clip.");
    const job: ClipJob = { id: randomUUID(), designId: snapshot.design.id, revision: snapshot.design.revision, snapshotHash,
      status: "queued", frame: 0, totalFrames: project.format.durationSeconds * project.format.fps,
      format: project.format, createdAt: new Date().toISOString() };
    this.options.store.db.prepare("INSERT INTO clips VALUES(?,?,?,?)").run(job.id, job.designId, JSON.stringify(job), serialized);
    this.queue.push(job.id); this.process(); return this.get(job.id);
  }
  cancel(id: string) {
    const job = this.get(id);
    if (!["queued", "running"].includes(job.status)) return job;
    this.queue = this.queue.filter(queued => queued !== id);
    this.save({ ...job, status: "cancelled", finishedAt: new Date().toISOString() });
    if (this.active?.id === id) this.active.controller.abort();
    return this.get(id);
  }
  archive(id: string) {
    const job = this.get(id), path = join(this.root, job.id, "product.mp4");
    if (job.status !== "ready") throw new HttpError(409, "The video is not ready to download.");
    if (!existsSync(path)) throw new HttpError(404, "This video file is unavailable. Create a new export.");
    return path;
  }
  private process() {
    if (this.active || this.stopping) return;
    const id = this.queue.shift(); if (!id) return;
    const job = this.get(id), project = this.project(id), dir = join(this.root, id), controller = new AbortController();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const input = join(dir, "project.json"), output = join(dir, "product.mp4");
    writeFileSync(input, JSON.stringify(project), { mode: 0o600 });
    this.save({ ...job, status: "running" });
    const active = { id, controller, done: Promise.resolve() };
    this.active = active;
    active.done = Promise.resolve().then(async () => {
      try {
        const base = typeof this.options.serverBaseUrl === "function" ? this.options.serverBaseUrl() : this.options.serverBaseUrl;
        const url = new URL("/render-clip", base).href;
        const receipt = await (this.options.renderer || renderClip)({ project, input, output, url, signal: controller.signal, progress: frame => {
          const current = this.get(id);
          if (current.status === "running" && Number.isInteger(frame) && frame >= current.frame && frame <= current.totalFrames) this.save({ ...current, frame });
        } });
        if (receipt.frames !== job.totalFrames || receipt.width !== job.format.width || receipt.height !== job.format.height || receipt.fps !== job.format.fps || receipt.snapshotHash !== job.snapshotHash || receipt.durationSeconds !== job.format.durationSeconds || !existsSync(output) || statSync(output).size > 250_000_000)
          throw new Error("The encoded video does not match the requested design and timeline.");
        if (this.get(id).status === "running") this.save({ ...job, status: "ready", frame: job.totalFrames, finishedAt: new Date().toISOString(), downloadUrl: `/api/clips/${id}/download` });
      } catch (issue) {
        if (this.get(id).status === "running") this.save({ ...this.get(id), status: "failed", finishedAt: new Date().toISOString(), error: issue instanceof Error ? issue.message : "The video could not be rendered." });
      } finally { if (this.active?.id === id) this.active = undefined; this.process(); }
    });
  }
  async close() {
    this.stopping = true;
    for (const id of this.queue.splice(0)) this.save({ ...this.get(id), status: "failed", error: "Video export interrupted. Start a new clip.", finishedAt: new Date().toISOString() });
    const active = this.active;
    if (active) {
      const job = this.get(active.id);
      if (job.status === "running") this.save({ ...job, status: "failed", error: "Video export interrupted. Start a new clip.", finishedAt: new Date().toISOString() });
      active.controller.abort(); await active.done;
    }
  }
}
export function registerClipRoutes(app: FastifyInstance, options: ClipOptions) {
  const jobs = new ClipJobs(options), { store } = options;
  app.post("/api/designs/:id/clips", async (request, reply) => {
    const id = String((request.params as any).id); store.authorize(id, token(request), true);
    return reply.code(202).send(jobs.submit(store.get(id), request.body));
  });
  app.get("/api/designs/:id/clips", async request => {
    const id = String((request.params as any).id); store.authorize(id, token(request)); return jobs.list(id);
  });
  app.get("/api/clips/:jobId", async request => {
    const job = jobs.get(String((request.params as any).jobId)); store.authorize(job.designId, token(request)); return job;
  });
  app.get("/api/clips/:jobId/project", async request => {
    const job = jobs.get(String((request.params as any).jobId)); store.authorize(job.designId, token(request)); return jobs.project(job.id);
  });
  app.post("/api/clips/:jobId/cancel", async request => {
    const job = jobs.get(String((request.params as any).jobId)); if (store.authorize(job.designId, token(request)) !== "editor") throw new HttpError(403, "An editing link is required to cancel an export."); return jobs.cancel(job.id);
  });
  app.get("/api/clips/:jobId/download", async (request, reply) => {
    const job = jobs.get(String((request.params as any).jobId)); store.authorize(job.designId, token(request));
    return reply.header("Content-Type", "video/mp4").header("Content-Disposition", `attachment; filename="hardware-studio-r${job.revision}.mp4"`).send(createReadStream(jobs.archive(job.id)));
  });
  return jobs;
}
