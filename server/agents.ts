import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Snapshot, Proposal } from "../src/shared/types";
import type { AgentCommandInput, AgentCredential, AgentRole, AgentRun } from "../src/shared/versions";
import { HttpError } from "./store";
import { DesignError } from "../src/shared/engine";
import { propose } from "./proposals";
import { agentActor, snapshotHash, versionTokenOf, type VersionService } from "./versions";

export type AnalysisTool = (snapshot: Snapshot, input: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
interface AgentOptions {
  apiKey?: string;
  analyze?: AnalysisTool;
  proposal?: typeof propose;
}
const objectSchema = { type: "object", properties: {}, additionalProperties: false };
const numericMap = { type: "object", additionalProperties: { type: "number" } };
const commandSchema = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1, maxLength: 100 },
    baseRevision: { type: "integer", minimum: 0 },
    changes: numericMap, readSet: numericMap,
    customParts: { type: "array", items: { type: "object" }, maxItems: 100 },
    summary: { type: "string", maxLength: 400 },
  },
  required: ["id", "baseRevision", "changes", "readSet"], additionalProperties: false,
};
export const AGENT_TOOLS = [
  { name: "read_design", description: "Read the current proposed design, its revision, parameters, parts and history. Changes are limited to this proposed version.", inputSchema: objectSchema, annotations: { readOnlyHint: true } },
  { name: "preview_changes", description: "Validate and preview a revision-bound measured change. Use original parameter values in readSet. Does not save geometry.", inputSchema: { type: "object", properties: { command: commandSchema }, required: ["command"], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "apply_changes", description: "Apply a validated change to the proposed version only. Reuse the same command id and payload to retry. Read again after a revision conflict.", inputSchema: { type: "object", properties: { command: commandSchema }, required: ["command"], additionalProperties: false }, annotations: { destructiveHint: false, idempotentHint: true } },
  { name: "analyze_design", description: "Run an engineering study against the current proposed design. Declare the study inputs. Unsupported physics and missing inputs remain explicit.", inputSchema: { type: "object", properties: { input: { type: "object" } }, required: ["input"], additionalProperties: false } },
  { name: "read_activity", description: "Read the shared agent activity for this proposed version.", inputSchema: objectSchema, annotations: { readOnlyHint: true } },
  { name: "undo_change", description: "Undo one change made by this agent, if no later dependent changes prevent it.", inputSchema: { type: "object", properties: { operationId: { type: "string" }, id: { type: "string" } }, required: ["operationId", "id"], additionalProperties: false }, annotations: { destructiveHint: false, idempotentHint: true } },
] as const;
const errorMessage = (error: unknown) => error instanceof HttpError || error instanceof DesignError ? error.message : "This agent operation could not be completed. Saved changes are preserved.";
// Keep numerical summaries and declared assumptions; geometry fields stay in the study artifact.
function studySummary(value: unknown, depth = 0): unknown {
  if (depth > 6) return "See the complete study artifact";
  if (Array.isArray(value)) return value.slice(0, 16).map((v) => studySummary(v, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["nodes", "vertices", "tetrahedra", "triangles", "displacements", "fields", "surface", "cells"].includes(key))
    .map(([key, v]) => [key, studySummary(v, depth + 1)]));
  return value;
}
function inputObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(422, "Provide an object of tool inputs.");
  return value as Record<string, unknown>;
}
export class AgentService {
  private running = new Map<string, Promise<void>>();
  private controllers = new Map<string, AbortController>();
  private stopping = false;
  constructor(public versions: VersionService, private options: AgentOptions = {}) {
    versions.store.db.prepare("UPDATE agent_runs SET run=json_set(run,'$.status','failed','$.error','Agent run interrupted. Start a new run to continue.','$.updatedAt',?) WHERE json_extract(run,'$.status') IN ('queued','running')")
      .run(new Date().toISOString());
  }
  private save(run: AgentRun) {
    this.versions.store.db.prepare("INSERT INTO agent_runs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET run=excluded.run")
      .run(run.id, run.versionId, JSON.stringify(run));
  }
  private stored(runId: string): AgentRun {
    const row = this.versions.store.db.prepare("SELECT run FROM agent_runs WHERE id=?").get(runId) as { run: string } | undefined;
    if (!row) throw new HttpError(404, "Agent run not found.");
    return JSON.parse(row.run);
  }
  get(versionId: string, token: string, runId: string): AgentRun {
    this.versions.authorize(versionId, token);
    const run = this.stored(runId);
    if (run.versionId !== versionId) throw new HttpError(404, "Agent run not found.");
    return run;
  }
  list(versionId: string, token: string): AgentRun[] {
    this.versions.authorize(versionId, token);
    return (this.versions.store.db.prepare("SELECT run FROM agent_runs WHERE version_id=? ORDER BY rowid DESC LIMIT 20")
      .all(versionId) as { run: string }[]).map((row) => JSON.parse(row.run));
  }
  start(versionId: string, token: string, goal: unknown): AgentRun {
    this.versions.owner(versionId, token); this.versions.requireOpen(versionId);
    if (this.stopping) throw new HttpError(503, "Agent service is stopping. Try again after restart.");
    if (typeof goal !== "string" || !goal.trim() || goal.length > 3000) throw new HttpError(422, "Describe a design goal in at most 3000 characters.");
    if (!this.options.apiKey) throw new HttpError(503, "Connect an AI provider to run the design and engineering agents. Manual changes remain available.", "AI_REQUIRED");
    const active = this.list(versionId, token).find((run) => ["queued", "running"].includes(run.status));
    if (active) return active;
    if (this.running.size >= 2) throw new HttpError(429, "Two agent runs are already active. Wait for one to finish.");
    const now = new Date().toISOString();
    const run: AgentRun = { id: randomUUID(), versionId, goal: goal.trim(), status: "queued", createdAt: now, updatedAt: now,
      completedRoles: [], questions: [], modelBacked: true };
    this.save(run);
    const controller = new AbortController(); this.controllers.set(run.id, controller);
    // Start after returning the accepted job; each stage persists before any provider await.
    const task = Promise.resolve().then(() => this.execute(run.id, token, controller.signal))
      .finally(() => { this.running.delete(run.id); this.controllers.delete(run.id); });
    this.running.set(run.id, task);
    return run;
  }
  cancel(versionId: string, token: string, runId: string): AgentRun {
    this.versions.owner(versionId, token);
    const run = this.get(versionId, token, runId);
    if (["queued", "running"].includes(run.status)) {
      this.controllers.get(runId)?.abort();
      const cancelled: AgentRun = { ...run, status: "cancelled", activeRole: undefined, updatedAt: new Date().toISOString() };
      this.save(cancelled); return cancelled;
    }
    return run;
  }
  async wait(runId: string) { await this.running.get(runId); return this.stored(runId); }
  async close() {
    this.stopping = true;
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled(this.running.values());
  }
  private async execute(runId: string, ownerToken: string, signal: AbortSignal) {
    let run = this.stored(runId);
    const credentials: { credential: AgentCredential; token: string }[] = [];
    try {
      for (const role of ["designer", "engineer"] as const) {
        if (signal.aborted) throw new HttpError(409, "Agent run cancelled.", "CANCELLED");
        const issued = this.versions.issueAgent(run.versionId, ownerToken, { role, label: role === "designer" ? "Design agent" : "Engineering agent" });
        credentials.push(issued);
        run = { ...this.stored(runId), status: "running", activeRole: role, updatedAt: new Date().toISOString() }; this.save(run);
        for (let attempt = 0; attempt < 2; attempt++) {
          if (signal.aborted) throw new HttpError(409, "Agent run cancelled.", "CANCELLED");
          const version = this.versions.requireOpen(run.versionId), snapshot = this.versions.store.get(version.proposedDesignId);
          this.versions.log(issued.credential, "read", snapshot.design.revision, role === "designer" ? "Read the latest design and requested goal" : "Read the design agent’s latest changes");
          let analysis: unknown = { status: "not_configured", explanation: "Engineering studies are not connected to this agent run. Do not claim a solved result." };
          if (role === "engineer" && this.options.analyze) {
            try {
              analysis = await this.options.analyze(snapshot, { mode: "review" }, signal);
              this.versions.log(issued.credential, "analyze", snapshot.design.revision, "Requested engineering review for the current proposed revision");
            } catch (error) {
              analysis = { status: "needs_inputs", explanation: errorMessage(error) };
              this.versions.log(issued.credential, "question", snapshot.design.revision, errorMessage(error));
            }
          }
          if (signal.aborted) throw new HttpError(409, "Agent run cancelled.", "CANCELLED");
          const roleInstruction = role === "designer"
            ? "You are the design agent. Make a small measured improvement toward the user's goal while preserving interfaces and useful existing parts. If essential measurements are missing, ask for them."
            : "You are the engineering agent reviewing the design agent's latest version. Inspect the goal, geometry and attached study result. Make only justified corrections. Never invent a solved study, verified load capacity, material value or measured improvement. If the study needs inputs, request them. If no edit is warranted, explain what was checked and ask for the next necessary engineering input.";
          const prompt = roleInstruction + " User goal: " + run.goal +
            (role === "engineer" ? " Engineering study result: " + JSON.stringify(studySummary(analysis)).slice(0, 3500) : "") +
            (attempt ? " A concurrent edit conflicted with your previous proposal. Re-read this current snapshot and reconcile without overwriting another edit blindly." : "");
          const proposal: Proposal = await (this.options.proposal || propose)(this.versions.store, snapshot,
            { prompt: prompt.slice(0, 6000), actor: agentActor(issued.credential) }, this.options.apiKey);
          if (signal.aborted) throw new HttpError(409, "Agent run cancelled.", "CANCELLED");
          if (proposal.source !== "ai") throw new HttpError(503, "A live model is required for this agent run.", "AI_REQUIRED");
          const questions = proposal.questions || [];
          if (questions.length) {
            for (const question of questions) this.versions.log(issued.credential, "question", snapshot.design.revision, question);
            run = { ...this.stored(runId), questions: [...this.stored(runId).questions, ...questions] }; this.save(run);
          }
          const hasChange = Object.keys(proposal.command.changes).length > 0 || Boolean(proposal.command.customParts);
          if (!hasChange || questions.length) break;
          try {
            this.versions.preview(run.versionId, issued.token, proposal.command);
            this.versions.apply(run.versionId, issued.token, proposal.command);
            break;
          } catch (error) {
            if (!(error instanceof HttpError && error.status === 409 && attempt === 0)) throw error;
            this.versions.log(issued.credential, "conflict", this.versions.store.get(version.proposedDesignId).design.revision,
              "Another editor changed the proposed version. Re-reading before one reconciliation attempt.");
          }
        }
        run = { ...this.stored(runId), completedRoles: [...this.stored(runId).completedRoles, role], updatedAt: new Date().toISOString() }; this.save(run);
      }
      run = { ...this.stored(runId), status: this.stored(runId).questions.length ? "needs_input" : "completed", activeRole: undefined, updatedAt: new Date().toISOString() }; this.save(run);
    } catch (error) {
      run = { ...this.stored(runId), status: signal.aborted ? "cancelled" : "failed", activeRole: undefined,
        error: signal.aborted ? undefined : errorMessage(error), updatedAt: new Date().toISOString() }; this.save(run);
    } finally {
      for (const issued of credentials) this.versions.revoke(run.versionId, ownerToken, issued.credential.id);
    }
  }
  async callTool(versionId: string, token: string, name: string, raw: unknown, signal?: AbortSignal): Promise<unknown> {
    const credential = this.versions.agent(versionId, token), input = inputObject(raw ?? {});
    const version = this.versions.requireOpen(versionId);
    switch (name) {
      case "read_design": {
        const snapshot = this.versions.store.get(version.proposedDesignId);
        this.versions.log(credential, "read", snapshot.design.revision, "Read proposed design");
        return { snapshot: { ...snapshot, role: "editor" }, snapshotHash: snapshotHash(snapshot), versionId };
      }
      case "read_activity": return this.versions.events(versionId, token);
      case "preview_changes": return this.versions.preview(versionId, token, inputObject(input.command) as unknown as AgentCommandInput);
      case "apply_changes": return this.versions.apply(versionId, token, inputObject(input.command) as unknown as AgentCommandInput);
      case "undo_change": return this.versions.undo(versionId, token, input.operationId as string, input.id as string);
      case "analyze_design": {
        if (!this.options.analyze) throw new HttpError(503, "Engineering studies are not connected to this service.", "ANALYSIS_UNAVAILABLE");
        const snapshot = this.versions.store.get(version.proposedDesignId);
        const result = await this.options.analyze(snapshot, inputObject(input.input), signal);
        this.versions.agent(versionId, token);
        this.versions.log(credential, "analyze", snapshot.design.revision, "Ran engineering study on revision " + snapshot.design.revision);
        return { revision: snapshot.design.revision, snapshotHash: snapshotHash(snapshot), result };
      }
      default: throw new HttpError(404, "Unknown agent tool.", "TOOL_NOT_FOUND");
    }
  }
}

