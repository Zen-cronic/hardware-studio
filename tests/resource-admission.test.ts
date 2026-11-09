import { test, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ResourceAdmission } from "../server/resource-admission";
import { createApp } from "../server/app";
import { ClipJobs, createClipRenderer, type ClipRenderer } from "../server/clips";
import { Store } from "../server/store";
import { aiBudgetConfig, resourceConfig } from "../server/config";
import { startCadWorker } from "../server/cad-worker";
import { createHash } from "node:crypto";
import { canonicalClipSource, makeClipProject } from "../src/lib/clip-timeline";
const pause = () => new Promise(resolve=>setTimeout(resolve,10));
async function until(check:()=>boolean) { const end=Date.now()+5000; while(!check()){if(Date.now()>end)throw new Error("Fixture deadline");await pause();} }
const temp = () => mkdtempSync(join(tmpdir(),"studio-admission-"));
const alive = (pid:number) => {try{process.kill(pid,0);return true;}catch{return false;}};

test("shared reservations bound admitted work, preserve FIFO and cancel waiting work",async()=>{
 const gate=new ResourceAdmission({dataDir:tmpdir(),concurrency:1,queueLimit:2});
 const first=gate.reserve();await first.wait();const cancelled=gate.reserve(),third=gate.reserve();
 expect(()=>gate.reserve()).toThrow(/waiting/);
 const rejected=expect(cancelled.wait()).rejects.toThrow(/interrupted/);cancelled.cancel();await rejected;
 let acquired=false;const pending=third.wait().then(()=>{acquired=true;});await pause();expect(acquired).toBe(false);
 first.cancel();await pause();expect(acquired).toBe(false);expect(gate.stats().active).toBe(1);
 first.release();await pending;expect(acquired).toBe(true);third.release();third.release();
 expect(gate.stats()).toEqual({active:0,admitted:0,waiting:0});
});
test("disk checks fail closed before reservation and again when queued execution becomes eligible",async()=>{
 let free=100;const gate=new ResourceAdmission({dataDir:tmpdir(),minFreeDiskBytes:100,freeBytes:()=>free});
 const first=gate.reserve();await first.wait();const second=gate.reserve();const waiting=expect(second.wait()).rejects.toThrow(/nearly full/);
 free=99;expect(()=>gate.reserve()).toThrow(/nearly full/);first.release();await waiting;
 expect(gate.stats().admitted).toBe(0);free=100;const again=gate.reserve();await again.wait();again.release();
 const broken=new ResourceAdmission({dataDir:tmpdir(),minFreeDiskBytes:1,freeBytes:()=>{throw Error("filesystem unavailable");}});
 expect(()=>broken.reserve()).toThrow(/could not be checked/);
});
test("shutdown rejects every waiter, retains running capacity until completion and denies new jobs",async()=>{
 const gate=new ResourceAdmission({dataDir:tmpdir()});const active=gate.reserve();await active.wait();
 const queued=gate.reserve(),reserved=gate.reserve();const failure=expect(queued.wait()).rejects.toThrow(/restart/);
 gate.close();await failure;await expect(reserved.wait()).rejects.toThrow(/interrupted/);
 expect(()=>gate.reserve()).toThrow(/restarting/);expect(gate.stats()).toEqual({active:1,admitted:1,waiting:0});active.release();expect(gate.stats().admitted).toBe(0);
});
test("settings cap default AI allowance and reject invalid or unsafe resource/budget inputs",()=>{
 expect(resourceConfig({})).toEqual({concurrency:1,queueLimit:8,minFreeDiskBytes:0});expect(aiBudgetConfig({})).toEqual({budgetUsd:10,reservationUsd:1});
 expect(resourceConfig({MIN_FREE_DISK_BYTES:"5368709120"}).minFreeDiskBytes).toBe(5368709120);
 expect(aiBudgetConfig({AI_BUDGET_USD:"0"}).budgetUsd).toBe(0);
 for(const env of [{HEAVY_WORKER_CONCURRENCY:"0"},{HEAVY_WORKER_QUEUE_LIMIT:"-1"},{MIN_FREE_DISK_BYTES:"2.5"},{MIN_FREE_DISK_BYTES:"Infinity"}])expect(()=>resourceConfig(env)).toThrow();
 for(const env of [{AI_BUDGET_USD:"-1"},{AI_BUDGET_USD:" "},{AI_REQUEST_RESERVATION_USD:"0"},{AI_REQUEST_RESERVATION_USD:"0.01"}])expect(()=>aiBudgetConfig(env)).toThrow();
});
test("configured AI reservations are shared across DB connections and unknown charges retain their reservation",()=>{
 const dir=temp(),policy={budgetUsd:4,reservationUsd:2},a=new Store(join(dir,"s.sqlite"),policy),b=new Store(join(dir,"s.sqlite"),policy);
 try {a.reserveAi("one");b.reserveAi("two");expect(()=>a.reserveAi("three")).toThrow(/limit/);a.failAi("one",true);expect(()=>b.reserveAi("three")).toThrow(/limit/);
 a.failAi("one",false);b.reserveAi("three");expect((a.db.prepare("SELECT SUM(spent+reserved) AS total FROM ai_usage").get() as any).total).toBe(4);
 }finally{b.close();a.close();rmSync(dir,{recursive:true,force:true});}
});

