import { afterEach, expect, it, vi } from "vitest";
import { connectBrowserAgent } from "../src/lib/webmcp";

type RegisteredTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
};
type RegistrationOptions = { signal: AbortSignal };
const credential = "private-editor-credential-fixture";
const definitions = ["first", "second", "third"].map(name => ({
  name, description: "Operate the proposed design", inputSchema: { type: "object", properties: {} },
}));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function browserContext() {
  const active = new Map<string, RegisteredTool>();
  const registerTool = vi.fn(async (tool: RegisteredTool, { signal }: RegistrationOptions) => {
    active.set(tool.name, tool);
    signal.addEventListener("abort", () => active.delete(tool.name), { once: true });
  });
  vi.stubGlobal("document", { modelContext: { registerTool } });
  return { active, registerTool };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([undefined, {}, { modelContext: {} }])("reports absent or unsupported native APIs without requesting credentials (%j)", async document => {
  vi.stubGlobal("document", document);
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(connectBrowserAgent("proposal", credential)).rejects.toThrow("Native WebMCP is not enabled");
  expect(fetch).not.toHaveBeenCalled();
});

it("does not register tools or disclose authorization response details when access fails", async () => {
  const { registerTool } = browserContext();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: credential }, 403)));
  await expect(connectBrowserAgent("proposal", credential)).rejects.toThrow("The browser agent connection could not be authorized.");
  expect(registerTool).not.toHaveBeenCalled();
});

it("awaits registration and unregisters all tools once through the registration signal", async () => {
  const { active, registerTool } = browserContext();
  const register = registerTool.getMockImplementation()!;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  registerTool.mockImplementationOnce(async (tool, options) => {
    await pending;
    await register(tool, options);
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(definitions.slice(0, 2))));
  const connection = connectBrowserAgent("proposal", credential);
  let connected = false; void connection.then(() => { connected = true; });
  await vi.waitFor(() => expect(registerTool).toHaveBeenCalledTimes(1));
  expect(connected).toBe(false);
  release();
  const disconnect = await connection;
  expect(active.size).toBe(2);
  expect(registerTool).toHaveBeenCalledTimes(2);
  const signal = registerTool.mock.calls[0][1].signal;
  expect(registerTool.mock.calls[1][1].signal).toBe(signal);
  const aborted = vi.fn(); signal.addEventListener("abort", aborted);
  disconnect(); disconnect();
  expect(signal.aborted).toBe(true);
  expect(aborted).toHaveBeenCalledTimes(1);
  expect(active.size).toBe(0);
});

it("rolls back successful and pending registrations when a later async registration fails", async () => {
  const { active, registerTool } = browserContext();
  const register = registerTool.getMockImplementation()!;
  const error = new Error("Tool name is already registered");
  registerTool.mockImplementation(async (tool, options) => {
    await register(tool, options);
    if (tool.name === "hardware_second") throw error;
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(definitions)));
  await expect(connectBrowserAgent("proposal", credential)).rejects.toBe(error);
  expect(registerTool).toHaveBeenCalledTimes(2);
  expect(registerTool.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
  expect(active.size).toBe(0);
});

it("forwards execution cancellation without coupling it to registration cleanup", async () => {
  const { active } = browserContext();
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json(definitions.slice(0, 1)));
  vi.stubGlobal("fetch", fetch);
  const disconnect = await connectBrowserAgent("proposal", credential);
  const execution = new AbortController();
  const reason = new DOMException("Cancelled by the agent", "AbortError");
  fetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
    const signal = options!.signal!;
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const result = active.get("hardware_first")!.execute({}, { signal: execution.signal });
  const rejected = expect(result).rejects.toBe(reason);
  expect(fetch.mock.calls[1][1]?.signal).toBe(execution.signal);
  disconnect();
  expect(active.size).toBe(0);
  expect(execution.signal.aborted).toBe(false);
  execution.abort(reason);
  await rejected;
});

it("keeps credentials out of tool metadata, request URLs, arguments, and returned content", async () => {
  const { active, registerTool } = browserContext();
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(json([{ ...definitions[0], internalCredential: credential }]))
    .mockResolvedValueOnce(json({ ok: true, revision: 2 }));
  vi.stubGlobal("fetch", fetch);
  const disconnect = await connectBrowserAgent("proposal/id", credential);
  const tool = active.get("hardware_first")!;
  const result = await tool.execute({ label: "Revised design" });
  expect(JSON.stringify(registerTool.mock.calls)).not.toContain(credential);
  expect(JSON.stringify(result)).not.toContain(credential);
  expect(result).toEqual({ content: [{ type: "text", text: '{"ok":true,"revision":2}' }] });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "/api/proposed-versions/proposal%2Fid/tools",
    "/api/proposed-versions/proposal%2Fid/tools/first",
  ]);
  for (const [, options] of fetch.mock.calls) {
    expect(options?.headers).toMatchObject({ Authorization: "Bearer " + credential });
    expect(String(options?.body)).not.toContain(credential);
  }
  disconnect();
});
