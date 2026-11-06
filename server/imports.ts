import type { FastifyInstance,FastifyRequest } from 'fastify';
import { createHash,randomUUID } from 'node:crypto';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { Store,HttpError } from './store';
import { startCadWorker } from './cad-worker';
import type { ImportRecord,ImportJob,ImportFormat,ReconstructionResult } from '../src/shared/imports';
const MAX_BYTES=8*1024*1024;
const token=(r:FastifyRequest)=>r.headers.authorization?.replace(/^Bearer /,'')||'';
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
interface StoredImport extends ImportRecord {sourcePath:string}
function stored(store:Store,id:string):StoredImport {
 const row=store.db.prepare('SELECT record FROM imported_sources WHERE id=?').get(id) as {record:string}|undefined;
 if(!row)throw new HttpError(404,'Imported source not found.');
 return JSON.parse(row.record);
}
function jobFromStore(store:Store,id:string):ImportJob {
 const row=store.db.prepare('SELECT job FROM import_jobs WHERE id=?').get(id) as {job:string}|undefined;
 if(!row)throw new HttpError(404,'Import operation not found.');return JSON.parse(row.job);
}
function bytes(record:StoredImport){const data=readFileSync(record.sourcePath);if(hash(data)!==record.sourceHash)throw new HttpError(409,'The stored source failed its integrity check. Upload it again.');return data;}
function scale(value:unknown){if(typeof value!=='number'||!Number.isFinite(value)||value<1e-6||value>1e6)throw new HttpError(422,'Choose explicit source units.');return value;}
/** Internal geometry resolver. Caller authorizes the design; no client path is accepted. */
export function resolveImportGeometry(store:Store,designId:string,importId:string,expected:{jobId:unknown;inputHash:unknown}){
 const record=stored(store,importId);if(record.designId!==designId)throw new HttpError(404,'This source is not attached to the design.');
 const job=jobFromStore(store,record.latestJobId);
 if(expected?.jobId!==job.id||typeof expected?.inputHash!=='string'||expected.inputHash!==job.result?.inputHash)throw new HttpError(409,'The source configuration changed. Reopen the import before analysis.');
 const body=job.result?.bodies?.find(b=>b.index===job.bodyIndex);
 if(job.status!=='ready'||!body||body.validationError)throw new HttpError(422,body?.validationError||'Inspect the selected solid before running a study.');
 bytes(record);
 return {path:record.sourcePath,format:record.format,scaleToMm:job.scaleToMm,bodyIndex:job.bodyIndex,sourceHash:record.sourceHash,importId:record.id,importJobId:job.id,importInputHash:job.result!.inputHash};
}
export class ImportJobs {
 private queue:{job:ImportJob;record:StoredImport}[]=[];
 private active?:{worker:ReturnType<typeof startCadWorker>;done:Promise<void>};
 private stopping=false;
 constructor(private store:Store,private dataDir:string,private python:string){
  store.db.exec(`CREATE TABLE IF NOT EXISTS imported_sources(id TEXT PRIMARY KEY,design_id TEXT NOT NULL,record TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS import_jobs(id TEXT PRIMARY KEY,import_id TEXT NOT NULL,job TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS import_acceptances(job_id TEXT PRIMARY KEY,input_hash TEXT NOT NULL,result TEXT NOT NULL);`);
  store.db.prepare("UPDATE import_jobs SET job=json_set(job,'$.status','failed','$.error','Import interrupted. Inspect or reconstruct the source again.') WHERE json_extract(job,'$.status') IN ('queued','running')").run();
 }
 private saveRecord(record:StoredImport){this.store.db.prepare('INSERT INTO imported_sources VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(record.id,record.designId,JSON.stringify(record));}
 private saveJob(job:ImportJob){this.store.db.prepare('INSERT INTO import_jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET job=excluded.job').run(job.id,job.importId,JSON.stringify(job));}
 get(id:string):ImportRecord {const {sourcePath,...record}=stored(this.store,id);return {...record,latestJob:jobFromStore(this.store,record.latestJobId)};}
 list(designId:string):ImportRecord[]{return (this.store.db.prepare('SELECT id FROM imported_sources WHERE design_id=? ORDER BY rowid DESC').all(designId) as {id:string}[]).map(({id})=>{const record=this.get(id);if(record.latestJob?.result){const {preview,candidatePreview,...result}=record.latestJob.result;record.latestJob={...record.latestJob,result};}return record;});}
 original(id:string){const record=stored(this.store,id);return {record:this.get(id),data:bytes(record)};}
 upload(designId:string,body:any){
  this.store.get(designId);this.capacity();
  const count=this.store.db.prepare('SELECT COUNT(*) AS count FROM imported_sources WHERE design_id=?').get(designId) as {count:number};
  if(count.count>=20)throw new HttpError(413,'A design can retain up to 20 source imports. Create another design for more.');
  if(typeof body?.filename!=='string'||body.filename.length>160||/[\x00-\x1f/\\]/.test(body.filename))throw new HttpError(422,'Choose a simple filename.');
  const extension=body.filename.split('.').at(-1)?.toLowerCase();const format=extension==='stp'?'step':extension;
  if(!['step','stl','obj','glb'].includes(format||''))throw new HttpError(422,'Choose a STEP, STL, OBJ or GLB file.');
  const initialScaleToMm=scale(body.scaleToMm);
  if(typeof body.contentBase64!=='string'||body.contentBase64.length>Math.ceil(MAX_BYTES/3)*4||!body.contentBase64.length||/[^A-Za-z0-9+/=]/.test(body.contentBase64)||body.contentBase64.length%4!==0)throw new HttpError(413,'Source must be valid base64 and no larger than 8 MB.');
  const data=Buffer.from(body.contentBase64,'base64');if(data.toString('base64')!==body.contentBase64||data.length>MAX_BYTES||!data.length)throw new HttpError(413,'Source must be 1 byte to 8 MB.');
  const id=randomUUID(),directory=resolve(this.dataDir,'imports',id);mkdirSync(directory,{recursive:true});
  const sourcePath=join(directory,'original.'+format);writeFileSync(sourcePath,data,{flag:'wx',mode:0o400});
  const record:StoredImport={id,designId,filename:body.filename,format:format as ImportFormat,byteLength:data.length,sourceHash:hash(data),initialScaleToMm,createdAt:new Date().toISOString(),latestJobId:'',sourcePath};
  this.saveRecord(record);this.enqueue(record,'inspect',{scaleToMm:initialScaleToMm,bodyIndex:0});return this.get(id);
 }
 reconstruct(id:string,body:any){const record=stored(this.store,id);this.enqueue(record,'reconstruct',body);return this.get(id);}
 private capacity(){if(this.stopping||this.queue.length>=8)throw new HttpError(429,'Several imports are waiting. Try again shortly.');}
 private enqueue(record:StoredImport,action:ImportJob['action'],body:any){
  this.capacity();if(record.latestJobId&&['queued','running'].includes(jobFromStore(this.store,record.latestJobId).status))throw new HttpError(409,'Wait for this source operation to finish.');
  const bodyIndex=body?.bodyIndex??0;if(!Number.isInteger(bodyIndex)||bodyIndex<0||bodyIndex>15)throw new HttpError(422,'Select a valid source body.');
  const scaleToMm=scale(body?.scaleToMm);const toleranceMm=action==='reconstruct'?body?.toleranceMm:undefined;
  if(action==='reconstruct'&&(typeof toleranceMm!=='number'||!Number.isFinite(toleranceMm)||toleranceMm<.001||toleranceMm>1))throw new HttpError(422,'Fit tolerance must be 0.001–1 mm.');
  bytes(record);const job:ImportJob={id:randomUUID(),importId:record.id,action,status:'queued',bodyIndex,scaleToMm,toleranceMm,createdAt:new Date().toISOString()};
  this.saveJob(job);record.latestJobId=job.id;this.saveRecord(record);this.queue.push({job,record});this.process();
 }
 accept(id:string,body:any){
  const record=stored(this.store,id);const job=jobFromStore(this.store,String(body?.jobId||''));
  if(job.importId!==id||job.id!==record.latestJobId||job.status!=='ready'||job.result?.status!=='reconstructed'||!job.result.fit?.accepted||!job.result.candidate)throw new HttpError(409,'Only the latest successfully fitted reconstruction can become editable.');
  if(body.expectedInputHash!==job.result.inputHash)throw new HttpError(409,'The reconstruction changed. Review its measured fit first.');
  bytes(record);
  const receipt=this.store.db.prepare('SELECT result FROM import_acceptances WHERE job_id=?').get(job.id) as {result:string}|undefined;if(receipt)return JSON.parse(receipt.result);
  const name=typeof body.name==='string'?body.name.trim():record.filename.replace(/\.[^.]+$/,'')+' reconstruction';if(!name||name.length>120)throw new HttpError(422,'Name must have 1–120 characters.');
  return this.store.db.transaction(()=>{
   const result=this.store.create('custom',name,[job.result!.candidate!]);
   const linkedId=randomUUID(),linkedJob={...job,id:randomUUID(),importId:linkedId};this.saveJob(linkedJob);
   this.saveRecord({...record,id:linkedId,designId:result.snapshot.design.id,originalImportId:record.originalImportId||record.id,latestJobId:linkedJob.id});
   this.store.db.prepare('INSERT INTO import_acceptances VALUES(?,?,?)').run(job.id,job.result!.inputHash,JSON.stringify(result));return result;
  })();
 }
 private process(){
  if(this.active||this.stopping)return;const next=this.queue.shift();if(!next)return;const {job,record}=next;
  const directory=resolve(this.dataDir,'imports',record.id,job.id);mkdirSync(directory,{recursive:true});const inputPath=join(directory,'input.json');
  writeFileSync(inputPath,JSON.stringify({action:job.action,geometry:{path:record.sourcePath,format:record.format,scaleToMm:job.scaleToMm},bodyIndex:job.bodyIndex,toleranceMm:job.toleranceMm}));
  this.saveJob({...job,status:'running'});
  const worker=startCadWorker(this.python,['-m','cad.reconstruction','--input',inputPath],{cwd:process.cwd(),timeoutMs:150000,maxOutputBytes:32_000_000,acceptedExitCodes:[0,2]});
  const done=(async()=>{try{
   const output=await worker.result;const result=JSON.parse(output.trim().split('\n').at(-1)||'') as ReconstructionResult;
   if(typeof result.status!=='string'||result.sourceHash!==record.sourceHash||!result.inputHash)throw new Error('Import did not return a source-bound result.');
   bytes(record);this.saveJob({...job,status:'ready',result,finishedAt:new Date().toISOString()});
  }catch(error){this.saveJob({...job,status:'failed',error:error instanceof Error?error.message:'Import failed.',finishedAt:new Date().toISOString()});}
  finally{this.active=undefined;this.process();}})();this.active={worker,done};
 }
 async close(){this.stopping=true;for(const {job} of this.queue.splice(0))this.saveJob({...job,status:'failed',error:'Import interrupted. Try again.'});this.active?.worker.cancel();await this.active?.done;}
}
export function registerImportRoutes(app:FastifyInstance,store:Store,jobs:ImportJobs){
 app.get('/api/designs/:id/imports',async r=>{const id=String((r.params as any).id);store.authorize(id,token(r));return jobs.list(id);});
 app.post('/api/designs/:id/imports',async(r,reply)=>{const id=String((r.params as any).id);store.authorize(id,token(r),true);return reply.code(202).send(jobs.upload(id,r.body));});
 app.get('/api/imports/:importId',async r=>{const record=jobs.get(String((r.params as any).importId));store.authorize(record.designId,token(r));return record;});
 app.get('/api/imports/:importId/original',async(r,reply)=>{const id=String((r.params as any).importId),record=jobs.get(id);store.authorize(record.designId,token(r));const original=jobs.original(id);return reply.header('Content-Type','application/octet-stream').header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(record.filename)}`).header('X-Source-SHA256',record.sourceHash).send(original.data);});
 app.post('/api/imports/:importId/reconstruct',async(r,reply)=>{const id=String((r.params as any).importId),record=jobs.get(id);store.authorize(record.designId,token(r),true);return reply.code(202).send(jobs.reconstruct(id,r.body));});
 app.post('/api/imports/:importId/accept',async r=>{const id=String((r.params as any).importId),record=jobs.get(id);store.authorize(record.designId,token(r),true);return jobs.accept(id,r.body);});
}
