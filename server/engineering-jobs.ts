import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Store, HttpError } from "./store";
import { startCadWorker } from "./cad-worker";
import { resolveImportGeometry } from "./imports";
import type { Snapshot } from "../src/shared/types";
type TrustedGeometry = ReturnType<typeof resolveImportGeometry>;
export interface EngineeringJob {
  id: string; designId: string; revision: number; snapshotHash: string; partId?: string; setup?: any;
  type: "strength" | "manufacturing" | "mechanism";
  status: "queued" | "running" | "ready" | "failed" | "cancelled";
  createdAt: string; finishedAt?: string; error?: string; result?: any; stale?: boolean;
}
const token = (r: FastifyRequest) => r.headers.authorization?.replace(/^Bearer /, "") || "";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class EngineeringJobs {
  private queue: { job: EngineeringJob; input: any }[] = [];
  private active?: { job: EngineeringJob; worker: ReturnType<typeof startCadWorker>; done: Promise<void> };
  private stopping = false;
  constructor(private store: Store, private dataDir: string, private python: string) {
    store.db.exec("CREATE TABLE IF NOT EXISTS engineering_jobs(id TEXT PRIMARY KEY, design_id TEXT NOT NULL, job TEXT NOT NULL)");
    store.db.prepare("UPDATE engineering_jobs SET job=json_set(job,'$.status','failed','$.error','Analysis interrupted. Run the study again.') WHERE json_extract(job,'$.status') IN ('queued','running')").run();
  }
  private save(job: EngineeringJob) {
    this.store.db.prepare("INSERT INTO engineering_jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET job=excluded.job").run(job.id, job.designId, JSON.stringify(job));
  }
  get(id: string): EngineeringJob {
    const row = this.store.db.prepare("SELECT job FROM engineering_jobs WHERE id=?").get(id) as {job:string}|undefined;
    if (!row) throw new HttpError(404, "Study not found.");
    const job: EngineeringJob = JSON.parse(row.job);
    job.stale = this.isStale(job);
    return job;
  }
  private isStale(job:EngineeringJob){
    if(this.store.get(job.designId).design.revision!==job.revision)return true;
    if(job.setup?.importId){try{resolveImportGeometry(this.store,job.designId,job.setup.importId,{jobId:job.setup.importJobId,inputHash:job.setup.importInputHash});}catch{return true;}}
    return false;
  }
  list(designId: string): EngineeringJob[] {
    this.store.get(designId);
    return (this.store.db.prepare("SELECT json_remove(job,'$.result.mesh','$.result.displacement','$.result.vonMises','$.result.frames') AS summary FROM engineering_jobs WHERE design_id=? ORDER BY rowid DESC LIMIT 30").all(designId) as {summary:string}[]).map(r=>{const job=JSON.parse(r.summary);return {...job,stale:this.isStale(job)};});
  }
  submit(snapshot: Snapshot, body: any, geometry?: TrustedGeometry): EngineeringJob {
    if (!body || !["strength","manufacturing","mechanism"].includes(body.type)) throw new HttpError(422,"Choose a study type.");
    if (body.revision !== undefined && body.revision !== snapshot.design.revision) throw new HttpError(409,"The design changed. Review it before starting a study.");
    if (this.queue.length >= 8 || this.stopping) throw new HttpError(429,"Several studies are waiting. Please try again shortly.");
    const part = geometry ? undefined : snapshot.derived.parts.find(p=>p.id === body.partId);
    if (body.type === "strength" && !geometry && (!part || part.role === "reference")) throw new HttpError(422,"Select a physical component for strength analysis.");
    const snapshotHash = digest({ design:snapshot.design, parts:snapshot.derived.parts });
    const job: EngineeringJob = {id:randomUUID(),designId:snapshot.design.id,revision:snapshot.design.revision,snapshotHash,partId:part?.id,setup:{partId:geometry?undefined:part?.id,importId:geometry?.importId,importJobId:geometry?.importJobId,importInputHash:geometry?.importInputHash,importedSourceHash:geometry?.sourceHash,scaleToMm:geometry?.scaleToMm,bodyIndex:geometry?.bodyIndex,mesh:body.mesh,processProfile:body.processProfile,material:body.material,supports:body.supports,loads:body.loads,profile:body.profile,mechanism:body.mechanism},type:body.type,status:"queued",createdAt:new Date().toISOString()};
    const input = {geometry,type:body.type,source:{designId:job.designId,revision:job.revision,snapshotHash},snapshot:geometry?undefined:snapshot,part,partId:part?.id,material:body.material,supports:body.supports,loads:body.loads,mesh:body.mesh,profile:body.profile,processProfile:body.processProfile,mechanism:body.mechanism};
    if (JSON.stringify(input).length > 2_000_000) throw new HttpError(413,"This study is too large. Analyze one component at a time.");
    this.save(job); this.queue.push({job,input}); this.process(); return job;
  }
  cancel(id: string) {
    const job = this.get(id);
    if (!["queued","running"].includes(job.status)) return job;
    this.queue = this.queue.filter(w=>w.job.id!==id);
    this.save({...job,status:"cancelled",finishedAt:new Date().toISOString()});
    if (this.active?.job.id===id) this.active.worker.cancel();
    return this.get(id);
  }
  async wait(id: string) {
    for (;;) { const job=this.get(id); if (!["queued","running"].includes(job.status)) return job; await new Promise(r=>setTimeout(r,200)); }
  }
  private process() {
    if (this.active || this.stopping) return;
    const next=this.queue.shift(); if (!next) return;
    const {job,input}=next; const dir=join(this.dataDir,"engineering",job.id); mkdirSync(dir,{recursive:true});
    const file=join(dir,"input.json"); writeFileSync(file,JSON.stringify(input));
    this.save({...job,status:"running"});
    const rigidBody = input.type === "mechanism" && input.mechanism?.kind === "rigid_body";
    const worker=startCadWorker(rigidBody?process.execPath:this.python,rigidBody?["--import","tsx","server/mechanism-worker.ts",file]:["-m","cad.engineering","--input",file],{cwd:process.cwd(),timeoutMs:240000,maxOutputBytes:32_000_000,acceptedExitCodes:[0,2]});
    const done=(async()=>{
      try {
        const output=await worker.result;
        const result=JSON.parse(output.trim().split("\n").at(-1)||"");
        if (!result || typeof result.status!=="string") throw new Error("Analysis returned an unreadable result.");
        if (this.get(job.id).status!=="cancelled") this.save({...job,status:"ready",result,finishedAt:new Date().toISOString()});
      } catch(e) {
        if (this.get(job.id).status!=="cancelled") this.save({...job,status:"failed",error:e instanceof Error?e.message:"Analysis failed. Review the study and retry.",finishedAt:new Date().toISOString()});
      } finally { this.active=undefined; this.process(); }
    })();
    this.active={job,worker,done};
  }
  async close() { this.stopping=true; for(const w of this.queue.splice(0)) this.save({...w.job,status:"failed",error:"Analysis interrupted. Run the study again."}); this.active?.worker.cancel(); await this.active?.done; }
}
export function registerEngineeringRoutes(app:FastifyInstance,store:Store,jobs:EngineeringJobs) {
  app.get("/api/designs/:id/studies",async r=>{const id=String((r.params as any).id);store.authorize(id,token(r));return jobs.list(id);});
  app.post("/api/designs/:id/studies",async(r,reply)=>{const id=String((r.params as any).id);store.authorize(id,token(r),true);const body=r.body as any;const geometry=body?.importId?resolveImportGeometry(store,id,String(body.importId),{jobId:body.expectedImportJobId,inputHash:body.expectedImportInputHash}):undefined;return reply.code(202).send(jobs.submit(store.get(id),body,geometry));});
  app.get("/api/studies/:jobId",async r=>{const job=jobs.get(String((r.params as any).jobId));store.authorize(job.designId,token(r));return job;});
  app.post("/api/studies/:jobId/cancel",async r=>{const job=jobs.get(String((r.params as any).jobId));store.authorize(job.designId,token(r),true);return jobs.cancel(job.id);});
}
