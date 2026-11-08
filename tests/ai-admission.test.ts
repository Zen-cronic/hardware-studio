import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { AiProviderAdmission } from "../server/ai-admission";
import { aiProviderConfig } from "../server/config";
import { createApp } from "../server/app";
import { Store } from "../server/store";
import { propose } from "../server/proposals";
import { AgentService } from "../server/agents";
import { VersionService } from "../server/versions";

const stores: Store[] = [], runtimes: Awaited<ReturnType<typeof createApp>>[] = [], agents: AgentService[] = [], dirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const runtime of runtimes.splice(0)) await runtime.app.close();
  for (const agent of agents.splice(0)) await agent.close();
  for (const store of stores.splice(0)) { await store.aiProvider.close(); if (store.db.open) store.close(); }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "studio-ai-admission-")); dirs.push(dir); return dir; };
const body = { prompt: "Set rpm to 9", actor: "Maker" };
const payload = (proposal: unknown = { changes: { rpm: 9 }, questions: [] }) => ({
  usage: { prompt_tokens: 100, completion_tokens: 20 }, choices: [{ message: { content: JSON.stringify(proposal) } }],
});
const response = (data: unknown = payload()) => new Response(JSON.stringify(data), { status: 200 });
const usage = (store: Store) => store.db.prepare("SELECT status,reserved,spent FROM ai_usage ORDER BY rowid").all() as { status: string; reserved: number; spent: number }[];
function setup(policy = { budgetUsd: 50, reservationUsd: 1 }, concurrency = 2) {
  const store = new Store(":memory:", policy, new AiProviderAdmission(concurrency)); stores.push(store);
  const owner = store.create("turntable"); return { store, owner };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function provider(settleOnAbort = true) {
  const calls: { signal: AbortSignal; headers(): void; finish(data?: unknown): void; fail(error: Error): void }[] = [];
  const fetch = vi.fn((_url: unknown, init: RequestInit) => {
    const pending = deferred<Response>(), signal = init.signal as AbortSignal;
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined, headersSent = false;
    const abort = () => { pending.reject(signal.reason); stream?.error(signal.reason); };
    if (settleOnAbort) signal.addEventListener("abort", abort, { once: true });
    const headers = () => {
      if (headersSent) return; headersSent = true;
      pending.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } })));
    };
    calls.push({ signal, headers,
      finish(data = payload()) { headers(); signal.removeEventListener("abort", abort); stream!.enqueue(new TextEncoder().encode(JSON.stringify(data))); stream!.close(); },
      fail(error) { signal.removeEventListener("abort", abort); if (headersSent) stream!.error(error); else pending.reject(error); },
    });
    return pending.promise;
  });
  vi.stubGlobal("fetch", fetch);
  return { calls, fetch };
}
async function runtime(concurrency = 2) {
  const value = await createApp({ dataDir: temp(), aiKey: "synthetic-test-key", serveStatic: false, aiProvider: new AiProviderAdmission(concurrency) });
  runtimes.push(value); return value;
}
function post(runtime: Awaited<ReturnType<typeof createApp>>, owner: ReturnType<Store["create"]>, token = owner.access.editorToken, input: unknown = body) {
  return runtime.app.inject({ method: "POST", url: `/api/designs/${owner.snapshot.design.id}/propose`, headers: { authorization: "Bearer " + token }, payload: input as any });
}
function rawPost(address: string, path: string, token: string) {
  const done = deferred<{ status: number; body: string }>();
  const request = httpRequest(address + path, { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" } }, (response) => {
    let text = ""; response.on("data", (chunk) => { text += chunk; });
    response.on("end", () => done.resolve({ status: response.statusCode!, body: text }));
  });
  request.on("error", done.reject); request.end(JSON.stringify(body));
  return { request, done: done.promise };
}

