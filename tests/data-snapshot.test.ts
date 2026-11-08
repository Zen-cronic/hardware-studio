import { afterEach, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import * as Y from "yjs";
import { createApp } from "../server/app";
import { VersionService } from "../server/versions";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const python = process.env.CAD_PYTHON || join(homedir(), ".pyenv/versions/.victoria-hardware/bin/python");
const script = resolve("scripts/data-snapshot.py");
const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
function run(operation: string, source: string, destination?: string, stopped = true) {
  const args = [script, operation, "--source", source, ...(destination ? ["--destination", destination] : []), ...(stopped ? ["--confirm-stopped"] : [])];
  const result = spawnSync(python, args, { encoding: "utf8", timeout: 20000 });
  if (result.error) throw result.error;
  return { status: result.status, output: (result.stdout + result.stderr).trim() };
}
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "studio-snapshot-")); roots.push(root);
  const source = join(root, "source"), backup = join(root, "backup"), restored = join(root, "restored");
  const runtime = await createApp({ dataDir: source, serveStatic: false, aiKey: "" });
  const item = runtime.store.create("turntable", "Snapshot fixture");
  const id = item.snapshot.design.id;
  runtime.store.apply(id, { id: "widen", actor: "Maker", baseRevision: 0, changes: { diameter: 280 }, readSet: item.snapshot.design.params });
  new VersionService(runtime.store).create(id, item.access.editorToken, { actor: "Maker", expectedRevision: 1 });
  const archive = join(source, "builds", "package-one", "package", "package.zip");
  const original = join(source, "imports", "source-one", "original.step");
  const clip = join(source, "clips", "clip-one", "product.mp4");
  for (const [file, content] of [[archive, "opaque CAD archive fixture"], [original, "opaque original geometry fixture"], [clip, "opaque encoded-video fixture"]]) {
    mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, content);
  }
  runtime.store.setBuild({ id: "package-one", designId: id, revision: 0, status: "ready" }, archive);
  runtime.store.db.prepare("INSERT INTO imported_sources VALUES(?,?,?)").run("source-one", id, JSON.stringify({ id: "source-one", designId: id, filename: "part.step", format: "step", sourcePath: original, sourceHash: sha(readFileSync(original)), latestJobId: "import-one" }));
  runtime.store.db.prepare("INSERT INTO import_jobs VALUES(?,?,?)").run("import-one", "source-one", JSON.stringify({ id: "import-one", importId: "source-one", status: "ready", action: "inspect" }));
  runtime.store.db.prepare("INSERT INTO engineering_jobs VALUES(?,?,?)").run("study-one", id, JSON.stringify({ id: "study-one", designId: id, revision: 0, status: "ready", result: { status: "solved", fixture: true } }));
  runtime.store.db.prepare("INSERT INTO clips VALUES(?,?,?,?)").run("clip-one", id, JSON.stringify({ id: "clip-one", designId: id, revision: 0, status: "ready" }), "{}");
  runtime.store.reserveAi("unknown-charge"); runtime.store.failAi("unknown-charge", true);
  runtime.store.reserveAi("known-charge"); runtime.store.recordAi("known-charge", 10, 20);
  runtime.store.db.prepare("INSERT INTO design_admission VALUES(1,?,?)").run(1999999999999, 7);
  const note = new Y.Doc(); note.getText("notes").insert(0, "Keep the mounting hole");
  note.getArray("strokes").push([{ points: [[1, 2], [3, 4]], color: "blue" }]);
  runtime.store.db.prepare("INSERT INTO documents VALUES(?,?)").run(id, Buffer.from(Y.encodeStateAsUpdate(note))); note.destroy();
  const snapshots = runtime.store.db.prepare("SELECT * FROM designs ORDER BY id").all();
  const usage = runtime.store.db.prepare("SELECT * FROM ai_usage").all();
  const operations = runtime.store.db.prepare("SELECT * FROM operations").all();
  const versions = runtime.store.db.prepare("SELECT * FROM proposed_versions").all();
  await runtime.app.close();
  return { root, source, backup, restored, archive, original, clip, id, item, snapshots, usage, operations, versions };
}

