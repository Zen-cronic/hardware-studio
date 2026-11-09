import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { createApp } from "../server/app";

const directories: string[] = [];
const providers: HocuspocusProvider[] = [];
const docs: Y.Doc[] = [];
const apps: Awaited<ReturnType<typeof createApp>>[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  providers.splice(0).forEach(p => p.destroy());
  sockets.splice(0).forEach(s => s.terminate());
  for (const runtime of apps.splice(0)) await runtime.app.close();
  docs.splice(0).forEach(d => d.destroy());
  directories.splice(0).forEach(d => rmSync(d, { recursive: true, force: true }));
  vi.restoreAllMocks();
});
async function start(dataDir?: string) {
  dataDir ??= mkdtempSync(join(tmpdir(), "studio-shared-listener-"));
  if (!directories.includes(dataDir)) directories.push(dataDir);
  const runtime = await createApp({ dataDir, aiKey: "", serveStatic: false, collabTransport: "shared" });
  apps.push(runtime);
  const http = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  return { ...runtime, dataDir, http, ws: http.replace("http:", "ws:") };
}
function provider(url: string, name: string, token: string, onAuthenticationFailed?: () => void) {
  const doc = new Y.Doc(); docs.push(doc);
  const value = new HocuspocusProvider({ url, name, token, document: doc, onAuthenticationFailed });
  providers.push(value);
  return { value, doc };
}
async function socket(url: string) {
  const ws = new WebSocket(url); sockets.push(ws);
  const messages: any[] = [];
  ws.on("message", raw => { try { messages.push(JSON.parse(raw.toString())); } catch {} });
  await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  return { ws, messages };
}

it("shares room presence and Notes on one origin, with capability and viewer isolation", async () => {
  const run = await start();
  const made = run.store.create("turntable");
  const id = made.snapshot.design.id;
  const room = await socket(`${run.ws}/api/rooms/${id}?token=${made.access.editorToken}`);
  const peer = await socket(`${run.ws}/api/rooms/${id}?token=${made.access.viewerToken}`);
  await expect.poll(() => peer.messages.some(m => m.type === "presence" && m.peers.length === 2)).toBe(true);
  room.ws.send(JSON.stringify({ type: "presence", selection: "base" }));
  await expect.poll(() => peer.messages.some(m => m.type === "presence" && m.peers.some((p: any) => p.selection === "base"))).toBe(true);
  const a = provider(`${run.ws}/collab`, id, made.access.editorToken);
  const b = provider(`${run.ws}/collab`, id, made.access.editorToken);
  const viewer = provider(`${run.ws}/collab`, id, made.access.viewerToken);
  await expect.poll(() => [a, b, viewer].every(p => p.value.isSynced)).toBe(true);
  expect(viewer.value.authorizedScope).toBe("readonly");
  a.doc.getText("notes").insert(0, "Check both mounting holes.");
  a.doc.getArray("sketches").push([{ id: "stroke-a", points: [[1, 2], [3, 4]] }]);
  await expect.poll(() => b.doc.getText("notes").toString()).toBe("Check both mounting holes.");
  await expect.poll(() => viewer.doc.getArray("sketches").length).toBe(1);
  viewer.doc.getText("notes").insert(0, "forbidden");
  b.doc.getText("notes").insert(b.doc.getText("notes").length, " Confirmed.");
  await expect.poll(() => a.doc.getText("notes").toString()).toBe("Check both mounting holes. Confirmed.");
  let rejected = false;
  provider(`${run.ws}/collab`, id, "invalid-capability", () => { rejected = true; });
  await expect.poll(() => rejected).toBe(true);
  const unauthRoom = new WebSocket(`${run.ws}/api/rooms/${id}?token=invalid`);
  sockets.push(unauthRoom);
  const status = await new Promise<number>(resolve => {
    unauthRoom.once("unexpected-response", (_, response) => { response.resume(); resolve(response.statusCode!); unauthRoom.terminate(); });
    unauthRoom.on("error", () => {});
  });
  expect(status).toBe(403);
  b.value.disconnect(); b.value.connect();
  await expect.poll(() => b.value.isSynced).toBe(true);
  expect(b.doc.getText("notes").toString()).not.toContain("forbidden");
});

