import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";
import { readSetFor } from "../src/shared/engine";

type Runtime = Awaited<ReturnType<typeof createApp>>;
const fixtures: { root: string; app: Runtime["app"]; store: Runtime["store"] }[] = [];
async function until(check: () => boolean) {
  const end = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > end) throw new Error("Worker did not reach expected state");
    await new Promise((r) => setTimeout(r, 10));
  }
}
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "studio-build-queue-"));
  const python = join(root, "controlled-worker");
  // A real subprocess with a controlled release, not a CAD correctness fixture.
  writeFileSync(python, `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const root = ${JSON.stringify(root)};
const args = process.argv;
const output = args[args.indexOf('--output')+1];
const job = path.basename(path.dirname(output));
fs.appendFileSync(path.join(root, 'started'), job+'\\n');
const timer = setInterval(() => {
 const release = path.join(root, 'release-'+job);
 if (!fs.existsSync(release) && !fs.existsSync(path.join(root, 'release-all'))) return;
 clearInterval(timer);
 if (fs.existsSync(release) && fs.readFileSync(release,'utf8')==='fail') process.exit(2);
 fs.mkdirSync(output, {recursive:true});
 const archive = path.join(output,'fixture.zip');
 fs.writeFileSync(archive,'scheduling fixture only');
 console.log(JSON.stringify({ok:true,archive}));
}, 5);
`, { mode: 0o700 });
  const { app, store } = await createApp({ dataDir: root, python, serveStatic: false, aiKey: "" });
  const create = () => store.create("turntable");
  const request = (design: ReturnType<typeof create>, token = design.access.editorToken) => app.inject({
    method: "POST", url: `/api/designs/${design.snapshot.design.id}/build`, headers: { authorization: `Bearer ${token}` },
  });
  const state = (id: string) => store.getBuild(id).job.status;
  const release = (id: string, fail = false) => writeFileSync(join(root, "release-" + id), fail ? "fail" : "ok");
  const started = () => existsSync(join(root, "started")) ? readFileSync(join(root, "started"), "utf8").trim().split("\n") : [];
  const f = { root, app, store, create, request, state, release, started };
  fixtures.push(f);
  return f;
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    writeFileSync(join(f.root, "release-all"), "ok");
    await until(() => (f.store.db.prepare("SELECT COUNT(*) AS n FROM builds WHERE json_extract(job,'$.status') IN ('queued','running')").get() as {n:number}).n === 0);
    await f.app.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

describe("in-flight build reuse", () => {
  it("shares running and queued work across concurrent authorized requests, with distinct revisions and designs", async () => {
    const f = await setup(), a = f.create();
    const requests = await Promise.all(Array.from({length: 8}, () => f.request(a)));
    requests.forEach(r => expect(r.statusCode).toBe(200));
    const first = requests[0].json();
    expect(new Set(requests.map(r => r.json().id)).size).toBe(1);
    await until(() => f.started().includes(first.id));
    expect((await f.request(a)).json()).toMatchObject({id:first.id, status:"running"});
    for (const token of ["invalid", a.access.viewerToken]) expect((await f.request(a, token)).statusCode).toBe(403);
    f.store.apply(a.snapshot.design.id, { id:crypto.randomUUID(), actor:"Alex", baseRevision:0, changes:{rpm:4}, readSet:readSetFor(a.snapshot.design,{rpm:4}) });
    const second = (await f.request(a)).json();
    expect(second.id).not.toBe(first.id);
    expect(second).toMatchObject({revision:1,status:"queued"});
    expect((await f.request(a)).json().id).toBe(second.id);
    const b = f.create(), other = (await f.request(b)).json();
    expect(other.id).not.toBe(second.id);
    expect(other.revision).toBe(0);
    f.release(first.id);
    await until(() => f.state(first.id)==="ready" && f.state(second.id)==="running");
    expect((await f.request(a)).json().id).toBe(second.id);
    f.release(second.id); f.release(other.id);
    await until(() => f.state(other.id)==="ready");
    expect(f.started()).toEqual([first.id, second.id, other.id]);
  });
  it("allows fresh builds after failure and completion without reusing stale job IDs", async () => {
    const f = await setup(), a = f.create();
    const failed = (await f.request(a)).json(); f.release(failed.id, true);
    await until(() => f.state(failed.id)==="failed");
    const ready = (await f.request(a)).json();
    expect(ready.id).not.toBe(failed.id); f.release(ready.id);
    await until(() => f.state(ready.id)==="ready");
    const rebuild = (await f.request(a)).json();
    expect(rebuild.id).not.toBe(ready.id); f.release(rebuild.id);
    await until(() => f.state(rebuild.id)==="ready");
    expect(f.started()).toEqual([failed.id,ready.id,rebuild.id]);
  });
  it("returns existing work even when the waiting queue is full and still rejects new work", async () => {
    const f = await setup(), running = f.create();
    const first = (await f.request(running)).json();
    const queued = [];
    for(let i=0;i<13;i++) { const design=f.create(); const r=await f.request(design); expect(r.statusCode).toBe(200); queued.push({design,job:r.json()}); }
    const overflow = f.create();
    expect((await f.request(overflow)).statusCode).toBe(429);
    expect((await f.request(running)).json().id).toBe(first.id);
    const retry = await f.request(queued[12].design);
    expect(retry.statusCode).toBe(200); expect(retry.json().id).toBe(queued[12].job.id);
    expect((f.store.db.prepare('SELECT COUNT(*) AS n FROM builds').get() as {n:number}).n).toBe(14);
  });
});
