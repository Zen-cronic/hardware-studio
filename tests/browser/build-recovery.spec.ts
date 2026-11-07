import { openDimensions } from './workspace-tools';
import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
test('real package survives a failed status request, reload, newer revision and viewer reopening',async({page,request,browser},info)=>{
 test.setTimeout(90000);
 const response=await request.post('/api/designs',{data:{kind:'custom',name:'Package recovery check'}});expect(response.status()).toBe(201);const created=await response.json();const id=created.snapshot.design.id;
 const path='/studio/'+id+'#token='+encodeURIComponent(created.access.editorToken);
 let builds=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/build'))builds++;});
 await page.goto(path);await page.getByRole('tab',{name:'Build',exact:true}).click();
 await expect(page.getByTestId('generate-build')).toBeEnabled();
 let failures=0;
 await page.route('**/api/builds/*',route=>{
  if(failures++===0)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary status interruption'})});
  return route.continue();
 });
 const buildResponse=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/build'));
 await page.getByTestId('generate-build').click();const job=await(await buildResponse).json();
 await expect(page.getByText('Could not check your package. Trying again…',{exact:true})).toBeVisible();
 const download=page.getByRole('link',{name:'Download package',exact:true});await expect(download).toBeVisible({timeout:60000});
 await expect(page.getByText('Could not check your package. Trying again…',{exact:true})).toHaveCount(0);
 const archive=await request.get('/api/builds/'+job.id+'/download',{headers:{Authorization:'Bearer '+created.access.editorToken}});expect(archive.status()).toBe(200);const originalHash=sha(await archive.body());
 await page.reload();await page.getByRole('tab',{name:'Build',exact:true}).click();await expect(download).toBeVisible();expect(await download.getAttribute('href')).toContain('/api/builds/'+job.id+'/download');expect(builds).toBe(1);
 await page.getByRole('tab',{name:'Design',exact:true}).click();{ await openDimensions(page); await page.getByTestId('param-scale').fill('1.2'); }await page.getByTestId('apply-dimensions').click();
 await expect(page.getByText('Design updated. Parts and assembly now match.')).toBeVisible();
 await page.getByRole('tab',{name:'Build',exact:true}).click();await expect(page.getByText('Revision 0 / An earlier version of this design',{exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('recovered-earlier-package.png')});
 const context=await browser.newContext({viewport:{width:375,height:812}});const viewer=await context.newPage();
 await viewer.goto('/studio/'+id+'#token='+encodeURIComponent(created.access.viewerToken));await viewer.getByRole('tab',{name:'Build',exact:true}).click();
 await expect(viewer.getByRole('link',{name:'Download package',exact:true})).toBeVisible();await expect(viewer.getByTestId('generate-build')).toBeDisabled();
 expect(await viewer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await viewer.screenshot({path:info.outputPath('viewer-recovered-package.png')});
 const current=await request.get('/api/builds/'+job.id+'/download',{headers:{Authorization:'Bearer '+created.access.viewerToken}});expect(sha(await current.body())).toBe(originalHash);
 await context.close();
 expect(builds).toBe(1);
});
test('viewer can inspect a failed package without receiving a retry action',async({page,request})=>{
 const response=await request.post('/api/designs',{data:{kind:'custom',name:'Failed package permissions'}});const created=await response.json();const id=created.snapshot.design.id;
 // Error-state UI fixture; real export/reload is exercised by the preceding test.
 await page.route('**/api/designs/'+id+'/builds/latest',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'failed-fixture',designId:id,revision:0,status:'failed',error:'Build interrupted. Please start a new package.'})}));
 await page.goto('/studio/'+id+'#token='+encodeURIComponent(created.access.viewerToken));await page.getByRole('tab',{name:'Build',exact:true}).click();
 await expect(page.getByText('Build interrupted. Please start a new package.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);await expect(page.getByTestId('generate-build')).toBeDisabled();
});