it("accepts Notes above 64 KiB and flushes the latest update before restart", async () => {
  const run = await start();
  const made = run.store.create("turntable"), id = made.snapshot.design.id;
  const a = provider(`${run.ws}/collab`, id, made.access.editorToken);
  const b = provider(`${run.ws}/collab`, id, made.access.editorToken);
  await expect.poll(() => a.value.isSynced && b.value.isSynced).toBe(true);
  const content = "x".repeat(90_000);
  a.doc.getText("notes").insert(0, content);
  await expect.poll(() => b.doc.getText("notes").length).toBe(content.length);
  // A second update is followed immediately by close, within the 500ms debounce.
  a.doc.getText("notes").insert(content.length, " Final measured fit.");
  await expect.poll(() => b.doc.getText("notes").toString().endsWith(" Final measured fit.")).toBe(true);
  const pending = await socket(`${run.ws}/collab`);
  const closed = new Promise<number>(resolve => pending.ws.once("close", resolve));
  await run.app.close();
  expect(await closed).toBe(1001);
  expect(run.collaboration?.hocuspocus.getDocumentsCount()).toBe(0);
  expect(run.store.db.open).toBe(false);
  providers.splice(0).forEach(p => p.destroy());
  const restored = await start(run.dataDir);
  const fresh = provider(`${restored.ws}/collab`, id, made.access.editorToken);
  await expect.poll(() => fresh.value.isSynced).toBe(true);
  expect(fresh.doc.getText("notes").toString()).toBe(content + " Final measured fit.");
}, 15_000);

