import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { Store, HttpError } from "../server/store";
import { VersionService, registerVersionRoutes } from "../server/versions";
import { AgentService } from "../server/agents";
import { readSetFor } from "../src/shared/engine";
import type { Snapshot, Proposal } from "../src/shared/types";
import type { propose } from "../server/proposals";
const stores: Store[] = [], apps: FastifyInstance[] = [], services: AgentService[] = [];
afterEach(async () => { for (const a of apps.splice(0)) await a.close(); for (const a of services.splice(0)) await a.close(); for (const s of stores.splice(0)) if (s.db.open) s.close(); });
function setup() {
  const store = new Store(":memory:"); stores.push(store);
  const owner = store.create("turntable"), versions = new VersionService(store);
  const view = versions.create(owner.snapshot.design.id, owner.access.editorToken, { actor: "Maker", expectedRevision: 0 });
  return { store, owner, versions, view };
}
function result(snapshot: Snapshot, rpm: number, actor: string): Proposal {
  return { source: "ai", explanation: "Measured adjustment", questions: [], command: { id: crypto.randomUUID(), actor,
    baseRevision: snapshot.design.revision, changes: { rpm }, readSet: { ...snapshot.design.params } } };
}
describe("cooperating agents", () => {
  it("runs two distinct model-backed roles on successive saved snapshots without accepting main", async () => {
    const { store, owner, versions, view } = setup();
    const calls: { revision: number; actor: string; rpm: number; prompt: string }[] = [];
    const proposal: typeof propose = async (_store, snapshot, body) => {
      calls.push({ revision: snapshot.design.revision, actor: body.actor, rpm: snapshot.design.params.rpm, prompt: body.prompt });
      return result(snapshot, snapshot.design.params.rpm + 1, body.actor);
    };
    const agent = new AgentService(versions, { apiKey: "test-only", proposal, analyze: async () => ({ status: "ready", type: "manufacturing", findings: [] }) }); services.push(agent);
    const run = agent.start(view.version.id, owner.access.editorToken, "Increase rotation speed by two rpm in measured steps.");
    const finished = await agent.wait(run.id);
    expect(finished.status).toBe("completed"); expect(finished.completedRoles).toEqual(["designer", "engineer"]);
    expect(calls.map((c) => c.revision)).toEqual([0, 1]); expect(calls[1].rpm).toBe(calls[0].rpm + 1);
    expect(calls[0].actor).not.toBe(calls[1].actor); expect(calls[1].prompt).toContain("manufacturing");
    expect(store.get(owner.snapshot.design.id).design.revision).toBe(0);
    expect(store.get(view.version.proposedDesignId).design.revision).toBe(2);
    expect(versions.events(view.version.id, owner.access.editorToken).filter((e) => e.action === "edit")).toHaveLength(2);
    expect(versions.credentials(view.version.id, owner.access.editorToken).every((c) => Boolean(c.revokedAt))).toBe(true);
  });
  it("re-reads after a conflicting edit, with a bounded reconciliation attempt", async () => {
    const { store, owner, versions, view } = setup(); let count = 0;
    const proposal: typeof propose = async (_store, snapshot, body) => {
      if (++count === 1) store.apply(snapshot.design.id, { id: crypto.randomUUID(), actor: "Other editor", baseRevision: snapshot.design.revision,
        changes: { rpm: 10 }, readSet: readSetFor(snapshot.design, { rpm: 10 }) });
      return result(snapshot, snapshot.design.params.rpm + 1, body.actor);
    };
    const agent = new AgentService(versions, { apiKey: "test-only", proposal }); services.push(agent);
    const finished = await agent.wait(agent.start(view.version.id, owner.access.editorToken, "Improve speed").id);
    expect(finished.status).toBe("completed"); expect(count).toBe(3);
    expect(store.get(view.version.proposedDesignId).design.params.rpm).toBe(12);
    expect(versions.events(view.version.id, owner.access.editorToken).some((e) => e.action === "conflict")).toBe(true);
  });
  it("cancels without applying a provider reply that arrives later", async () => {
    const { store, owner, versions, view } = setup();
    let resolve!: (p: Proposal) => void, called!: () => void, captured!: Snapshot, actor = "";
    const started = new Promise<void>((r) => { called = r; });
    const proposal: typeof propose = async (_store, snapshot, body) => { captured = snapshot; actor = body.actor; called(); return new Promise<Proposal>((r) => { resolve = r; }); };
    const agent = new AgentService(versions, { apiKey: "test-only", proposal }); services.push(agent);
    const run = agent.start(view.version.id, owner.access.editorToken, "Make a measured change"); await started;
    agent.cancel(view.version.id, owner.access.editorToken, run.id); resolve(result(captured, 10, actor));
    expect((await agent.wait(run.id)).status).toBe("cancelled");
    expect(store.get(view.version.proposedDesignId).design.revision).toBe(0);
    expect(versions.credentials(view.version.id, owner.access.editorToken).every((c) => Boolean(c.revokedAt))).toBe(true);
  });
  it("requires a provider and main-editor authorization for built-in runs", () => {
    const { owner, versions, view } = setup(); const agent = new AgentService(versions); services.push(agent);
    expect(() => agent.start(view.version.id, owner.access.editorToken, "Improve")).toThrow(/Connect an AI/);
    expect(() => agent.start(view.version.id, owner.access.viewerToken, "Improve")).toThrow(/viewing/);
    const external = versions.issueAgent(view.version.id, owner.access.editorToken, { role: "external", label: "External" });
    expect(() => agent.start(view.version.id, external.token, "Improve")).toThrow();
  });
  it("holds geometry changes when the model asks for essential measurements", async () => {
    const { store, owner, versions, view } = setup();
    const proposal: typeof propose = async (_store, snapshot, body) => ({ ...result(snapshot, 10, body.actor), questions: ["What is the target speed?"] });
    const agent = new AgentService(versions, { apiKey: "test-only", proposal }); services.push(agent);
    const finished = await agent.wait(agent.start(view.version.id, owner.access.editorToken, "Make it better").id);
    expect(finished.status).toBe("needs_input"); expect(finished.questions).toHaveLength(2);
    expect(store.get(view.version.proposedDesignId).design.revision).toBe(0);
  });
});
describe("scoped MCP transport", () => {
  async function transport() {
    const store = new Store(":memory:"); stores.push(store); const app = Fastify(); apps.push(app);
    app.setErrorHandler((error, _r, reply) => reply.code(error instanceof HttpError ? error.status : 500).send({ error: error instanceof Error ? error.message : "Request failed" }));
    const { versions } = registerVersionRoutes(app, { store });
    const owner = store.create("turntable"), view = versions.create(owner.snapshot.design.id, owner.access.editorToken, { actor: "Maker", expectedRevision: 0 });
    const issued = versions.issueAgent(view.version.id, owner.access.editorToken, { role: "external", label: "CAD helper" });
    const url = issued.mcpUrl, baseHeaders = { authorization: "Bearer " + issued.token, accept: "application/json, text/event-stream" };
    const init = await app.inject({ method: "POST", url, headers: baseHeaders, payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } } });
    expect(init.statusCode).toBe(200);
    const headers = { ...baseHeaders, "mcp-session-id": String(init.headers["mcp-session-id"]), "mcp-protocol-version": "2025-11-25" };
    const ready = await app.inject({ method: "POST", url, headers, payload: { jsonrpc: "2.0", method: "notifications/initialized" } });
    expect(ready.statusCode).toBe(202);
    return { app, versions, store, owner, view, issued, url, headers };
  }
  it("negotiates, lists tools, reads and edits only the proposed workspace", async () => {
    const { app, store, owner, view, url, headers } = await transport();
    const list = await app.inject({ method: "POST", url, headers, payload: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    expect(list.json().result.tools.map((t: { name: string }) => t.name)).toContain("preview_changes");
    expect(list.json().result.tools.some((t: { name: string }) => /accept|delete|execute_code/.test(t.name))).toBe(false);
    const read = await app.inject({ method: "POST", url, headers, payload: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "read_design", arguments: {} } } });
    const snapshot = read.json().result.structuredContent.result.snapshot;
    expect(snapshot.design.id).toBe(view.version.proposedDesignId);
    const command = { id: crypto.randomUUID(), baseRevision: 0, changes: { rpm: 9 }, readSet: { rpm: snapshot.design.params.rpm } };
    const edit = await app.inject({ method: "POST", url, headers, payload: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "apply_changes", arguments: { command } } } });
    expect(edit.json().result.isError).toBe(false);
    expect(store.get(view.version.proposedDesignId).design.params.rpm).toBe(9); expect(store.get(owner.snapshot.design.id).design.revision).toBe(0);
    expect((await app.inject({ method: "GET", url, headers })).statusCode).toBe(405);
  });
  it("rejects hostile origins, missing capabilities and cross-credential sessions", async () => {
    const { app, versions, owner, view, url, headers } = await transport();
    const payload = { jsonrpc: "2.0", id: 2, method: "tools/list" };
    expect((await app.inject({ method: "POST", url, headers: { ...headers, origin: "https://untrusted.example" }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, headers: { ...headers, authorization: "" }, payload })).statusCode).toBe(403);
    const other = versions.issueAgent(view.version.id, owner.access.editorToken, { role: "external", label: "Other agent" });
    expect((await app.inject({ method: "POST", url, headers: { ...headers, authorization: "Bearer " + other.token }, payload })).statusCode).toBe(404);
  });
  it("returns tool errors as results and rejects a revoked connection", async () => {
    const { app, versions, owner, view, issued, url, headers } = await transport();
    const reply = await app.inject({ method: "POST", url, headers, payload: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "analyze_design", arguments: { input: {} } } } });
    expect(reply.json().result.isError).toBe(true); expect(reply.json().result.structuredContent.code).toBe("ANALYSIS_UNAVAILABLE");
    versions.revoke(view.version.id, owner.access.editorToken, issued.credential.id);
    expect((await app.inject({ method: "POST", url, headers, payload: { jsonrpc: "2.0", id: 3, method: "tools/list" } })).statusCode).toBe(403);
  });
});
