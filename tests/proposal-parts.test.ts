import {test,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/store';
import {propose} from '../server/proposals';
import {deskArmParts} from '../src/shared/desk-arm';
afterEach(()=>vi.unstubAllGlobals());
const reply=(proposal:unknown)=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(proposal)}]}],usage:{input_tokens:0,output_tokens:0}});
test('small model part updates preserve holes and every unmentioned component; user-facing prompt carries copy rules',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'proposal-part-')),store=new Store(join(dir,'s.sqlite'));let sent:any;
 try{
 const {snapshot}=store.create('custom','Camera arm',deskArmParts());
 vi.stubGlobal('fetch',vi.fn(async(_url:any,options:any)=>{if(_url.endsWith("/input_tokens")) return new Response(JSON.stringify({input_tokens:1000}));sent=JSON.parse(options.body);return new Response(JSON.stringify(reply({changes:{},partChanges:[{id:'upper-arm',size:[110,6,24]}],explanation:'The upper link is now 6 mm thick. Its holes and position are unchanged.',questions:[]})),{status:200});}));
 const result=await propose(store,snapshot,{prompt:'Change upper-arm thickness from4 to6 mm',actor:'Owner'},'test-credential');
 expect(result.command.customParts!.find(p=>p.id==='upper-arm')!.size[1]).toBe(6);
 expect(result.command.customParts!.find(p=>p.id==='upper-arm')!.holes).toEqual(snapshot.design.customParts!.find(p=>p.id==='upper-arm')!.holes);
 expect(result.command.customParts!.filter(p=>p.id!=='upper-arm')).toEqual(snapshot.design.customParts!.filter(p=>p.id!=='upper-arm'));
 expect(sent.instructions).toContain('at most 60 words');expect(sent.instructions).toContain('no middle-dot separators');expect(sent.instructions).toContain('no internal identifiers or hashes');expect(sent.instructions).toContain('fully specified dimensional edit');
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test.each([{id:'missing',size:[10,10,10]},{id:'upper-arm',holes:[]},{id:'upper-arm',size:[110,-6,24]}])('rejects unknown, unsupported or invalid part updates',async update=>{
 const dir=mkdtempSync(join(tmpdir(),'proposal-part-')),store=new Store(join(dir,'s.sqlite'));
 try{const {snapshot}=store.create('custom','Camera arm',deskArmParts());vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/input_tokens')?{input_tokens:1000}:reply({changes:{},partChanges:[update],questions:[]})),{status:200})));await expect(propose(store,snapshot,{prompt:'Change the link',actor:'Owner'},'test-credential')).rejects.toThrow();expect(store.get(snapshot.design.id).design.revision).toBe(0);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('targeted local requests never replace an assembly, while explicit whole-design fallback remains available', async()=>{
 const dir=mkdtempSync(join(tmpdir(),'targeted-local-')),store=new Store(join(dir,'s.sqlite'));
 try {
  const {snapshot}=store.create('custom','Camera arm',deskArmParts());
  const selection={designId:snapshot.design.id,revision:0,partIds:['upper-arm'],source:'hover' as const};
  const request={prompt:'Make this box 40 x 20 x 30 mm',actor:'Owner'};
  const targeted=await propose(store,snapshot,{...request,selection},'');
  expect(targeted.command.customParts).toBeUndefined();expect(targeted.command.changes).toEqual({});
  expect(targeted.explanation).toContain('part controls');
  const whole=await propose(store,snapshot,request,'');expect(whole.command.customParts).toHaveLength(1);
  await expect(propose(store,snapshot,{...request,selection:{...selection,revision:1}},'')).rejects.toThrow('Select the part again');
  await expect(propose(store,snapshot,{...request,selection:{...selection,partIds:['removed']}},'')).rejects.toThrow('no longer');
 } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