it("preserves the room 64 KiB and Notes 1 MB message bounds", async () => {
  const run = await start(), made = run.store.create("turntable");
  const id = made.snapshot.design.id;
  const peer = await socket(`${run.ws}/api/rooms/${id}?token=${made.access.viewerToken}`);
  const room = await socket(`${run.ws}/api/rooms/${id}?token=${made.access.editorToken}`);
  const presenceFrame = (size: number, marker: string) => {
    const empty = JSON.stringify({ type: "presence", selection: "" });
    return JSON.stringify({ type: "presence", selection: marker + "x".repeat(size - Buffer.byteLength(empty) - marker.length) });
  };
  const boundary = presenceFrame(65_536, "accepted-boundary");
  expect(Buffer.byteLength(boundary)).toBe(65_536);
  room.ws.send(boundary);
  await expect.poll(() => peer.messages.some(m => m.type === "presence" && m.peers.some((p: any) => p.selection?.startsWith("accepted-boundary")))).toBe(true);
  peer.messages.length = 0;
  const roomClose = new Promise<number>(resolve => room.ws.once("close", resolve));
  const oversized = presenceFrame(65_537, "must-not-apply");
  expect(Buffer.byteLength(oversized)).toBe(65_537);
  room.ws.send(oversized);
  expect(await roomClose).toBe(1009);
  await expect.poll(() => peer.messages.some(m => m.type === "presence" && m.peers.length === 1)).toBe(true);
  expect(peer.messages.some(m => m.type === "presence" && m.peers.some((p: any) => p.selection?.startsWith("must-not-apply")))).toBe(false);

  // This opaque binary frame proves transport delivery at the exact Notes
  // limit, not validity as a Hocuspocus/Yjs application message.
  const boundaryServerReady = new Promise<WebSocket>(resolve => run.app.websocketServer.once("connection", resolve));
  const boundaryNotes = await socket(`${run.ws}/collab`);
  const boundaryServer = await boundaryServerReady;
  const boundaryErrors: Error[] = [];
  boundaryServer.on("error", error => boundaryErrors.push(error));
  const delivered = new Promise<number>(resolve => boundaryServer.once("message", raw => resolve(Array.isArray(raw) ? raw.reduce((sum, part) => sum + part.byteLength, 0) : raw.byteLength)));
  boundaryNotes.ws.send(Buffer.alloc(1_000_000));
  expect(await delivered).toBe(1_000_000);
  expect(boundaryErrors.some(error => (error as NodeJS.ErrnoException).code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH")).toBe(false);
  const boundaryClosed = new Promise<void>(resolve => boundaryNotes.ws.once("close", () => resolve()));
  boundaryNotes.ws.close();
  await boundaryClosed;

  // Observe the real server receiver and existing close/terminate behavior without
  // replacing the error handler. ws initiates 1009, then Fastify terminates the
  // socket; whether the client receives that close frame is transport timing.
  const serverSocketReady = new Promise<WebSocket>(resolve => run.app.websocketServer.once("connection", resolve));
  const notes = await socket(`${run.ws}/collab`);
  const serverSocket = await serverSocketReady;
  const serverMessages: unknown[] = [], receiverErrors: Error[] = [];
  serverSocket.on("message", message => serverMessages.push(message));
  serverSocket.on("error", error => receiverErrors.push(error));
  const close = vi.spyOn(serverSocket, "close"), terminate = vi.spyOn(serverSocket, "terminate");
  try {
    const notesClose = new Promise<number>(resolve => notes.ws.once("close", resolve));
    notes.ws.send(Buffer.alloc(1_000_001));
    const clientCode = await notesClose;
    expect(receiverErrors).toHaveLength(1);
    expect(receiverErrors[0]).toMatchObject({ code: "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH", message: "Max payload size exceeded" });
    expect(close).toHaveBeenCalledWith(1009);
    expect(terminate).toHaveBeenCalled();
    expect(serverMessages).toHaveLength(0);
    expect(run.collaboration?.hocuspocus.getDocumentsCount()).toBe(0);
    expect(run.store.db.prepare("SELECT COUNT(*) AS count FROM documents").get()).toEqual({ count: 0 });
    expect([1006, 1009]).toContain(clientCode);
  } finally {
    close.mockRestore(); terminate.mockRestore();
  }
  expect((await run.app.inject("/api/health")).statusCode).toBe(200);
});

for (const stage of ["onAuthenticate", "afterLoadDocument"] as const) it(`drains an in-flight ${stage} without late SQLite access`, async () => {
  const run = await start(), made = run.store.create("turntable");
  let entered = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  run.collaboration!.hocuspocus.configuration.extensions.push({ [stage]: async () => { entered = true; await gate; } });
  const waiting = provider(`${run.ws}/collab`, made.snapshot.design.id, made.access.editorToken);
  await expect.poll(() => entered).toBe(true);
  const close = run.app.close();
  await new Promise(resolve => setTimeout(resolve, 20));
  release();
  await close;
  waiting.value.destroy();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(run.collaboration!.hocuspocus.getDocumentsCount()).toBe(0);
  expect(run.collaboration!.hocuspocus.loadingDocuments.size).toBe(0);
  expect(run.store.db.open).toBe(false);
});

it("destroys a document created by authentication that finishes after shutdown", async () => {
  const run = await start(), made = run.store.create("turntable");
  let authenticated = false, awarenessDestroyed = false, release!: () => void, rejectedDocument: Y.Doc | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  run.collaboration!.hocuspocus.configuration.extensions.unshift({
    async onLoadDocument({ document }) {
      rejectedDocument = document;
      document.awareness.on("destroy", () => { awarenessDestroyed = true; });
    },
  });
  run.collaboration!.hocuspocus.configuration.extensions.push({
    async onAuthenticate() { authenticated = true; await gate; },
  });
  provider(`${run.ws}/collab`, made.snapshot.design.id, made.access.editorToken);
  try {
    await expect.poll(() => authenticated).toBe(true);
    await run.app.close();
    expect(run.store.db.open).toBe(false);
    release();
    await expect.poll(() => rejectedDocument !== undefined).toBe(true);
    // A failed load is not in Hocuspocus's document map. Check destruction itself,
    // including its awareness timer, rather than treating an empty map as cleanup.
    expect(rejectedDocument!.isDestroyed).toBe(true);
    expect(awarenessDestroyed).toBe(true);
  } finally {
    release();
    rejectedDocument?.destroy();
  }
});
