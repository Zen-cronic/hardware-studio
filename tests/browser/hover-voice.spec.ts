import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { openPrompt, closePanels, openDimensions } from "./workspace-tools";
test.use({ video: { mode: "on", size: { width: 1440, height: 1000 } } });
const evidence = process.env.HOVER_EVIDENCE;
const parts = [
 {id:"left",name:"Mounting plate",shape:"box",size:[40,10,45],position:[-40,5,0],color:"#A2C7FF",material:"PETG",process:"print"},
 {id:"right",name:"Support block",shape:"box",size:[30,40,30],position:[40,20,0],color:"#245BA8",material:"PETG",process:"print"},
 {id:"hidden",name:"Interior spacer",shape:"box",size:[5,5,5],position:[40,20,0],color:"#A2C7FF",material:"PETG",process:"print"},
];
async function open(page:Page,request:APIRequestContext,viewer=false,customParts:any[]=parts){
 await page.addInitScript(()=>{
  const w=window as any;w.__speech=[];
  w.SpeechRecognition=class {continuous=false;interimResults=false;onstart?:()=>void;onend?:()=>void;constructor(){w.__speech.push(this);}start(){this.onstart?.();}stop(){this.onend?.();}abort(){this.onend?.();}};
 });
 const r=await request.post("/api/designs",{data:{kind:"custom",name:"Component housing",customParts}});expect(r.status()).toBe(201);const data=await r.json();
 await page.goto(`/studio/${data.snapshot.design.id}#token=${encodeURIComponent(viewer?data.access.viewerToken:data.access.editorToken)}`);
 await expect(page.locator(".model-canvas")).toHaveAttribute("data-ready","true");return data;
}
async function emit(page:Page,event:"speech"|"final"|"partial"|"error",text="Make this block 40 x 20 x 30 mm"){
 await page.evaluate(({event,text})=>{const r=(window as any).__speech.at(-1);if(event==="speech")r.onspeechstart?.();else if(event==="error")r.onerror?.({error:text});else {const result:any=[{transcript:text}];result.isFinal=event==="final";r.onresult?.({results:[result]});}},{event,text});
}
async function hoverPart(page:Page,id:string){
 const box=(await page.locator(".model-canvas canvas").boundingBox())!;
 for(const y of [.5,.65,.4,.75,.3])for(const x of [.35,.65,.45,.55,.25,.75,.15,.85]){
  await page.mouse.move(box.x+box.width*x,box.y+box.height*y);
  if(await page.locator(".model-canvas").getAttribute("data-hovered-part")===id)return {x:box.x+box.width*x,y:box.y+box.height*y};
 }
 throw new Error("Visible part not found: "+id);
}
async function circle(page:Page){
 await page.getByRole("button",{name:"Circle a part",exact:true}).click();const box=(await page.getByTestId("circle-selection-overlay").boundingBox())!;
 await page.mouse.move(box.x+10,box.y+60);await page.mouse.down();for(const [x,y]of [[box.width-10,60],[box.width-10,box.height-10],[10,box.height-10],[10,60]])await page.mouse.move(box.x+x,box.y+y,{steps:6});await page.mouse.up();
 await expect(page.getByRole("region",{name:"Choose circled parts"})).toBeVisible();
}
async function capture(page:Page,name:string){if(evidence){
 // Let the existing panel transition and ResizeObserver camera fit finish before the evidence frame.
 await page.waitForTimeout(350);await page.screenshot({path:`${evidence}/${name}.png`,fullPage:true});
}}

