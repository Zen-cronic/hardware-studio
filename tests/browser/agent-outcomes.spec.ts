import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../server/app";
import { recordedPrompt, seedAgentOutcomes } from "../helpers/agent-outcome-fixture";
test.use({ channel: "chrome" });
for (const width of [1440,375]) test(`recorded role results and stale studies remain readable at ${width}px after acceptance`,async({browser},info)=>{
 const dataDir=mkdtempSync(join(tmpdir(),"outcomes-browser-"));
 const {app,store}=await createApp({dataDir,aiKey:""});
 const f=seedAgentOutcomes(store);await app.listen({host:"127.0.0.1",port:4206});
 const context=await browser.newContext({viewport:{width,height:width===375?812:1000},reducedMotion:"reduce"});
 const errors:string[]=[],external:string[]=[];
 await context.route("**/*",route=>{const url=new URL(route.request().url());if(url.origin==="http://127.0.0.1:4206")return route.continue();external.push(url.origin);return route.abort();});
 await context.routeWebSocket("**/*",socket=>{if(new URL(socket.url()).port==="4206")socket.connectToServer();else socket.close();});
 const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
 try{
  await page.goto(`http://127.0.0.1:4206/develop/${f.owner.snapshot.design.id}#token=${f.owner.access.editorToken}`);
  await page.getByRole("button",{name:"Proposed versions",exact:true}).click();
  await page.getByRole("button",{name:"Camera arm proposal / open",exact:true}).click();
  const outcomes=page.getByRole("region",{name:"Recorded agent outcomes"});
  const designer=outcomes.getByRole("article",{name:"Designer contribution"}),engineer=outcomes.getByRole("article",{name:"Engineer contribution"});
  await expect(designer).toContainText("110 × 4 × 24 → 110 × 6 × 24 mm");
  await expect(designer).toContainText("2 × Ø6.4 mm holes unchanged");
  await expect(engineer).toContainText("No additional geometry change.");
  await expect(outcomes).toContainText("8 manufacturing studies, r1");
  await expect(outcomes).toContainText("8 studies predate current r2");
  await expect(outcomes).toContainText("8 ready, 8 solved, 0 findings");
  expect(await designer.innerText()).not.toContain(recordedPrompt);
  await expect(outcomes.getByText("Input: "+recordedPrompt,{exact:true})).not.toBeVisible();
  await expect(page.getByText(recordedPrompt,{exact:true}).first()).not.toBeVisible();
  await outcomes.getByText("Inspect saved study results",{exact:true}).focus();await page.keyboard.press("Enter");
  await expect(outcomes.locator("li")).toHaveCount(8);await expect(outcomes.locator("li").first()).toContainText("ready / solved / 0 findings");await expect(outcomes.locator("li").first()).toContainText("Example CNC profile");await expect(outcomes.locator("li").first()).toContainText("Workholding requires review");await expect(outcomes.locator("li").first()).toContainText("Checks compare the recorded r1 geometry to the displayed process profile.");await expect(outcomes.locator("li").first()).not.toContainText("Checks compare the current geometry");await expect(outcomes.locator("li").first()).not.toContainText("recorded r2 geometry");expect(f.studies[0].result.assumptions[0]).toBe("Checks compare the current geometry to the displayed process profile.");
  await page.keyboard.press("Enter");
  await outcomes.scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("recorded-outcomes.png"),fullPage:true});
  await outcomes.screenshot({path:info.outputPath("outcome-detail.png")});
  const old=f.versions.outcomes(f.view.version.id,f.owner.access.editorToken,()=>f.studies).contributions;
  await page.getByRole("button",{name:"Accept into main design",exact:true}).click();
  await expect(page.getByRole("button",{name:"Accept into main design",exact:true})).toHaveCount(0);
  await expect(designer).toContainText("110 × 4 × 24 → 110 × 6 × 24 mm");await expect(engineer).toContainText("No additional geometry change.");
  expect(f.versions.outcomes(f.view.version.id,f.owner.access.editorToken,()=>f.studies).contributions).toEqual(old);
  await outcomes.getByText("Run history and inputs (1)",{exact:true}).click();
  await expect(outcomes.getByText("Input: "+recordedPrompt,{exact:true})).toBeVisible();
  await expect(outcomes).toContainText("Completed roles: Designer, Engineer.");
  expect(errors).toEqual([]);expect(external).toEqual([]);
 }finally{await context.close();await app.close();rmSync(dataDir,{recursive:true,force:true});}
});
test("same-revision source changes and incomplete study results never look like earlier solved evidence",async({browser})=>{
 const dataDir=mkdtempSync(join(tmpdir(),"outcomes-status-"));const {app,store}=await createApp({dataDir,aiKey:""});const f=seedAgentOutcomes(store);
 const changes=[{status:"ready",result:{status:"unsupported_physics"}},{status:"ready",result:undefined},{status:"queued",result:undefined},{status:"failed",result:undefined},{status:"ready",setup:{importId:"missing-source"}},{status:"cancelled",result:undefined},{status:"ready"},{status:"running",result:undefined}];
 f.studies.forEach((study,index)=>{const job={...study,revision:2,...changes[index]};store.db.prepare("UPDATE engineering_jobs SET job=? WHERE id=?").run(JSON.stringify(job),study.id);});
 await app.listen({host:"127.0.0.1",port:4206});const context=await browser.newContext({viewport:{width:375,height:812},reducedMotion:"reduce"});const page=await context.newPage(),errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 try{
  await page.goto(`http://127.0.0.1:4206/develop/${f.owner.snapshot.design.id}#token=${f.owner.access.editorToken}`);await page.getByRole("button",{name:"Proposed versions",exact:true}).click();await page.getByRole("button",{name:"Camera arm proposal / open",exact:true}).click();
  const outcomes=page.getByRole("region",{name:"Recorded agent outcomes"});await expect(outcomes).toContainText("Source changed");await expect(outcomes).toContainText("1 study needs review after a source change at r2");await expect(outcomes).not.toContainText("Earlier design");await expect(outcomes).not.toContainText("predate");
  await expect(outcomes).toContainText("1 queued");await expect(outcomes).toContainText("1 failed");await expect(outcomes).toContainText("1 Unsupported physics");await expect(outcomes).toContainText("1 result unavailable");
  await outcomes.getByText("Inspect saved study results",{exact:true}).click();await expect(outcomes.locator("li").filter({hasText:"result unavailable"})).toHaveCount(1);await expect(outcomes.locator("li").filter({hasText:"Source changed"})).toHaveCount(1);
  await page.getByRole("button",{name:"Reject version",exact:true}).click();await expect(page.getByRole("button",{name:"Reject version",exact:true})).toHaveCount(0);await expect(outcomes).toContainText("110 × 4 × 24 → 110 × 6 × 24 mm");expect(errors).toEqual([]);
 }finally{await context.close();await app.close();rmSync(dataDir,{recursive:true,force:true});}
});