test("quiesced backup includes committed WAL and restores actual API access, notes/sketch, counters and unknown charges", async () => {
  const f = await fixture();
  // An idle fixture connection retains WAL bytes; there is no running app or worker.
  const idle = new Database(join(f.source, "studio.sqlite"));
  idle.pragma("journal_mode = WAL"); idle.pragma("wal_autocheckpoint = 0");
  idle.prepare("UPDATE design_admission SET count=8 WHERE id=1").run();
  expect(statSync(join(f.source, "studio.sqlite-wal")).size).toBeGreaterThan(0);
  writeFileSync(join(f.source, ".env"), "SYNTHETIC_PRIVATE_KEY=do-not-copy");
  try { expect(run("backup", f.source, f.backup)).toEqual(expect.objectContaining({ status: 0 })); }
  finally { idle.close(); }
  expect(run("verify", f.backup).status).toBe(0);
  expect(existsSync(join(f.backup, ".env"))).toBe(false);
  expect(statSync(f.backup).mode & 0o777).toBe(0o700);
  expect(statSync(join(f.backup, "studio.sqlite")).mode & 0o777).toBe(0o600);
  const expectedArchive = readFileSync(f.archive), expectedOriginal = readFileSync(f.original), expectedClip = readFileSync(f.clip);
  renameSync(f.source, f.source + "-offline");
  const restored = run("restore", f.backup, f.restored); expect(restored.status, restored.output).toBe(0);
  expect(restored.output).not.toContain(f.item.access.editorToken);
  const runtime = await createApp({ dataDir: f.restored, serveStatic: false, aiKey: "" });
  try {
    expect(runtime.store.db.prepare("SELECT * FROM designs ORDER BY id").all()).toEqual(f.snapshots);
    expect(runtime.store.db.prepare("SELECT * FROM ai_usage").all()).toEqual(f.usage);
    expect(runtime.store.db.prepare("SELECT * FROM operations").all()).toEqual(f.operations);
    expect(runtime.store.db.prepare("SELECT * FROM proposed_versions").all()).toEqual(f.versions);
    expect(runtime.store.get(f.id).design.revision).toBe(1);
    expect(runtime.store.db.prepare("SELECT * FROM design_admission").get()).toEqual({ id: 1, window_end_ms: 1999999999999, count: 8 });
    const doc = new Y.Doc(); const content = runtime.store.db.prepare("SELECT content FROM documents WHERE id=?").get(f.id) as { content: Buffer };
    Y.applyUpdate(doc, content.content);
    expect(doc.getText("notes").toString()).toBe("Keep the mounting hole");
    expect(doc.getArray("strokes").toArray()).toEqual([{ points: [[1, 2], [3, 4]], color: "blue" }]); doc.destroy();
    const headers = { authorization: "Bearer " + f.item.access.editorToken };
    const archive = await runtime.app.inject({ url: "/api/builds/package-one/download", headers });
    expect(archive.statusCode).toBe(200); expect(archive.rawPayload).toEqual(expectedArchive);
    const original = await runtime.app.inject({ url: "/api/imports/source-one/original", headers });
    expect(original.statusCode).toBe(200); expect(original.rawPayload).toEqual(expectedOriginal);
    const record = JSON.parse((runtime.store.db.prepare("SELECT record FROM imported_sources").get() as { record: string }).record);
    expect(record.sourcePath).toBe(realpathSync(join(f.restored, "imports/source-one/original.step")));
    expect(readFileSync(join(f.restored, "clips/clip-one/product.mp4"))).toEqual(expectedClip);
  } finally { await runtime.app.close(); }
});

test("requires explicit stop confirmation and refuses an existing or nested destination", async () => {
  const f = await fixture();
  expect(run("backup", f.source, f.backup, false).output).toContain("confirm-stopped");
  expect(existsSync(f.backup)).toBe(false);
  mkdirSync(f.backup); writeFileSync(join(f.backup, "sentinel"), "preserve");
  expect(run("backup", f.source, f.backup).status).toBe(1);
  expect(readFileSync(join(f.backup, "sentinel"), "utf8")).toBe("preserve");
  expect(run("backup", f.source, join(f.source, "nested")).status).toBe(1);
});