test("low disk rejects every work route before new job/upload files or records are written",async()=>{
 const dir=temp(),gate=new ResourceAdmission({dataDir:dir,minFreeDiskBytes:100,freeBytes:()=>99});
 const {app,store}=await createApp({dataDir:dir,resources:gate,serveStatic:false,aiKey:""});
 try{
 const d=store.create("turntable"),headers={authorization:"Bearer "+d.access.editorToken},base="/api/designs/"+d.snapshot.design.id;
 const before=readdirSync(dir).sort();
 for(const [route,payload] of [["/build",{}],["/studies",{type:"manufacturing"}],["/clips",{revision:0}],["/imports",{filename:"fixture.step",scaleToMm:1,contentBase64:Buffer.from("fixture").toString("base64")}]] as const){
  const response=await app.inject({method:"POST",url:base+route,headers,payload});expect(response.statusCode,response.body).toBe(503);
 }
 expect(readdirSync(dir).sort()).toEqual(before);
 for(const table of ["builds","engineering_jobs","clips","imported_sources","import_jobs"])expect((store.db.prepare("SELECT COUNT(*) AS count FROM "+table).get() as any).count).toBe(0);
 expect(gate.stats().admitted).toBe(0);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test("CAD, engineering, imports and clips share real execution capacity and a cancelled study never spawns",async()=>{
 const dir=temp(),gate=new ResourceAdmission({dataDir:dir,queueLimit:4}),script=join(dir,"worker.cjs"),events=join(dir,"events.jsonl");
 writeFileSync(script,`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const events=${JSON.stringify(events)},root=${JSON.stringify(dir)},args=process.argv;
const type=args.includes('cad.build')?'cad':args.includes('cad.engineering')?'engineering':'import';
fs.appendFileSync(events,JSON.stringify({type,phase:'start',pid:process.pid})+String.fromCharCode(10));
const finish=()=>{fs.appendFileSync(events,JSON.stringify({type,phase:'finish',pid:process.pid})+String.fromCharCode(10));
if(type==='cad'){const dir=args[args.indexOf('--output')+1];fs.mkdirSync(dir,{recursive:true});const archive=path.join(dir,'fixture.zip');fs.writeFileSync(archive,'fixture');console.log(JSON.stringify({ok:true,archive}));}
else if(type==='engineering')console.log(JSON.stringify({status:'needs_inputs'}));
else{const input=JSON.parse(fs.readFileSync(args[args.indexOf('--input')+1],'utf8'));console.log(JSON.stringify({status:'inspected',sourceHash:crypto.createHash('sha256').update(fs.readFileSync(input.geometry.path)).digest('hex'),inputHash:'fixture'}));}};
const timer=setInterval(()=>{if(type!=='cad'||fs.existsSync(path.join(root,'release'))){clearInterval(timer);finish();}},20);
`,{mode:0o700});
 const {app,store}=await createApp({dataDir:dir,python:script,resources:gate,serveStatic:false,aiKey:""});
 let clipStarted=false;const renderer:ClipRenderer=async input=>{clipStarted=true;expect(gate.stats().active).toBe(1);writeFileSync(input.output,"fixture");return {frames:600,width:1920,height:1080,fps:30,durationSeconds:20,snapshotHash:input.project.snapshotHash};};
 const clips=new ClipJobs({store,dataDir:dir,resources:gate,renderer,serverBaseUrl:"http://127.0.0.1:4174"});
 try{
 const d=store.create("turntable"),headers={authorization:"Bearer "+d.access.editorToken},base="/api/designs/"+d.snapshot.design.id;
 const build=(await app.inject({method:"POST",url:base+"/build",headers,payload:{}})).json();await until(()=>existsSync(events));
 const cancelled=(await app.inject({method:"POST",url:base+"/studies",headers,payload:{type:"manufacturing"}})).json();
 const study=(await app.inject({method:"POST",url:base+"/studies",headers,payload:{type:"manufacturing"}})).json();
 const imported=(await app.inject({method:"POST",url:base+"/imports",headers,payload:{filename:"fixture.step",scaleToMm:1,contentBase64:Buffer.from("fixture").toString("base64")}})).json();
 const clip=clips.submit(d.snapshot,{revision:0});await pause();expect(clipStarted).toBe(false);
 expect((await app.inject({url:"/api/studies/"+cancelled.id,headers})).json().status).toBe("queued");
 expect((await app.inject({method:"POST",url:"/api/studies/"+cancelled.id+"/cancel",headers,payload:{}})).statusCode).toBe(200);
 writeFileSync(join(dir,"release"),"go");
 await until(()=>store.getBuild(build.id).job.status==="ready"&&clips.get(clip.id).status==="ready");
 await until(()=>gate.stats().admitted===0);
 const lines=readFileSync(events,"utf8").trim().split("\n").map(line=>JSON.parse(line));
 let running=0;for(const line of lines){running+=line.phase==='start'?1:-1;expect(running).toBeGreaterThanOrEqual(0);expect(running).toBeLessThanOrEqual(1);}expect(running).toBe(0);
 expect(lines.filter(e=>e.type==='engineering'&&e.phase==='start')).toHaveLength(1);expect(lines.filter(e=>e.type==='import'&&e.phase==='start')).toHaveLength(1);
 expect((await app.inject({url:"/api/studies/"+study.id,headers})).json().status).toBe("ready");
 expect((await app.inject({url:"/api/imports/"+imported.id,headers})).json().latestJob.status).toBe("ready");
 expect((await app.inject({url:"/api/studies/"+cancelled.id,headers})).json().status).toBe("cancelled");
 }finally{writeFileSync(join(dir,"release"),"go");await clips.close();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test.skipIf(process.platform==="win32")("a timed-out native child retains the shared slot until process death",async()=>{
 const dir=temp(),gate=new ResourceAdmission({dataDir:dir}),first=gate.reserve();await first.wait();
 const worker=startCadWorker(process.execPath,["-e",`const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(join(dir,"pid"))},String(process.pid));setInterval(()=>{},1000);`],{cwd:dir,timeoutMs:400,killGraceMs:120});
 const done=worker.result.finally(()=>first.release());const failed=expect(done).rejects.toThrow(/too long/);
 const second=gate.reserve();let entered=false;const next=second.wait().then(()=>{entered=true;expect(alive(Number(readFileSync(join(dir,"pid"),"utf8")))).toBe(false);second.release();});
 try{await until(()=>existsSync(join(dir,"pid")));expect(entered).toBe(false);await failed;await next;expect(gate.stats().admitted).toBe(0);}finally{worker.cancel();await failed;rmSync(dir,{recursive:true,force:true});}
});

 test("an uncertain failure preserves its original reservation after policy changes",()=>{
  const dir=temp(),path=join(dir,"s.sqlite");const before=new Store(path,{budgetUsd:4,reservationUsd:2});before.reserveAi("pending");before.close();
  const after=new Store(path,{budgetUsd:4,reservationUsd:1});
  try{after.failAi("pending",true);expect((after.db.prepare("SELECT reserved FROM ai_usage WHERE id='pending'").get() as any).reserved).toBe(2);after.failAi("pending",false);expect((after.db.prepare("SELECT reserved FROM ai_usage WHERE id='pending'").get() as any).reserved).toBe(0);}finally{after.close();rmSync(dir,{recursive:true,force:true});}
 });

test.skipIf(process.platform === "win32")("production clip cancellation waits for a native descendant after its parent exits",async()=>{
 const dir=temp(),store=new Store(join(dir,"db.sqlite")),gate=new ResourceAdmission({dataDir:dir});
 const snapshot=store.create("turntable").snapshot,project=makeClipProject(snapshot,createHash("sha256").update(canonicalClipSource(snapshot)).digest("hex"));
 const script=join(dir,"renderer-fixture.cjs"),parentPid=join(dir,"parent.pid"),descendantPid=join(dir,"descendant.pid");
 const descendant=`const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(descendantPid)},String(process.pid));setInterval(()=>{},1000);`;
 writeFileSync(script,`const fs=require('node:fs');require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(parentPid)},String(process.pid));setInterval(()=>{},1000);`);
 const controller=new AbortController(),first=gate.reserve();await first.wait();
 const done=createClipRenderer(script,250)({project,input:join(dir,"project.json"),output:join(dir,"product.mp4"),url:"http://127.0.0.1:4174/render-clip",signal:controller.signal,progress:()=>{}}).finally(()=>first.release());
 const failure=expect(done).rejects.toThrow(/cancelled/);const second=gate.reserve();let entered=false;
 const next=second.wait().then(()=>{entered=true;expect(alive(Number(readFileSync(parentPid,"utf8")))).toBe(false);expect(alive(Number(readFileSync(descendantPid,"utf8")))).toBe(false);second.release();});
 try {await until(()=>existsSync(descendantPid));controller.abort();await new Promise(resolve=>setTimeout(resolve,50));expect(entered).toBe(false);expect(gate.stats().active).toBe(1);await failure;await next;expect(gate.stats().admitted).toBe(0);}
 finally {controller.abort();await failure;store.close();rmSync(dir,{recursive:true,force:true});}
},10000);
