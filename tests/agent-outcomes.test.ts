import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { VersionService, agentActor, compareSnapshots } from "../server/versions";
import { projectAgentOutcomes, type RecordedOperationRow } from "../server/agent-outcomes";
import type { EngineeringJob } from "../server/engineering-jobs";
import type { AgentEvent } from "../src/shared/versions";
import { recordedPrompt, seedAgentOutcomes } from "./helpers/agent-outcome-fixture";
const stores: Store[] = [], dirs: string[] = [], apps: Awaited<ReturnType<typeof createApp>>["app"][] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); for (const store of stores.splice(0)) if (store.db.open) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, {recursive:true,force:true}); });
function fixture() { const store = new Store(":memory:"); stores.push(store); return { store, ...seedAgentOutcomes(store) }; }
describe("recorded agent outcomes", () => {
  it("projects measured before/result deltas, exact holes and no-op independently of runs", () => {
    const f = fixture();
    const result = f.versions.outcomes(f.view.version.id, f.owner.access.editorToken, () => f.studies);
    expect(result.proposedRevision).toBe(2);
    expect(result.contributions[0].operations[0]).toMatchObject({fromRevision:0,toRevision:1,hasChanges:true,parts:[{partId:"upper-arm",beforeSize:[110,4,24],afterSize:[110,6,24],holesUnchanged:{count:2,diameters:[6.4,6.4]}}]});
    expect(result.contributions[1].operations[0]).toMatchObject({fromRevision:1,toRevision:2,hasChanges:false,parts:[],parameters:[]});
    expect(result.studies).toHaveLength(8); expect(result.studies.find(s=>s.partId==="upper-arm")).toMatchObject({partName:"Upper arm link",checksPerformed:["minimum thickness","hole clearance"],profile:{name:"Example CNC profile",toolDiameterMm:3},unassessed:["Workholding requires review"],assumptions:["Checks compare the current geometry to the displayed process profile.","Declared geometry only"]}); expect(result.studies.every(s => s.stale && s.revision === 1 && s.status === "ready" && s.resultStatus === "solved" && s.findingCount === 0)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(recordedPrompt); expect(JSON.stringify(result)).not.toContain("runId");
    f.store.db.prepare("INSERT INTO agent_runs VALUES(?,?,?)").run("another-run", f.view.version.id, JSON.stringify({...f.run,id:"another-run",status:"failed",completedRoles:[]}));
    expect(f.versions.outcomes(f.view.version.id, f.owner.access.editorToken, () => f.studies)).toEqual(result);
  });
  it("excludes human actor impersonation, absent or mismatched stamped events and manual changes", () => {
    const f = fixture(), before = f.versions.outcomes(f.view.version.id, f.owner.access.editorToken, () => []);
    const fake = {id:crypto.randomUUID(),actor:agentActor(f.designer.credential),baseRevision:2,changes:{},readSet:{},customParts:f.second.design.customParts};
    const forged = f.store.apply(f.view.version.proposedDesignId, fake);
    f.versions.log(f.engineer.credential, "edit", forged.design.revision, "Wrong identity");
    f.versions.log(f.designer.credential, "preview", forged.design.revision, "Not an edit stamp");
    f.versions.log(f.designer.credential, "edit", forged.design.revision + 100, "Wrong revision");
    f.store.apply(f.view.version.proposedDesignId, {...fake,id:crypto.randomUUID(),actor:"Maker",baseRevision:3});
    expect(f.versions.outcomes(f.view.version.id, f.owner.access.editorToken, () => []).contributions).toEqual(before.contributions);
  });
  it("deduplicates retried operations even when stamped events or source rows repeat", () => {
    const f = fixture(); f.versions.apply(f.view.version.id, f.designer.token, f.command);
    const records = f.store.db.prepare("SELECT command_id,command,before_snapshot,result FROM operations WHERE design_id=?").all(f.view.version.proposedDesignId) as RecordedOperationRow[];
    const events = f.versions.events(f.view.version.id, f.owner.access.editorToken);
    const result = projectAgentOutcomes({versionId:f.view.version.id,proposedDesignId:f.view.version.proposedDesignId,proposedRevision:2,status:"open",credentials:[f.designer.credential,f.engineer.credential],events:[...events,...events],operations:[...records,...records],studies:[]}, compareSnapshots);
    expect(result.contributions.map(c => c.operations.length)).toEqual([1,1]);
  });
  it("requires matching role, version and undo action, and preserves real undo history", () => {
    const f = fixture();
    const undo = f.versions.undo(f.view.version.id, f.engineer.token, f.second.history.at(-1)!.id, crypto.randomUUID());
    const result = f.versions.outcomes(f.view.version.id,f.owner.access.editorToken,()=>[]);
    expect(result.contributions[1].operations.at(-1)).toMatchObject({action:"undo",fromRevision:2,toRevision:undo.design.revision});
    const records = f.store.db.prepare("SELECT command_id,command,before_snapshot,result FROM operations WHERE design_id=?").all(f.view.version.proposedDesignId) as RecordedOperationRow[];
    const events: AgentEvent[] = f.versions.events(f.view.version.id,f.owner.access.editorToken).map(e => ({...e,role:"external"}));
    const input = {versionId:f.view.version.id,proposedDesignId:f.view.version.proposedDesignId,proposedRevision:undo.design.revision,status:"open" as const,credentials:[f.designer.credential,f.engineer.credential],events,operations:records,studies:[]};
    expect(projectAgentOutcomes(input,compareSnapshots).contributions.every(c=>!c.operations.length)).toBe(true);
    expect(projectAgentOutcomes({...input,events:f.versions.events(f.view.version.id,f.owner.access.editorToken).map(e=>({...e,versionId:"other"}))},compareSnapshots).contributions.every(c=>!c.operations.length)).toBe(true);
  });
  it.each(["position", "counterbore", "diameter"])("does not claim unchanged holes after a %s edit", field => {
    const f = fixture(); const parts = structuredClone(f.second.design.customParts!), hole = parts.find(p=>p.id==="upper-arm")!.holes![0];
    if(field==="position")hole.x+=1;else if(field==="diameter")hole.diameter+=.2;else hole.counterbore={diameter:9,depth:1};
    f.versions.apply(f.view.version.id,f.designer.token,{id:crypto.randomUUID(),baseRevision:2,changes:{},readSet:{},customParts:parts});
    expect(f.versions.outcomes(f.view.version.id,f.owner.access.editorToken,()=>[]).contributions[0].operations.at(-1)!.parts[0].holesUnchanged).toBeUndefined();
  });
  it("keeps pending, failed, unsupported and missing results distinct, trusting engineering stale state", () => {
    const f = fixture(); const studies: EngineeringJob[] = [
      {...f.studies[0],id:"queued",revision:2,status:"queued",result:undefined},
      {...f.studies[0],id:"failed",revision:2,status:"failed",result:undefined},
      {...f.studies[0],id:"unsupported",revision:2,result:{status:"unsupported_physics"}},
      {...f.studies[0],id:"missing",revision:2,result:undefined},
      {...f.studies[0],id:"import-stale",revision:2,stale:true},
      {...f.studies[0],id:"current",revision:2},
    ];
    const result=f.versions.outcomes(f.view.version.id,f.owner.access.editorToken,()=>studies).studies;
    expect(result.map(s=>[s.id,s.status,s.resultStatus,s.stale])).toEqual([["queued","queued",undefined,false],["failed","failed",undefined,false],["unsupported","ready","unsupported_physics",false],["missing","ready",undefined,false],["import-stale","ready","solved",true],["current","ready","solved",false]]);
    expect(result[4].staleReason).toBe("source_changed");
    expect(result[3].findingCount).toBeUndefined(); // Absence is never zero findings.
  });
  it.each(["accepted", "rejected"])("preserves contributions and study provenance after %s", status => {
    const f=fixture(), before=f.versions.outcomes(f.view.version.id,f.owner.access.editorToken,()=>f.studies);
    if(status==="accepted") {const reviewed=f.versions.view(f.view.version.id,f.owner.access.editorToken);f.versions.accept(f.view.version.id,f.owner.access.editorToken,{operationId:crypto.randomUUID(),actor:"Maker",expectedMainRevision:0,expectedProposedRevision:2,reviewedSnapshotHash:reviewed.proposedSnapshotHash});}
    else f.versions.reject(f.view.version.id,f.owner.access.editorToken);
    const after=f.versions.outcomes(f.view.version.id,f.owner.access.viewerToken,()=>f.studies);
    expect(after).toEqual({...before,status});
  });
  it("authorizes the actual API and never returns capabilities or raw prompt text", async () => {
    const dataDir=mkdtempSync(join(tmpdir(),"outcomes-api-"));dirs.push(dataDir);
    const {app,store}=await createApp({dataDir,aiKey:""});apps.push(app);const f=seedAgentOutcomes(store);
    const url=`/api/proposed-versions/${f.view.version.id}/outcomes`;
    expect((await app.inject({method:"GET",url})).statusCode).toBe(403);
    const unrelated=store.create("holder");expect((await app.inject({method:"GET",url,headers:{authorization:`Bearer ${unrelated.access.editorToken}`}})).statusCode).toBe(403);
    const before=store.db.prepare("SELECT total_changes() AS n").get();
    for(const token of [f.owner.access.editorToken,f.owner.access.viewerToken,f.view.access!.editorToken,f.view.access!.viewerToken,f.designer.token]){
      const response=await app.inject({method:"GET",url,headers:{authorization:`Bearer ${token}`}});expect(response.statusCode).toBe(200);
      for(const secret of [f.owner.access.editorToken,f.owner.access.viewerToken,f.view.access!.editorToken,f.view.access!.viewerToken,f.designer.token,f.engineer.token,recordedPrompt])expect(response.body).not.toContain(secret);
      expect(response.json().studies.every((s:any)=>s.stale)).toBe(true);
    }
    expect(store.db.prepare("SELECT total_changes() AS n").get()).toEqual(before);
  });
});