test("SYNTHETIC: hover front surface without click, freeze speech-onset target, review before accept",async({page,request})=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));const d=await open(page,request);let sent:any;
 await page.route("**/propose",async route=>{sent=route.request().postDataJSON();await route.fulfill({json:{source:"ai",explanation:"The mounting plate is now 12 mm thick. Review the proposed geometry.",questions:[],command:{id:"synthetic-proposal",actor:"Maker",baseRevision:0,changes:{},readSet:d.snapshot.design.params,customParts:parts.map(p=>p.id==="left"?{...p,size:[40,12,45]}:p),summary:"Change mounting plate thickness"}}});});
 await page.getByRole("button",{name:"Speak an instruction",exact:true}).click();
 await hoverPart(page,"left");await expect(page.locator(".part-selection")).toHaveCount(0);await capture(page,"after-hover");
 await emit(page,"speech");await expect(page.getByTestId("voice-status")).toHaveText(/^Listening about Mounting plate · .+\.$/);
 const locked=await page.getByTestId("voice-status").textContent();
 await hoverPart(page,"right");await expect(page.getByTestId("voice-status")).toHaveText(locked!);
 await expect(page.locator('[data-surface-label="pinned"]')).toHaveText(locked!.replace(/^Listening about /,"").replace(/\.$/,""));await capture(page,"after-speech-target-locked");
 await emit(page,"partial");expect(sent).toBeUndefined();await emit(page,"final","Make this plate 12 mm thick");
 await expect(page.getByRole("region",{name:"Proposed change"})).toBeVisible();expect(sent.selection).toMatchObject({designId:d.snapshot.design.id,revision:0,partIds:["left"],source:"hover",surface:{partId:"left"}});
 await expect(page.getByRole("button",{name:"Speak an instruction",exact:true})).toBeDisabled();
 await capture(page,"after-proposal-review");
 const snap=await request.get(`/api/designs/${d.snapshot.design.id}`,{headers:{Authorization:`Bearer ${d.access.editorToken}`}});expect((await snap.json()).design.revision).toBe(0);
 expect(errors).toEqual([]);
});

test("SYNTHETIC: no target never borrows an explicit selection or submits partial/empty speech",async({page,request})=>{
 await open(page,request);let requests=0;await page.route("**/propose",route=>{requests++;return route.abort();});
 await page.getByLabel("Choose a part from the list",{exact:true}).click();await page.getByRole("button",{name:"Interior spacer",exact:true}).click();
 await page.getByRole("button",{name:"Speak an instruction",exact:true}).click();await emit(page,"speech");await emit(page,"partial");await emit(page,"final","");expect(requests).toBe(0);
 await emit(page,"final");await expect(page.getByTestId("design-prompt")).toHaveValue("Make this block 40 x 20 x 30 mm");expect(requests).toBe(0);
 await page.getByTestId("propose-change").click();await expect(page.getByRole("alert")).toContainText("Hover over a part");expect(requests).toBe(0);
});

test("SYNTHETIC: pointer exit and drag clear prospective target; cancellation discards a late result",async({page,request})=>{
 await open(page,request);let requests=0;await page.route("**/propose",route=>{requests++;return route.abort();});
 await page.getByRole("button",{name:"Speak an instruction",exact:true}).click();await hoverPart(page,"right");
 await page.mouse.move(5,5);await expect(page.locator(".model-canvas")).toHaveAttribute("data-hovered-part","");
 await hoverPart(page,"left");await page.mouse.down();await page.mouse.move(650,600,{steps:4});await expect(page.locator(".model-canvas")).toHaveAttribute("data-hovered-part","");await page.mouse.up();
 await emit(page,"speech");await expect(page.getByTestId("voice-status")).toContainText("No part under the pointer");
 await page.getByRole("button",{name:"Stop listening",exact:true}).click();await emit(page,"final");expect(requests).toBe(0);await expect(page.getByTestId("voice-status")).toHaveCount(0);
 await openPrompt(page);await expect(page.getByTestId("design-prompt")).toHaveValue("");
});

