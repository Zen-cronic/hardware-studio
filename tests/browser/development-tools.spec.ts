import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {deskArmParts} from '../../src/shared/desk-arm';

test('declared hinge produces actual bounded motion that can be played and scrubbed',async({page,request},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const response=await request.post('/api/designs',{data:{kind:'custom',name:'Hinge motion study',customParts:deskArmParts()}});
 expect(response.status()).toBe(201);const {snapshot,access}=await response.json();
 await page.goto(`/develop/${snapshot.design.id}#token=${access.editorToken}`);
 await page.getByRole('button',{name:'Mechanisms',exact:true}).click();
 await page.getByRole('spinbutton',{name:'Duration (seconds)',exact:true}).fill('1');
 await page.getByRole('spinbutton',{name:'Gravity Y (m/s²)',exact:true}).fill('0');
 await page.getByRole('button',{name:'Run mechanism study',exact:true}).click();
 const play=page.getByRole('button',{name:'Play result',exact:true});await expect(play).toBeVisible({timeout:30000});
 const scrub=page.getByRole('slider',{name:'Review motion',exact:true});await expect(scrub).toHaveValue('0');
 await scrub.fill('20');await expect(page.locator('.study-metrics dd')).not.toHaveText('0.0 °');
 await play.click();await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
 await expect(play).toBeVisible({timeout:5000});await expect(scrub).toHaveValue('20');
 await page.screenshot({path:info.outputPath('computed-hinge-motion.png'),fullPage:true});
 expect(errors).toEqual([]);
});

test('a real uploaded STEP plate becomes an editable design only after measured fit',async({page,request},info)=>{
 test.setTimeout(90000);const dir=mkdtempSync(join(tmpdir(),'studio-browser-import-')),file=join(dir,'mounting-plate.step');
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try {
  execFileSync(join(homedir(),'.pyenv/versions/.victoria-hardware/bin/python'),['-c',"import cadquery as cq,sys\nsolid=cq.Workplane('XZ').box(40,20,8).faces('>Y').workplane().hole(4)\ncq.exporters.export(solid,sys.argv[1])",file]);
  const response=await request.post('/api/designs',{data:{kind:'custom',name:'Imported mounting plate'}});expect(response.status()).toBe(201);
  const {snapshot,access}=await response.json();await page.goto(`/develop/${snapshot.design.id}#token=${access.editorToken}`);
  await page.getByRole('button',{name:'Import a design',exact:true}).click();await page.locator('input[type=file]').setInputFiles(file);
  await page.getByRole('button',{name:'Keep source and inspect',exact:true}).click();
  const measure=page.getByRole('button',{name:'Recognize and measure fit',exact:true});await expect(measure).toBeEnabled({timeout:30000});
  await measure.click();await expect(page.getByRole('heading',{name:'Measured fit passed',exact:true})).toBeVisible({timeout:40000});
  await page.screenshot({path:info.outputPath('source-and-measured-fit.png'),fullPage:true});
  await page.getByRole('button',{name:'Create editable design from this fit',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Design',exact:true})).toBeVisible();await expect(page.locator('.model-canvas')).toHaveAttribute('data-ready','true');
  await page.getByLabel('Choose a part from the list',{exact:true}).click();await page.getByLabel('Select a part',{exact:true}).getByRole('button').first().click();
  await expect(page.getByRole('region',{name:'Design guidance'})).toBeVisible();
  expect(errors).toEqual([]);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
