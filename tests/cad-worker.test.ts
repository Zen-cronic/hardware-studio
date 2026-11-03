import { afterEach, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { startCadWorker } from "../server/cad-worker";
import { createApp } from "../server/app";

const cleanups: (() => Promise<void>)[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "studio-worker-"));
  cleanups.push(async () => rmSync(root, { recursive: true, force: true }));
  return root;
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check: () => boolean) {
  const end = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > end) throw new Error("Worker state deadline");
    await new Promise((r) => setTimeout(r, 10));
  }
}
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function stubborn(root: string, output = "") {
  return `const fs=require('node:fs'); const root=${JSON.stringify(root)};
process.on('SIGTERM',()=>fs.writeFileSync(root+'/term','received'));
fs.writeFileSync(root+'/pid',String(process.pid));
${output}
setInterval(()=>{},1000);`;
}

it("preserves successful output and reports failed exits or spawn errors", async () => {
  expect(await startCadWorker(process.execPath, ["-e", "process.stdout.write('✓')"], {cwd:process.cwd()}).result).toBe("✓");
  await expect(startCadWorker(process.execPath, ["-e", "console.error('invalid solid');process.exit(2)"], {cwd:process.cwd()}).result).rejects.toThrow("invalid solid");
  await expect(startCadWorker("/missing/cad-interpreter", [], {cwd:process.cwd()}).result).rejects.toThrow(/ENOENT/);
});

it("times out even after plausible output and waits for an ignoring child to die", async () => {
  const root=fixture();
  const worker=startCadWorker(process.execPath,["-e",stubborn(root,"console.log('{}');")],{cwd:root,timeoutMs:1000,killGraceMs:80});
  const rejected=expect(worker.result).rejects.toThrow("too long");
  await rejected;
  expect(readFileSync(join(root,"term"),"utf8")).toBe("received");
  expect(alive(Number(readFileSync(join(root,"pid"),"utf8")))).toBe(false);
});

it("bounds output by bytes and kills an ignoring child before reporting overflow", async () => {
  const root=fixture();
  const worker=startCadWorker(process.execPath,["-e",stubborn(root,"process.stdout.write('漢'.repeat(20));")],{cwd:root,maxOutputBytes:32,killGraceMs:80});
  await expect(worker.result).rejects.toThrow("output exceeded");
  expect(existsSync(join(root,"term"))).toBe(true);
  expect(alive(Number(readFileSync(join(root,"pid"),"utf8")))).toBe(false);
});

it("cancels once and waits for termination before settling", async () => {
  const root=fixture();
  const worker=startCadWorker(process.execPath,["-e",stubborn(root)],{cwd:root,killGraceMs:80});
  const rejected=expect(worker.result).rejects.toThrow("interrupted");
  await until(()=>existsSync(join(root,"pid")));
  worker.cancel();worker.cancel();await rejected;worker.cancel();
  expect(existsSync(join(root,"term"))).toBe(true);
  expect(alive(Number(readFileSync(join(root,"pid"),"utf8")))).toBe(false);
});

async function appFixture(script: string) {
  const root=fixture(), path=join(root,"worker.cjs");
  writeFileSync(path,`#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');const root=${JSON.stringify(root)};\n`+script,{mode:0o700});
  const {app,store}=await createApp({dataDir:root,python:path,aiKey:"",serveStatic:false});
  cleanups.push(async()=>{await app.close();});
  const submit=async()=>{const d=store.create("turntable");const r=await app.inject({method:"POST",url:`/api/designs/${d.snapshot.design.id}/build`,headers:{authorization:`Bearer ${d.access.editorToken}`}});expect(r.statusCode).toBe(200);return r.json();};
  return {root,app,store,submit};
}

it("closes running and queued jobs before SQLite, even when the worker ignores SIGTERM", async () => {
  const f=await appFixture(`process.on('SIGTERM',()=>{});fs.writeFileSync(root+'/pid',String(process.pid));setInterval(()=>{},1000);`);
  await f.submit();await f.submit();
  await until(()=>existsSync(join(f.root,"pid")));
  await f.app.close();
  expect(alive(Number(readFileSync(join(f.root,"pid"),"utf8")))).toBe(false);
  const db=new Database(join(f.root,"studio.sqlite"),{readonly:true});
  try {
    const rows=(db.prepare('SELECT job FROM builds').all() as {job:string}[]).map(r=>JSON.parse(r.job));
    expect(rows).toHaveLength(2);
    for(const job of rows)expect(job).toMatchObject({status:"failed",error:expect.stringContaining("interrupted")});
  } finally { db.close(); }
});

it("starts the next queued worker only after an overflowing child exits", async () => {
  const f=await appFixture(`
const first=root+'/first-pid';
if(!fs.existsSync(first)) {
 process.on('SIGTERM',()=>{});fs.writeFileSync(first,String(process.pid));
 process.stdout.write('x'.repeat(1000001));setInterval(()=>{},1000);
} else {
 let overlap=false;try{process.kill(Number(fs.readFileSync(first,'utf8')),0);overlap=true;}catch{}
 fs.writeFileSync(root+'/overlap',String(overlap));
 const dir=process.argv[process.argv.indexOf('--output')+1];fs.mkdirSync(dir,{recursive:true});
 const archive=path.join(dir,'fixture.zip');fs.writeFileSync(archive,'scheduling fixture');console.log(JSON.stringify({ok:true,archive}));
}`);
  const first=await f.submit(), second=await f.submit();
  await until(()=>f.store.getBuild(second.id).job.status==="ready");
  expect(f.store.getBuild(first.id).job).toMatchObject({status:"failed",error:expect.stringContaining("output exceeded")});
  expect(readFileSync(join(f.root,"overlap"),"utf8")).toBe("false");
});