test("pending checkbox membership matches model markers, focus, confirm, cancel, clear",async({page,request})=>{
 await open(page,request);
 await page.getByLabel("Choose a part from the list",{exact:true}).click();await page.getByRole("button",{name:"Interior spacer",exact:true}).click();await closePanels(page);
 await circle(page);const choices=page.getByRole("region",{name:"Choose circled parts"}),model=page.locator(".model-canvas");
 await expect(page.locator(".part-selection")).toHaveCount(0); await expect(page.getByRole("heading",{name:"Interior spacer",exact:true})).toHaveCount(0);
 await expect(choices.getByRole("checkbox")).toHaveCount(2);await expect(model).toHaveAttribute("data-highlighted-parts","left,right");
 await expect(page.locator('[data-part-marker="left"]')).toHaveText("1✓");await expect(page.locator('[data-part-marker="right"]')).toHaveText("2✓");await capture(page,"after-candidates-all-checked");
 await choices.getByRole("checkbox",{name:"Support block"}).uncheck();await page.mouse.move(5,5);await choices.getByRole("button",{name:"Cancel",exact:true}).focus();
 await expect(model).toHaveAttribute("data-highlighted-parts","left");await expect(page.locator('[data-part-marker="right"]')).toHaveAttribute("data-checked","false");await capture(page,"after-unchecked");
 await choices.getByRole("checkbox",{name:"Support block"}).focus();await expect(page.locator('[data-part-marker="right"]')).toContainText("Support block");await capture(page,"after-unchecked-keyboard-focus");
 await choices.getByRole("checkbox",{name:"Mounting plate"}).uncheck();await choices.getByRole("button",{name:"Cancel",exact:true}).focus();await page.mouse.move(5,5);await expect(model).toHaveAttribute("data-highlighted-parts","");await capture(page,"after-all-unchecked");
 await choices.getByRole("button",{name:"Cancel",exact:true}).click();await expect(model).toHaveAttribute("data-highlighted-parts","hidden");await expect(page.locator('[data-part-marker]')).toHaveCount(0);
 await circle(page);await choices.getByRole("checkbox",{name:"Support block"}).uncheck();await choices.getByRole("button",{name:"Use selected parts"}).click();await expect(model).toHaveAttribute("data-highlighted-parts","left");
 await page.getByRole("button",{name:"Clear selected part",exact:true}).click();await expect(model).toHaveAttribute("data-highlighted-parts","");await expect(page.locator('[data-part-marker]')).toHaveCount(0);await expect(page.getByText("Mounting plate selected.",{exact:true})).toHaveCount(0);
});

test("SYNTHETIC: stale revision during speech is refused without rebinding",async({page,request})=>{
 const d=await open(page,request);let requests=0;await page.route("**/propose",route=>{requests++;return route.abort();});
 await page.getByRole("button",{name:"Speak an instruction",exact:true}).click();await hoverPart(page,"left");await emit(page,"speech");
 const change=await request.post(`/api/designs/${d.snapshot.design.id}/commands`,{headers:{Authorization:`Bearer ${d.access.editorToken}`},data:{id:crypto.randomUUID(),actor:"Other maker",baseRevision:0,changes:{scale:1.1},readSet:d.snapshot.design.params,summary:"Update scale"}});expect(change.status()).toBe(200);
 await expect(page.locator(".design-title")).toContainText("Revision 1");await emit(page,"final");await expect(page.getByRole("alert")).toContainText("Select the part again");expect(requests).toBe(0);
});