interface McpSession { versionId: string; credentialId: string; protocol: string; initialized: boolean }
export function registerAgentRoutes(app: FastifyInstance, versions: VersionService, agents: AgentService, allowedOrigins: string[] = []) {
  const idOf = (r: FastifyRequest) => String((r.params as { id: string }).id);
  app.post("/api/proposed-versions/:id/agent-runs", async (r, reply) => reply.code(202).send(agents.start(idOf(r), versionTokenOf(r), (r.body as { goal?: unknown })?.goal)));
  app.get("/api/proposed-versions/:id/agent-runs", async (r) => agents.list(idOf(r), versionTokenOf(r)));
  app.get("/api/proposed-versions/:id/agent-runs/:runId", async (r) => agents.get(idOf(r), versionTokenOf(r), (r.params as { runId: string }).runId));
  app.post("/api/proposed-versions/:id/agent-runs/:runId/cancel", async (r) => agents.cancel(idOf(r), versionTokenOf(r), (r.params as { runId: string }).runId));
  app.get("/api/proposed-versions/:id/tools", async (r) => { versions.agent(idOf(r), versionTokenOf(r)); return AGENT_TOOLS; });
  app.post("/api/proposed-versions/:id/tools/:name", async (r, reply) => {
    const controller = new AbortController();
    const onClose = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.once("close", onClose);
    try { return await agents.callTool(idOf(r), versionTokenOf(r), (r.params as { name: string }).name, r.body, controller.signal); }
    finally { reply.raw.off("close", onClose); }
  });

  const sessions = new Map<string, McpSession>();
  const requests = new Map<string, AbortController>();
  const protocols = ["2025-11-25", "2025-06-18", "2025-03-26"];
  function secure(r: FastifyRequest) {
    const origin = r.headers.origin;
    if (origin && !allowedOrigins.includes(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      throw new HttpError(403, "This origin is not allowed to use the agent connection.", "ORIGIN_FORBIDDEN");
    return versions.agent(idOf(r), versionTokenOf(r));
  }
  function session(r: FastifyRequest, credential: AgentCredential) {
    const key = String(r.headers["mcp-session-id"] || ""), value = sessions.get(key);
    if (!value || value.versionId !== idOf(r) || value.credentialId !== credential.id) throw new HttpError(404, "Initialize an agent session first.", "MCP_SESSION_NOT_FOUND");
    const protocol = r.headers["mcp-protocol-version"];
    if (protocol && protocol !== value.protocol) throw new HttpError(400, "The MCP protocol version does not match this session.");
    return { key, value };
  }
  app.get("/api/proposed-versions/:id/mcp", async (r, reply) => { secure(r); return reply.header("Allow", "POST, DELETE").code(405).send(); });
  app.delete("/api/proposed-versions/:id/mcp", async (r, reply) => {
    const credential = secure(r), current = session(r, credential); sessions.delete(current.key); return reply.code(204).send();
  });
  app.post("/api/proposed-versions/:id/mcp", async (r, reply) => {
    const credential = secure(r), body = r.body as any;
    if (!body || Array.isArray(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string" ||
      (body.id !== undefined && typeof body.id !== "string" && typeof body.id !== "number"))
      return reply.code(400).send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request." } });
    const response = (result: unknown) => ({ jsonrpc: "2.0", id: body.id, result });
    if (body.method === "initialize") {
      if (body.id === undefined || typeof body.params?.protocolVersion !== "string")
        return reply.code(400).send({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32602, message: "Provide a supported protocol version." } });
      const protocol = protocols.includes(body.params.protocolVersion) ? body.params.protocolVersion : protocols[0];
      const key = randomUUID();
      // Revoked/closed connections must not consume the bounded live-session pool.
      for (const [sessionId, entry] of sessions) {
        const row = versions.store.db.prepare("SELECT revoked_at FROM agent_credentials WHERE id=?").get(entry.credentialId) as { revoked_at: string | null } | undefined;
        if (!row || row.revoked_at || versions.record(entry.versionId).status !== "open") sessions.delete(sessionId);
      }
      if ([...sessions.values()].filter((entry) => entry.credentialId === credential.id).length >= 8)
        throw new HttpError(429, "This agent already has eight connections. Close an existing connection first.");
      if (sessions.size >= 128) throw new HttpError(429, "Too many agent connections. Close an existing connection first.");
      sessions.set(key, { versionId: idOf(r), credentialId: credential.id, protocol, initialized: false });
      return reply.header("Mcp-Session-Id", key).send(response({ protocolVersion: protocol, capabilities: { tools: {} },
        serverInfo: { name: "hardware-studio", version: "0.1.0" }, instructions: "Work only in this proposed version. Read before editing. The owner reviews and accepts changes separately." }));
    }
    const current = session(r, credential);
    if (body.method === "notifications/initialized" && body.id === undefined) {
      current.value.initialized = true; return reply.code(202).send();
    }
    if (body.method === "notifications/cancelled" && body.id === undefined) {
      requests.get(current.key + ":" + String(body.params?.requestId))?.abort(); return reply.code(202).send();
    }
    if (body.id === undefined) return reply.code(202).send();
    if (body.method === "ping") return response({});
    if (!current.value.initialized) return reply.code(400).send({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "Finish initializing this agent session." } });
    if (body.method === "tools/list") return response({ tools: AGENT_TOOLS });
    if (body.method !== "tools/call") return { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found." } };
    if (typeof body.params?.name !== "string") return { jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "Provide a tool name." } };
    const requestKey = current.key + ":" + String(body.id), controller = new AbortController();
    if (requests.has(requestKey)) return { jsonrpc: "2.0", id: body.id, error: { code: -32600, message: "This request identifier is already active." } };
    requests.set(requestKey, controller);
    try {
      const result = await agents.callTool(idOf(r), versionTokenOf(r), body.params.name, body.params.arguments || {}, controller.signal);
      return response({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: { result }, isError: false });
    } catch (error) {
      return response({ content: [{ type: "text", text: errorMessage(error) }], isError: true,
        structuredContent: { error: errorMessage(error), code: error instanceof HttpError ? error.code : "TOOL_FAILED" } });
    } finally { requests.delete(requestKey); }
  });
  app.addHook("onClose", async () => { for (const controller of requests.values()) controller.abort(); sessions.clear(); });
}
