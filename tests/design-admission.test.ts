import { test, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Store, HttpError } from "../server/store";
import { designAdmissionConfig, type DesignAdmissionPolicy } from "../server/config";
import { createApp } from "../server/app";
import { VersionService } from "../server/versions";
import type { Snapshot } from "../src/shared/types";

const dir = () => mkdtempSync(join(tmpdir(), "studio-design-admission-"));
const policy = (overrides: Partial<DesignAdmissionPolicy> = {}) => ({ ...designAdmissionConfig({}), ...overrides });
const open = (path: string, config = policy(), now?: () => number) => new Store(path, undefined, undefined, config, now);
const count = (store: Store, table = "designs") => (store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
const counter = (store: Store) => store.db.prepare("SELECT * FROM design_admission").all();
const snapshotRows = (store: Store) => store.db.prepare("SELECT * FROM designs ORDER BY id").all();

test("design admission settings preserve optional local defaults and validate exact boundaries", () => {
  expect(designAdmissionConfig({})).toEqual({ maxDesigns: 0, creationsPerWindow: 0, windowSeconds: 3600 });
  expect(designAdmissionConfig({ MAX_SAVED_DESIGNS: "1", DESIGN_CREATIONS_PER_WINDOW: "1", DESIGN_CREATION_WINDOW_SECONDS: "1" }))
    .toEqual({ maxDesigns: 1, creationsPerWindow: 1, windowSeconds: 1 });
  expect(designAdmissionConfig({ DESIGN_CREATION_WINDOW_SECONDS: "604800" }).windowSeconds).toBe(604800);
  for (const key of ["MAX_SAVED_DESIGNS", "DESIGN_CREATIONS_PER_WINDOW", "DESIGN_CREATION_WINDOW_SECONDS"])
    for (const value of ["", " ", "-1", "1.5", "Infinity", "9007199254740992", "2e3"])
      expect(() => designAdmissionConfig({ [key]: value })).toThrow(key);
  for (const value of ["0", "604801"]) expect(() => designAdmissionConfig({ DESIGN_CREATION_WINDOW_SECONDS: value })).toThrow();
  expect(() => open(":memory:", policy({ maxDesigns: -1 }))).toThrow("Invalid design admission");
});

test("disabled limits leave creation uncapped and retain no request log", () => {
  const store = open(":memory:");
  try { for (let i = 0; i < 12; i++) store.create("holder"); expect(count(store)).toBe(12); expect(counter(store)).toEqual([]); }
  finally { store.close(); }
});

test("pre-existing rows count toward a newly configured cap without rewriting saved data", () => {
  const root = dir(), path = join(root, "db.sqlite"); let store = open(path);
  try {
    store.create("holder"); store.create("lamp"); const before = snapshotRows(store); store.close();
    store = open(path, policy({ maxDesigns: 1 }));
    expect(() => store.create("turntable")).toThrowError(expect.objectContaining({ status: 503, code: "DESIGN_CAPACITY" }));
    expect(snapshotRows(store)).toEqual(before); expect(counter(store)).toEqual([]);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("creation allowance survives restart, rejected retries, backward time and window configuration changes", () => {
  const root = dir(), path = join(root, "db.sqlite"); let now = 1000;
  let store = open(path, policy({ creationsPerWindow: 2, windowSeconds: 10 }), () => now);
  try {
    store.create("holder"); store.create("lamp"); const full = counter(store); store.close();
    store = open(path, policy({ creationsPerWindow: 2, windowSeconds: 1 }), () => now);
    for (now of [1000, 999, 10999]) {
      expect(() => store.create("holder")).toThrowError(expect.objectContaining({ status: 429, code: "DESIGN_RATE_LIMIT" }));
      expect(counter(store)).toEqual(full); expect(count(store)).toBe(2);
    }
    now = 11000; store.create("holder");
    expect(counter(store)).toEqual([{ id: 1, window_end_ms: 12000, count: 1 }]);
    store.create("holder"); expect(() => store.create("holder")).toThrow(/temporarily limited/);
    now = 12000; store.create("holder"); expect(counter(store)).toHaveLength(1);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("enabling a limit counts only later admissions and disabling it does not erase an existing window", () => {
  const root = dir(), path = join(root, "db.sqlite"); let store = open(path);
  try {
    store.create("holder"); expect(counter(store)).toEqual([]); store.close();
    store = open(path, policy({ creationsPerWindow: 1 })); store.create("holder"); const full = counter(store); store.close();
    store = open(path); store.create("holder"); expect(counter(store)).toEqual(full); store.close();
    store = open(path, policy({ creationsPerWindow: 1 }));
    expect(() => store.create("holder")).toThrow(/temporarily limited/); expect(count(store)).toBe(3); expect(counter(store)).toEqual(full);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("duplicate inserts and outer proposed-version failures roll back both copied design and admission", () => {
  const store = open(":memory:", policy({ creationsPerWindow: 4 }));
  try {
    const original = store.create("holder"), before = counter(store), rows = snapshotRows(store);
    expect(() => store.insert(original.snapshot)).toThrow(); expect(counter(store)).toEqual(before);
    const bad = structuredClone(original.snapshot); bad.design.id = "bad"; (bad as any).cycle = bad;
    expect(() => store.insert(bad)).toThrow(); expect(counter(store)).toEqual(before); expect(snapshotRows(store)).toEqual(rows);
    store.db.exec("CREATE TRIGGER reject_version BEFORE INSERT ON proposed_versions BEGIN SELECT RAISE(ABORT,'fixture version failure'); END;");
    const versions = new VersionService(store);
    expect(() => versions.create(original.snapshot.design.id, original.access.editorToken, { actor: "Maker", expectedRevision: 0 })).toThrow("fixture version failure");
    expect(count(store, "proposed_versions")).toBe(0); expect(snapshotRows(store)).toEqual(rows); expect(counter(store)).toEqual(before);
    store.db.exec("DROP TRIGGER reject_version");
    versions.create(original.snapshot.design.id, original.access.editorToken, { actor: "Maker", expectedRevision: 0 });
    expect(count(store)).toBe(2); expect((counter(store)[0] as any).count).toBe(2);
  } finally { store.close(); }
});

for (const kind of ["retained", "window"] as const) test(`independent simultaneous SQLite writers cannot oversubscribe ${kind} limit`, async () => {
  const root = dir(), path = join(root, "db.sqlite"), script = join(root, "writer.mjs");
  const config = kind === "retained" ? policy({ maxDesigns: 1 }) : policy({ creationsPerWindow: 1 });
  const seed = open(path); seed.close();
  const storePath = resolve("server/store.ts");
  writeFileSync(script, `import { Store } from ${JSON.stringify(storePath)};
const store=new Store(process.argv[2],undefined,undefined,JSON.parse(process.argv[3]));
process.stdout.write('ready\\n');process.stdin.once('data',()=>{try{store.create('holder');process.stdout.write(JSON.stringify({status:'created'})+'\\n');}catch(e){process.stdout.write(JSON.stringify({status:e.status,code:e.code})+'\\n');}finally{store.close();process.stdin.destroy();}});`);
  const children: ReturnType<typeof spawn>[] = [];
  try {
    const workers = [0, 1].map(() => {
      const child = spawn(process.execPath, ["--import", "tsx", script, path, JSON.stringify(config)], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] }); children.push(child);
      let output = "", errors = ""; let ready!: () => void;
      const prepared = new Promise<void>(resolve => { ready = resolve; });
      child.stdout!.on("data", data => { output += data; if (output.includes("ready\n")) ready(); }); child.stderr!.on("data", data => { errors += data; });
      const finished = new Promise<any>((resolve, reject) => { child.on("error", reject); child.on("exit", code => code === 0 ? resolve(JSON.parse(output.trim().split("\n").at(-1)!)) : reject(Error(errors || `writer exit ${code}`))); });
      return { child, prepared, finished };
    });
    await Promise.all(workers.map(w => Promise.race([w.prepared, w.finished.then(() => { throw Error("writer exited before barrier"); })])));
    workers.forEach(w => w.child.stdin!.write("go\n"));
    const results = await Promise.all(workers.map(w => w.finished));
    expect(results.filter(r => r.status === "created")).toHaveLength(1);
    expect(results.filter(r => r.code === (kind === "retained" ? "DESIGN_CAPACITY" : "DESIGN_RATE_LIMIT"))).toHaveLength(1);
    const store = open(path, config); try { expect(count(store)).toBe(1); if (kind === "window") expect((counter(store)[0] as any).count).toBe(1); } finally { store.close(); }
  } finally { children.forEach(child => child.kill()); rmSync(root, { recursive: true, force: true }); }
}, 15000);

function seedReconstruction(store: Store, root: string, snapshot: Snapshot) {
  const bytes = Buffer.from("retained source fixture"), sourcePath = join(root, "source.step"); writeFileSync(sourcePath, bytes);
  const sourceHash = createHash("sha256").update(bytes).digest("hex"), importId = "source", jobId = "reconstruction";
  const candidate = { id: "plate", name: "Plate", shape: "box", size: [40, 8, 20], position: [0, 0, 0], color: "#72a6d7", material: "Aluminum", process: "machine" };
  const record = { id: importId, designId: snapshot.design.id, filename: "source.step", format: "step", byteLength: bytes.length, sourceHash, initialScaleToMm: 1, createdAt: new Date().toISOString(), latestJobId: jobId, sourcePath };
  const job = { id: jobId, importId, action: "reconstruct", status: "ready", bodyIndex: 0, scaleToMm: 1, createdAt: new Date().toISOString(), result: { status: "reconstructed", inputHash: "fixture-hash", sourceHash, fit: { accepted: true }, candidate } };
  store.db.prepare("INSERT INTO imported_sources VALUES(?,?,?)").run(importId, snapshot.design.id, JSON.stringify(record));
  store.db.prepare("INSERT INTO import_jobs VALUES(?,?,?)").run(jobId, importId, JSON.stringify(job));
  return { bytes, sourcePath, importId, payload: { jobId, expectedInputHash: "fixture-hash" } };
}

for (const kind of ["retained", "window"] as const) test(`HTTP ${kind} refusal covers every design-creation path and preserves reads, edits and downloads`, async () => {
  const root = dir(), config = kind === "retained" ? policy({ maxDesigns: 1 }) : policy({ creationsPerWindow: 1 });
  const { app, store } = await createApp({ dataDir: root, serveStatic: false, aiKey: "", designPolicy: config });
  try {
    const created = (await app.inject({ method: "POST", url: "/api/designs", payload: { kind: "holder" } })).json();
    const id = created.snapshot.design.id, headers = { authorization: "Bearer " + created.access.editorToken };
    const fixture = seedReconstruction(store, root, created.snapshot), beforeRows = snapshotRows(store), beforeFiles = readdirSync(root).sort(), beforeCounter = counter(store);
    const archive = join(root, "existing.zip"); writeFileSync(archive, "existing archive");
    store.setBuild({ id: "existing", designId: id, revision: 0, status: "ready" }, archive);
    const counts = Object.fromEntries(["designs", "proposed_versions", "agent_credentials", "operations", "imported_sources", "import_jobs", "import_acceptances"].map(t => [t, count(store, t)]));
    for (const [url, payload] of [["/api/designs", { kind: "lamp" }], [`/api/designs/${id}/fork`, {}], [`/api/designs/${id}/proposed-versions`, { actor: "Maker", expectedRevision: 0 }], ["/api/imports/source/accept", fixture.payload]] as const) {
      const response = await app.inject({ method: "POST", url, payload, headers });
      expect(response.statusCode, response.body).toBe(kind === "retained" ? 503 : 429);
      expect(response.json().code).toBe(kind === "retained" ? "DESIGN_CAPACITY" : "DESIGN_RATE_LIMIT");
      if (kind === "window") { expect(Number(response.headers["retry-after"])).toBeGreaterThan(0); expect(response.json().retryAfterSeconds).toBe(Number(response.headers["retry-after"])); }
      expect(response.json()).not.toHaveProperty("access");
    }
    expect(snapshotRows(store)).toEqual(beforeRows); expect(counter(store)).toEqual(beforeCounter);
    expect(Object.fromEntries(Object.keys(counts).map(t => [t, count(store, t)]))).toEqual(counts);
    expect(readdirSync(root).sort()).toEqual([...beforeFiles, "existing.zip"].sort());
    expect((await app.inject({ url: `/api/designs/${id}`, headers })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/imports/source/original", headers })).rawPayload).toEqual(fixture.bytes);
    expect((await app.inject({ url: "/api/builds/existing/download", headers })).rawPayload).toEqual(Buffer.from("existing archive"));
    expect(readFileSync(archive)).toEqual(Buffer.from("existing archive"));
    const command = { id: "edit", actor: "Maker", baseRevision: 0, changes: { opening: 100 }, readSet: created.snapshot.design.params };
    const edit = await app.inject({ method: "POST", url: `/api/designs/${id}/commands`, headers, payload: command });
    expect(edit.statusCode, edit.body).toBe(200); expect(edit.json().design.revision).toBe(1); expect(counter(store)).toEqual(beforeCounter);
    expect((await app.inject({ method: "POST", url: "/api/designs", payload: { kind: "invalid" } })).statusCode).toBe(422);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});

test("reconstruction outer failures roll back linked rows and admission; completed acceptance reuse stays available at cap", async () => {
  const root = dir(), { app, store } = await createApp({ dataDir: root, serveStatic: false, aiKey: "", designPolicy: policy({ maxDesigns: 2, creationsPerWindow: 2 }) });
  try {
    const original = store.create("holder"), fixture = seedReconstruction(store, root, original.snapshot), headers = { authorization: "Bearer " + original.access.editorToken };
    const before = counter(store);
    store.db.exec("CREATE TRIGGER reject_acceptance BEFORE INSERT ON import_acceptances BEGIN SELECT RAISE(ABORT,'fixture acceptance failure'); END;");
    const failed = await app.inject({ method: "POST", url: "/api/imports/source/accept", headers, payload: fixture.payload });
    expect(failed.statusCode).toBe(500); expect(count(store)).toBe(1); expect(counter(store)).toEqual(before);
    expect(count(store, "import_jobs")).toBe(1); expect(count(store, "imported_sources")).toBe(1); expect(count(store, "import_acceptances")).toBe(0);
    store.db.exec("DROP TRIGGER reject_acceptance");
    const accepted = await app.inject({ method: "POST", url: "/api/imports/source/accept", headers, payload: fixture.payload });
    expect(accepted.statusCode, accepted.body).toBe(200); const full = counter(store);
    const repeated = await app.inject({ method: "POST", url: "/api/imports/source/accept", headers, payload: fixture.payload });
    expect(repeated.statusCode).toBe(200); expect(repeated.json()).toEqual(accepted.json()); expect(count(store)).toBe(2); expect(counter(store)).toEqual(full);
    expect(readFileSync(fixture.sourcePath)).toEqual(fixture.bytes);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});
