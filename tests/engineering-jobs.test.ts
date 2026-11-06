import { test,expect } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
const part={id:'arm',name:'Test arm',shape:'box',size:[100,5,10],position:[0,0,0],color:'#6caad0',material:'Aluminum',process:'machine'};
test('study API uses actual immutable geometry, protects results, preserves invalid-input diagnostics and marks older results',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'hardware-study-'));const {app}=await createApp({dataDir:dir,serveStatic:false,aiKey:''});
 try{
  const created=(await app.inject({method:'POST',url:'/api/designs',payload:{kind:'custom',name:'Study fixture',customParts:[part]}})).json();
  const {snapshot,access}=created,id=snapshot.design.id,headers={authorization:'Bearer '+access.editorToken};
  const request={type:'strength',partId:'arm',revision:0,source:{designId:'forged',revision:99},material:{name:'Test alloy',youngModulusMPa:70000,poissonRatio:.3,densityKgM3:2700},supports:[{axis:'x',side:'min'}],loads:[{axis:'x',side:'max',forceN:[0,-1,0]}],mesh:{maxSizeMm:7,refinements:1}};
  expect((await app.inject({method:'POST',url:`/api/designs/${id}/studies`,headers:{authorization:'Bearer '+access.viewerToken},payload:request})).statusCode).toBe(403);
  const response=await app.inject({method:'POST',url:`/api/designs/${id}/studies`,headers,payload:request});expect(response.statusCode).toBe(202);const job=response.json();
  expect((await app.inject({method:'GET',url:'/api/studies/'+job.id})).statusCode).toBe(403);
  let result:any;
  for(let i=0;i<200;i++){result=(await app.inject({method:'GET',url:'/api/studies/'+job.id,headers})).json();if(!['queued','running'].includes(result.status))break;await new Promise(r=>setTimeout(r,100));}
  expect(result.status,result.error||JSON.stringify(result.result)).toBe('ready');expect(['solved','unconverged']).toContain(result.result.status);expect(result.designId).toBe(id);expect(result.revision).toBe(0);expect(result.result.maxDisplacementMm).toBeGreaterThan(.04);expect(result.result.maxDisplacementMm).toBeLessThan(.05);
  expect(result.result.mesh.surface.length).toBeGreaterThan(0);expect(result.stale).toBe(false);
  const changed={...part,size:[100,6,10]};
  const edit=await app.inject({method:'POST',url:`/api/designs/${id}/commands`,headers,payload:{id:'thicker',actor:'Tester',baseRevision:0,changes:{},readSet:snapshot.design.params,customParts:[changed]}});expect(edit.statusCode).toBe(200);
  expect((await app.inject({method:'GET',url:'/api/studies/'+job.id,headers})).json().stale).toBe(true);
  const invalid=(await app.inject({method:'POST',url:`/api/designs/${id}/studies`,headers,payload:{type:'strength',partId:'arm',revision:1}})).json();
  for(let i=0;i<100;i++){result=(await app.inject({method:'GET',url:'/api/studies/'+invalid.id,headers})).json();if(!['queued','running'].includes(result.status))break;await new Promise(r=>setTimeout(r,100));}
  expect(result.status,result.error||JSON.stringify(result.result)).toBe('ready');expect(result.result.status).toBe('needs_inputs');
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
},60000);
