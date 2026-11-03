import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server/app';
const fixtures: {root:string;runtime:Awaited<ReturnType<typeof createApp>>}[]=[];
async function setup(){const root=mkdtempSync(join(tmpdir(),'build-recovery-'));const runtime=await createApp({dataDir:root,serveStatic:false,aiKey:''});fixtures.push({root,runtime});return {root,...runtime};}
afterEach(async()=>{for(const f of fixtures.splice(0)){await f.runtime.app.close();rmSync(f.root,{recursive:true,force:true});}});
it('returns only the latest job for an authorized design, including empty and failed states',async()=>{
 const {app,store}=await setup();const a=store.create('turntable'),b=store.create('lamp');
 const read=(id:string,token:string)=>app.inject({method:'GET',url:`/api/designs/${id}/builds/latest`,headers:{authorization:`Bearer ${token}`}});
 expect((await read(a.snapshot.design.id,a.access.editorToken)).json()).toBeNull();
 store.setBuild({id:'old',designId:a.snapshot.design.id,revision:0,status:'ready',downloadUrl:'/api/builds/old/download'},'/private/internal/archive.zip');
 store.setBuild({id:'new',designId:a.snapshot.design.id,revision:1,status:'failed',error:'Build interrupted.'});
 store.setBuild({id:'other',designId:b.snapshot.design.id,revision:8,status:'ready'});
 // Updating an older package must not reorder it ahead of a newer request.
 store.setBuild({id:'old',designId:a.snapshot.design.id,revision:0,status:'ready'});
 for(const token of [a.access.editorToken,a.access.viewerToken]){
  const response=await read(a.snapshot.design.id,token);expect(response.statusCode).toBe(200);expect(response.json()).toEqual({id:'new',designId:a.snapshot.design.id,revision:1,status:'failed',error:'Build interrupted.'});expect(response.body).not.toContain('archive');
 }
 for(const token of ['', 'invalid',b.access.editorToken])expect((await read(a.snapshot.design.id,token)).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:`/api/designs/${a.snapshot.design.id}/build`,headers:{authorization:`Bearer ${a.access.viewerToken}`}})).statusCode).toBe(403);
});
it('retains ready package discovery across a real database reopen',async()=>{
 const first=await setup();const a=first.store.create('turntable');const job={id:'retained',designId:a.snapshot.design.id,revision:3,status:'ready' as const,downloadUrl:'/api/builds/retained/download'};first.store.setBuild(job);
 await first.app.close();fixtures.pop();
 const runtime=await createApp({dataDir:first.root,serveStatic:false,aiKey:''});fixtures.push({root:first.root,runtime});
 const response=await runtime.app.inject({method:'GET',url:`/api/designs/${a.snapshot.design.id}/builds/latest`,headers:{authorization:`Bearer ${a.access.viewerToken}`}});expect(response.json()).toEqual(job);
});
