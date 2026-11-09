import { randomUUID } from "node:crypto";
import { deskArmParts } from "../../src/shared/desk-arm";
import type { AgentRun } from "../../src/shared/versions";
import type { EngineeringJob } from "../../server/engineering-jobs";
import { Store } from "../../server/store";
import { VersionService } from "../../server/versions";
export const recordedPrompt = "RAW_TEST_PROMPT: You are the design agent. Preserve the mounting holes.";
export function seedAgentOutcomes(store: Store, versions = new VersionService(store)) {
  const owner = store.create("custom", "Recorded arm outcomes", deskArmParts());
  const view = versions.create(owner.snapshot.design.id, owner.access.editorToken, { actor: "Maker", expectedRevision: 0, name: "Camera arm proposal" });
  const designer = versions.issueAgent(view.version.id, owner.access.editorToken, { role: "designer", label: "Design agent" });
  const engineer = versions.issueAgent(view.version.id, owner.access.editorToken, { role: "engineer", label: "Engineering agent" });
  versions.log(designer.credential, "preview", 0, recordedPrompt);
  const parts = structuredClone(view.proposed.design.customParts!);
  parts.find(p => p.id === "upper-arm")!.size[1] = 6;
  const command = { id: randomUUID(), baseRevision: 0, changes: {}, readSet: {}, customParts: parts, summary: recordedPrompt };
  const first = versions.apply(view.version.id, designer.token, command);
  const second = versions.apply(view.version.id, engineer.token, { id: randomUUID(), baseRevision: 1, changes: {}, readSet: {}, customParts: structuredClone(parts) });
  const studies: EngineeringJob[] = first.derived.parts.filter(p => p.role !== "reference").slice(0, 8).map(p => ({
    id: randomUUID(), designId: view.version.proposedDesignId, revision: 1, snapshotHash: "engineering-hash-is-not-a-version-hash",
    partId: p.id, type: "manufacturing", status: "ready", createdAt: new Date().toISOString(),
    result: { status: "solved", findings: [], checksPerformed: ["minimum thickness", "hole clearance"], profile: { name: "Example CNC profile", toolDiameterMm: 3 }, assumptions: ["Checks compare the current geometry to the displayed process profile.", "Declared geometry only"], unassessed: ["Workholding requires review"] },
  }));
  store.db.exec("CREATE TABLE IF NOT EXISTS engineering_jobs(id TEXT PRIMARY KEY,design_id TEXT NOT NULL,job TEXT NOT NULL)");
  for (const study of studies) store.db.prepare("INSERT INTO engineering_jobs VALUES(?,?,?)").run(study.id, study.designId, JSON.stringify(study));
  const run: AgentRun = { id: randomUUID(), versionId: view.version.id, goal: recordedPrompt, status: "completed", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedRoles: ["designer", "engineer"], questions: [], modelBacked: false };
  store.db.prepare("INSERT INTO agent_runs VALUES(?,?,?)").run(run.id, run.versionId, JSON.stringify(run));
  return { owner, view, designer, engineer, command, first, second, studies, run, versions };
}