test("viewer cannot start voice; narrow viewport retains touch list and typing",async({page,request})=>{
 await open(page,request,true);await expect(page.getByRole("button",{name:"Speak an instruction",exact:true})).toBeDisabled();
 await page.setViewportSize({width:375,height:812});await capture(page,"after-mobile-viewer");
 await open(page,request);await page.getByLabel("Choose a part from the list",{exact:true}).click();await page.getByRole("button",{name:"Mounting plate",exact:true}).click();await openPrompt(page);await page.getByTestId("design-prompt").fill("Make the plate 12 mm thick");await capture(page,"after-mobile-typing");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test("SYNTHETIC: editing a spoken draft keeps its target; explicit selection and clear update the named request",async({page,request})=>{
 const d=await open(page,request);const sent:any[]=[];
 await page.route("**/propose",async route=>{sent.push(route.request().postDataJSON());await route.fulfill({json:{source:"local",explanation:"Review the requested measurement.",questions:["Which dimension?"],command:{id:crypto.randomUUID(),actor:"Maker",baseRevision:0,changes:{},readSet:d.snapshot.design.params,summary:"Measured change"}}});});
 await page.getByLabel("Choose a part from the list",{exact:true}).click();await page.getByRole("button",{name:"Support block",exact:true}).click();await closePanels(page);
 await page.getByRole("button",{name:"Speak an instruction",exact:true}).click();await hoverPart(page,"left");await emit(page,"speech");await emit(page,"final","Make this 12 mm thick");
 await expect(page.getByRole("region",{name:"Proposed change"})).toBeVisible();expect(sent[0].selection.partIds).toEqual(["left"]);
 await expect(page.locator(".model-canvas")).toHaveAttribute("data-highlighted-parts","");await expect(page.locator(".part-selection")).toHaveCount(0);await expect(page.getByTestId("request-target")).toHaveText(/^Pointing at: Mounting plate · /);await capture(page,"after-old-selection-voice-proposal");
 await page.getByRole("button",{name:"Dismiss proposal",exact:true}).click();await page.getByTestId("design-prompt").fill("Make this 14 mm thick");await expect(page.getByTestId("request-target")).toHaveText(/^Pointing at: Mounting plate · /);await page.getByTestId("propose-change").click();
 await expect.poll(()=>sent.length).toBe(2);expect(sent[1].selection.partIds).toEqual(["left"]);
 await page.getByRole("button",{name:"Dismiss proposal",exact:true}).click();await page.getByLabel("Choose a part from the list",{exact:true}).click();await page.getByRole("button",{name:"Support block",exact:true}).click();await openPrompt(page);await expect(page.getByTestId("request-target")).toHaveText("Request for Support block");
 await page.getByRole("button",{name:"Clear selected part",exact:true}).click();await expect(page.getByTestId("request-target")).toHaveText("Request for the whole design");
});

test("SYNTHETIC: speech onset recasts a stationary pointer after geometry moves",async({page,request})=>{
 await open(page,request,false,[{...parts[0],motion:{type:"slide",axis:"x",speed:6,range:150}},parts[1]]);
 await page.getByRole("button",{name:"Speak an instruction",exact:true}).click();await hoverPart(page,"left");
 // DOM activation keeps the real pointer stationary while the actual mechanism animates.
 await page.getByRole("button",{name:"Run mechanism",exact:true}).evaluate((button:HTMLButtonElement)=>button.click());
 await expect.poll(()=>page.locator(".model-canvas").getAttribute("data-hovered-part")).not.toBe("left");
 await page.getByRole("button",{name:"Pause mechanism",exact:true}).evaluate((button:HTMLButtonElement)=>button.click());
 const current=await page.locator(".model-canvas").getAttribute("data-hovered-part");await emit(page,"speech");
 await expect(page.getByTestId("voice-status")).toContainText(current==="right"?"Listening about Support block":"No part under the pointer");
});


test("external Components selection replaces pending circle membership, including reselecting the same old part",async({page,request})=>{
 await open(page,request);await page.getByLabel("Choose a part from the list",{exact:true}).click();await page.getByRole("button",{name:"Interior spacer",exact:true}).click();await closePanels(page);
 await circle(page);await openDimensions(page);await page.locator(".right-panel .parts-disclosure > summary").click();await page.locator(".right-panel .component-row").filter({hasText:"Interior spacer"}).click();
 await expect(page.getByRole("region",{name:"Choose circled parts"})).toHaveCount(0);await expect(page.locator(".model-canvas")).toHaveAttribute("data-highlighted-parts","hidden");await expect(page.locator(".part-selection")).toContainText("Interior spacer");
});

test("SYNTHETIC: zooming with a stationary pointer retains its current visible target",async({page,request})=>{
 await open(page,request);await page.getByRole("button",{name:"Speak an instruction",exact:true}).click();await hoverPart(page,"left");
 await page.mouse.wheel(0,-80);await expect(page.locator(".model-canvas")).toHaveAttribute("data-hovered-part","left");await emit(page,"speech");await expect(page.getByTestId("voice-status")).toHaveText(/^Listening about Mounting plate · .+\.$/);
});