describe("shared provider admission", () => {
  it("bounds configuration and validates programmatic limits", () => {
    expect(aiProviderConfig({})).toEqual({ concurrency: 2 });
    for (const raw of ["1", "16"]) expect(new AiProviderAdmission(aiProviderConfig({ AI_PROVIDER_CONCURRENCY: raw }).concurrency).concurrency).toBe(Number(raw));
    for (const raw of ["0", "17", "-1", "1.5", "", " ", "2junk", "Infinity", "9007199254740992"])
      expect(() => aiProviderConfig({ AI_PROVIDER_CONCURRENCY: raw })).toThrow(/AI_PROVIDER_CONCURRENCY/);
    for (const value of [0, 17, 1.5, NaN, Infinity]) expect(() => new AiProviderAdmission(value)).toThrow();
  });

  it("shares two slots between direct HTTP and agent roles, holds streamed bodies, and readmits after settlement", async () => {
    const r = await runtime(), owner = r.store.create("turntable"), mock = provider();
    const direct = post(r, owner).then((value) => value);
    await vi.waitFor(() => expect(mock.calls).toHaveLength(1));
    mock.calls[0].headers();
    const version = (await r.app.inject({ method: "POST", url: `/api/designs/${owner.snapshot.design.id}/proposed-versions`, headers: { authorization: "Bearer " + owner.access.editorToken }, payload: { actor: "Maker", expectedRevision: 0 } })).json();
    const runUrl = `/api/proposed-versions/${version.version.id}/agent-runs`;
    const run = (await r.app.inject({ method: "POST", url: runUrl, headers: { authorization: "Bearer " + owner.access.editorToken }, payload: { goal: "Adjust speed" } })).json();
    await vi.waitFor(() => expect(mock.calls).toHaveLength(2));
    mock.calls[1].headers();
    const busy = await post(r, owner);
    expect(busy.statusCode).toBe(429); expect(busy.json().code).toBe("AI_BUSY");
    expect(mock.fetch).toHaveBeenCalledTimes(2); expect(usage(r.store)).toHaveLength(2);
    expect(r.store.aiProvider.stats().active).toBe(2);
    mock.calls[0].finish(); expect((await direct).statusCode).toBe(200);
    const next = post(r, owner).then((value) => value);
    await vi.waitFor(() => expect(mock.calls).toHaveLength(3));
    mock.calls[2].finish(); expect((await next).statusCode).toBe(200);
    await r.app.inject({ method: "POST", url: `${runUrl}/${run.id}/cancel`, headers: { authorization: "Bearer " + owner.access.editorToken } });
    await vi.waitFor(() => expect(r.store.aiProvider.stats().active).toBe(0));
    expect(mock.calls[1].signal.aborted).toBe(true);
    expect(usage(r.store).map((row) => row.status)).toEqual(["complete", "failed", "complete"]);
    expect(usage(r.store)[1].reserved).toBe(1);
    expect(r.store.get(version.version.proposedDesignId).design.revision).toBe(0);
    expect(r.store.get(owner.snapshot.design.id).design.revision).toBe(0);
  });

  it("keeps both agent roles inside the same provider limit and holds capacity through accounting", async () => {
    const { store, owner } = setup(), versions = new VersionService(store), mock = provider();
    const view = versions.create(owner.snapshot.design.id, owner.access.editorToken, { actor: "Maker", expectedRevision: 0 });
    const agent = new AgentService(versions, { apiKey: "synthetic" }); agents.push(agent);
    const direct = propose(store, owner.snapshot, body, "synthetic");
    const run = agent.start(view.version.id, owner.access.editorToken, "Adjust speed");
    await vi.waitFor(() => expect(mock.calls).toHaveLength(2));
    const record = store.recordAi.bind(store);
    vi.spyOn(store, "recordAi").mockImplementation((...args) => {
      expect(store.aiProvider.stats().active).toBe(2);
      expect(() => store.aiProvider.acquire()).toThrow(/busy/);
      record(...args);
    });
    mock.calls[1].finish(payload({ changes: { rpm: 9 }, questions: [] }));
    await vi.waitFor(() => expect(mock.calls).toHaveLength(3));
    expect(store.aiProvider.stats().active).toBe(2);
    await expect(propose(store, owner.snapshot, body, "synthetic")).rejects.toMatchObject({ code: "AI_BUSY" });
    expect(usage(store)).toHaveLength(3);
    mock.calls[2].finish(payload({ changes: { rpm: 10 }, questions: [] }));
    const finished = await agent.wait(run.id);
    expect(finished.status).toBe("completed"); expect(finished.completedRoles).toEqual(["designer", "engineer"]);
    expect(store.get(view.version.proposedDesignId).design.revision).toBe(2);
    expect(store.get(owner.snapshot.design.id).design.revision).toBe(0);
    vi.restoreAllMocks(); mock.calls[0].finish(); await direct;
    expect(store.aiProvider.stats().active).toBe(0);
  });

  it("validates authorization, inputs, model and local requests before admission", async () => {
    const r = await runtime(1), owner = r.store.create("turntable"), mock = provider();
    const pending = post(r, owner).then((value) => value);
    await vi.waitFor(() => expect(mock.calls).toHaveLength(1));
    expect((await post(r, owner, owner.access.viewerToken)).statusCode).toBe(403);
    expect((await post(r, owner, "wrong-token")).statusCode).toBe(403);
    for (const input of [{ prompt: "", actor: "Maker" }, { ...body, images: ["invalid"] }, null])
      expect((await post(r, owner, owner.access.editorToken, input)).statusCode).toBe(422);
    vi.stubEnv("OPENAI_MODEL", "unknown-model");
    expect((await post(r, owner)).json().code).toBe("AI_MODEL_UNPRICED");
    const local = await propose(r.store, owner.snapshot, body, "");
    expect(local.source).toBe("local");
    expect(mock.fetch).toHaveBeenCalledTimes(1); expect(usage(r.store)).toHaveLength(1);
    mock.calls[0].finish(); expect((await pending).statusCode).toBe(200);
  });

  it("releases admission on repeated budget refusal without calling or reserving", async () => {
    const { store, owner } = setup({ budgetUsd: 0, reservationUsd: 1 }, 1), mock = provider();
    for (let count = 0; count < 3; count++) {
      await expect(propose(store, owner.snapshot, body, "synthetic")).rejects.toMatchObject({ code: "BUDGET_LIMIT" });
      expect(store.aiProvider.stats().active).toBe(0);
    }
    expect(mock.fetch).not.toHaveBeenCalled(); expect(usage(store)).toEqual([]);
  });

  it.each([
    ["success", () => response(), "complete", 0],
    ["HTTP failure", () => new Response("unavailable", { status: 503 }), "failed", 0],
    ["unreadable body", () => new Response("not-json"), "failed", 1],
    ["invalid JSON proposal", () => response({ ...payload(), choices: [{ message: { content: "not-json" } }] }), "complete", 0],
    ["invalid measurements", () => response(payload({ changes: { rpm: "fast" }, questions: [] })), "complete", 0],
    ["invalid geometry", () => response(payload({ changes: { rpm: -100 }, questions: [] })), "complete", 0],
    ["missing usage", () => response({ choices: payload().choices }), "unpriced", 1],
  ] as const)("releases after %s and preserves its accounting", async (name, reply, status, reserved) => {
    const { store, owner } = setup(undefined, 1);
    vi.stubGlobal("fetch", vi.fn(async () => reply()));
    const result = propose(store, owner.snapshot, body, "synthetic");
    if (name === "success" || name === "missing usage") await expect(result).resolves.toHaveProperty("source", "ai");
    else await expect(result).rejects.toThrow();
    expect(store.aiProvider.stats().active).toBe(0);
    expect(usage(store)[0]).toMatchObject({ status, reserved });
    expect(store.get(owner.snapshot.design.id).design.revision).toBe(0);
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    await expect(propose(store, owner.snapshot, body, "synthetic")).resolves.toHaveProperty("source", "ai");
  });

  it("holds a failed HTTP response until its body cancellation settles", async () => {
    const { store, owner } = setup(undefined, 1), cancelled = deferred<void>();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel: () => cancelled.promise }), { status: 503 })));
    const pending = propose(store, owner.snapshot, body, "synthetic").catch((error) => error);
    await vi.waitFor(() => expect(usage(store)).toHaveLength(1));
    await expect(propose(store, owner.snapshot, body, "synthetic")).rejects.toMatchObject({ code: "AI_BUSY" });
    cancelled.resolve(); expect(await pending).toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(store.aiProvider.stats().active).toBe(0); expect(usage(store)[0].reserved).toBe(0);
  });

  it("keeps unknown network failure reservations without leaking capacity", async () => {
    const { store, owner } = setup(undefined, 1), mock = provider();
    const pending = propose(store, owner.snapshot, body, "synthetic").catch((error) => error);
    mock.calls[0].fail(new TypeError("Network failure")); await pending;
    expect(store.aiProvider.stats().active).toBe(0); expect(usage(store)[0]).toMatchObject({ status: "failed", reserved: 1 });
  });

  it.each([false, true])("times out with headers already received = %s and retains unknown charges", async (headersReceived) => {
    vi.useFakeTimers();
    const { store, owner } = setup(undefined, 1), mock = provider();
    const pending = propose(store, owner.snapshot, body, "synthetic").catch((error) => error);
    if (headersReceived) mock.calls[0].headers();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toMatchObject({ status: 504, code: "AI_TIMEOUT" });
    expect(mock.calls[0].signal.aborted).toBe(true); expect(store.aiProvider.stats().active).toBe(0);
    expect(usage(store)[0]).toMatchObject({ status: "failed", reserved: 1 });
  });

  it("rejects an already-aborted request before budget or provider work", async () => {
    const { store, owner } = setup(), mock = provider(), controller = new AbortController(); controller.abort();
    await expect(propose(store, owner.snapshot, body, "synthetic", controller.signal)).rejects.toThrow();
    expect(mock.fetch).not.toHaveBeenCalled(); expect(usage(store)).toEqual([]); expect(store.aiProvider.stats().active).toBe(0);
  });

  it("does not free an aborted agent slot until a late provider result settles, and never applies it", async () => {
    const { store, owner } = setup(undefined, 1), versions = new VersionService(store), mock = provider(false);
    const view = versions.create(owner.snapshot.design.id, owner.access.editorToken, { actor: "Maker", expectedRevision: 0 });
    const agent = new AgentService(versions, { apiKey: "synthetic" }); agents.push(agent);
    const run = agent.start(view.version.id, owner.access.editorToken, "Adjust speed");
    await vi.waitFor(() => expect(mock.calls).toHaveLength(1));
    agent.cancel(view.version.id, owner.access.editorToken, run.id);
    expect(mock.calls[0].signal.aborted).toBe(true); expect(store.aiProvider.stats().active).toBe(1);
    await expect(propose(store, owner.snapshot, body, "synthetic")).rejects.toMatchObject({ code: "AI_BUSY" });
    expect(usage(store)).toHaveLength(1);
    mock.calls[0].finish(); expect((await agent.wait(run.id)).status).toBe("cancelled");
    expect(store.aiProvider.stats().active).toBe(0); expect(usage(store)[0]).toMatchObject({ status: "complete", reserved: 0 });
    expect(store.get(view.version.proposedDesignId).design.revision).toBe(0);
  });

  it("propagates actual HTTP disconnect while allowing a complete POST to succeed", async () => {
    const r = await runtime(1), owner = r.store.create("turntable"), mock = provider();
    const address = await r.app.listen({ host: "127.0.0.1", port: 0 }), path = `/api/designs/${owner.snapshot.design.id}/propose`;
    const first = rawPost(address, path, owner.access.editorToken), disconnected = first.done.catch((error) => error);
    await vi.waitFor(() => expect(mock.calls).toHaveLength(1));
    mock.calls[0].headers(); first.request.destroy(new Error("Client disconnected")); await disconnected;
    await vi.waitFor(() => expect(r.store.aiProvider.stats().active).toBe(0));
    expect(mock.calls[0].signal.aborted).toBe(true); expect(usage(r.store)[0].reserved).toBe(1);
    const next = rawPost(address, path, owner.access.editorToken);
    await vi.waitFor(() => expect(mock.calls).toHaveLength(2));
    expect(mock.calls[1].signal.aborted).toBe(false); mock.calls[1].finish();
    expect((await next.done).status).toBe(200); expect(r.store.get(owner.snapshot.design.id).design.revision).toBe(0);
  });

  it("aborts during Fastify preClose, settles direct and agent calls, then closes SQLite", async () => {
    const r = await runtime(), owner = r.store.create("turntable"), mock = provider();
    const address = await r.app.listen({ host: "127.0.0.1", port: 0 });
    const direct = rawPost(address, `/api/designs/${owner.snapshot.design.id}/propose`, owner.access.editorToken);
    const version = (await r.app.inject({ method: "POST", url: `/api/designs/${owner.snapshot.design.id}/proposed-versions`, headers: { authorization: "Bearer " + owner.access.editorToken }, payload: { actor: "Maker", expectedRevision: 0 } })).json();
    await r.app.inject({ method: "POST", url: `/api/proposed-versions/${version.version.id}/agent-runs`, headers: { authorization: "Bearer " + owner.access.editorToken }, payload: { goal: "Adjust speed" } });
    await vi.waitFor(() => expect(mock.calls).toHaveLength(2));
    mock.calls.forEach((call) => call.headers());
    const fail = vi.spyOn(r.store, "failAi"), close = vi.spyOn(r.store, "close");
    await r.app.close(); expect((await direct.done).status).toBe(409);
    expect(mock.calls.every((call) => call.signal.aborted)).toBe(true);
    expect(fail).toHaveBeenCalledTimes(2); expect(close).toHaveBeenCalledTimes(1);
    expect(Math.max(...fail.mock.invocationCallOrder)).toBeLessThan(close.mock.invocationCallOrder[0]);
    expect(r.store.db.open).toBe(false); expect(r.store.aiProvider.stats()).toMatchObject({ active: 0, stopping: true });
    expect(() => r.store.aiProvider.acquire()).toThrow(/restarting/);
    const reopened = new Store(join(dirs[dirs.length - 1], "studio.sqlite")); stores.push(reopened);
    expect(usage(reopened)).toHaveLength(2); expect(usage(reopened).every((row) => row.reserved === 1)).toBe(true);
    expect(reopened.get(version.version.proposedDesignId).design.revision).toBe(0);
  });

  it("starts with empty slots after reopen, preserving orphan reservations, saved designs and exhausted budgets", async () => {
    const path = join(temp(), "studio.sqlite"), policy = { budgetUsd: 2, reservationUsd: 1 };
    const before = new Store(path, policy, new AiProviderAdmission(1)), owner = before.create("turntable");
    before.reserveAi("orphan"); before.close();
    const after = new Store(path, policy, new AiProviderAdmission(1)); stores.push(after);
    expect(after.get(owner.snapshot.design.id)).toEqual(beforeSnapshot(owner.snapshot));
    expect(after.aiProvider.stats().active).toBe(0);
    const original = usage(after)[0], mock = provider();
    const pending = propose(after, after.get(owner.snapshot.design.id), body, "synthetic").catch((error) => error);
    expect(mock.calls).toHaveLength(1); mock.calls[0].fail(new TypeError("Interrupted")); await pending;
    expect(usage(after)[0]).toEqual(original); expect(usage(after)[0].status).toBe("reserved");
    after.close(); stores.splice(stores.indexOf(after), 1);
    const exhausted = new Store(path, policy, new AiProviderAdmission(1)); stores.push(exhausted);
    await expect(propose(exhausted, exhausted.get(owner.snapshot.design.id), body, "synthetic")).rejects.toMatchObject({ code: "BUDGET_LIMIT" });
    expect(mock.fetch).toHaveBeenCalledTimes(1); expect(exhausted.aiProvider.stats().active).toBe(0);
    expect(usage(exhausted).map((row) => row.reserved)).toEqual([1, 1]);
  });
});
function beforeSnapshot(snapshot: ReturnType<Store["create"]>["snapshot"]) { const { role: _role, ...saved } = snapshot; return saved; }