test("rejects queued/running work without erasing reservation ledgers or creating a snapshot", async () => {
  const f = await fixture(); const db = new Database(join(f.source, "studio.sqlite"));
  db.prepare("UPDATE engineering_jobs SET job=json_set(job,'$.status','running')").run(); db.close();
  expect(run("backup", f.source, f.backup).output).toContain("queued or running");
  expect(existsSync(f.backup)).toBe(false);
  const check = new Database(join(f.source, "studio.sqlite"));
  expect(check.prepare("SELECT * FROM ai_usage").all()).toEqual(f.usage); check.close();
});

test("refuses missing ready artifacts, wrong original hash, external references and symlinks", async () => {
  const f = await fixture(); const archive = readFileSync(f.archive); rmSync(f.archive);
  expect(run("backup", f.source, f.backup).output).toContain("missing"); expect(existsSync(f.backup)).toBe(false);
  writeFileSync(f.archive, archive); writeFileSync(f.original, "changed bytes");
  expect(run("backup", f.source, f.backup).output).toContain("recorded hash");
  writeFileSync(f.original, "opaque original geometry fixture");
  const db = new Database(join(f.source, "studio.sqlite"));
  db.prepare("UPDATE builds SET archive=?").run(join(f.root, "external.zip")); db.close();
  expect(run("backup", f.source, f.backup).output).toContain("outside");
  const reset = new Database(join(f.source, "studio.sqlite")); reset.prepare("UPDATE builds SET archive=?").run(f.archive); reset.close();
  symlinkSync(f.archive, join(f.source, "builds", "linked.zip"));
  expect(run("backup", f.source, f.backup).output).toContain("symlinks"); expect(existsSync(f.backup)).toBe(false);
});

test("restore rejects corrupt or incomplete snapshots and cannot overwrite a live directory", async () => {
  const f = await fixture(); expect(run("backup", f.source, f.backup).status).toBe(0);
  mkdirSync(f.restored); writeFileSync(join(f.restored, "sentinel"), "preserve");
  expect(run("restore", f.backup, f.restored).status).toBe(1); expect(readFileSync(join(f.restored, "sentinel"), "utf8")).toBe("preserve");
  rmSync(f.restored, { recursive: true });
  const copied = join(f.backup, "clips/clip-one/product.mp4"), content = readFileSync(copied);
  writeFileSync(copied, "corrupt"); expect(run("restore", f.backup, f.restored).output).toContain("mismatch"); expect(existsSync(f.restored)).toBe(false);
  writeFileSync(copied, content); rmSync(copied);
  expect(run("restore", f.backup, f.restored).output).toContain("incomplete");
});

test("rejects manifest traversal and artifact directory symlinks", async () => {
  const f = await fixture(); expect(run("backup", f.source, f.backup).status).toBe(0);
  const file = join(f.backup, "manifest.json"), manifest = JSON.parse(readFileSync(file, "utf8"));
  manifest.files["../outside"] = { bytes: 1, sha256: "a".repeat(64) }; writeFileSync(file, JSON.stringify(manifest));
  expect(run("restore", f.backup, f.restored).status).toBe(1); expect(existsSync(f.restored)).toBe(false);
  symlinkSync(f.root, join(f.source, "imports", "external"));
  expect(run("backup", f.source, join(f.root, "second-backup")).output).toContain("symlinks");
});


test("malformed manifest structures fail cleanly before creating restored data", async () => {
  const f = await fixture(); expect(run("backup", f.source, f.backup).status).toBe(0);
  const file = join(f.backup, "manifest.json"), original = JSON.parse(readFileSync(file, "utf8"));
  for (const value of [[], { ...original, files: { ...original.files, "studio.sqlite": null } }, { ...original, runtimePaths: { relative: "builds/x.zip" } }]) {
    writeFileSync(file, JSON.stringify(value));
    const result = run("restore", f.backup, f.restored);
    expect(result.status).toBe(1); expect(result.output).not.toContain("Traceback"); expect(existsSync(f.restored)).toBe(false);
  }
});
