import {test,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/store';
import {propose} from '../server/proposals';
import {deskArmParts} from '../src/shared/desk-arm';
afterEach(()=>vi.unstubAllGlobals());
test('small model part updates preserve holes and every unmentioned component; user-facing prompt carries copy rules',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'proposal-part-')),store=new Store(join(dir,'s.sqlite'));let sent:any;
 try{
 const {snapshot}=store.create('custom','Camera arm',deskArmParts());
 vi.stubGlobal('fetch',vi.fn(async(_url:any,options:any)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({changes:{},partChanges:[{id:'upper-arm',size:[110,6,24]}],explanation:'The upper link is now 6 mm thick. Its holes and position are unchanged.',questions:[]})}}],usage:{prompt_tokens:0,completion_tokens:0}}),{status:200});}));
 const result=await propose(store,snapshot,{prompt:'Change upper-arm thickness from4 to6 mm',actor:'Owner'},'test-credential');
 expect(result.command.customParts!.find(p=>p.id==='upper-arm')!.size[1]).toBe(6);
 expect(result.command.customParts!.find(p=>p.id==='upper-arm')!.holes).toEqual(snapshot.design.customParts!.find(p=>p.id==='upper-arm')!.holes);
 expect(result.command.customParts!.filter(p=>p.id!=='upper-arm')).toEqual(snapshot.design.customParts!.filter(p=>p.id!=='upper-arm'));
 expect(sent.messages[0].content).toContain('at most 60 words');expect(sent.messages[0].content).toContain('no middle-dot separators');expect(sent.messages[0].content).toContain('no internal identifiers or hashes');expect(sent.messages[0].content).toContain('fully specified dimensional edit');
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test.each([{id:'missing',size:[10,10,10]},{id:'upper-arm',holes:[]},{id:'upper-arm',size:[110,-6,24]}])('rejects unknown, unsupported or invalid part updates',async update=>{
 const dir=mkdtempSync(join(tmpdir(),'proposal-part-')),store=new Store(join(dir,'s.sqlite'));
 try{const {snapshot}=store.create('custom','Camera arm',deskArmParts());vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({changes:{},partChanges:[update],questions:[]})}}],usage:{prompt_tokens:0,completion_tokens:0}}),{status:200})));await expect(propose(store,snapshot,{prompt:'Change the link',actor:'Owner'},'test-credential')).rejects.toThrow();expect(store.get(snapshot.design.id).design.revision).toBe(0);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
