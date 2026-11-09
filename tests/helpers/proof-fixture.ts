import { randomUUID } from "node:crypto";
import { deskArmParts } from "../../src/shared/desk-arm";
import type { Snapshot } from "../../src/shared/types";
import type { EngineeringJob } from "../../server/engineering-jobs";
import { studySourceHash } from "../../server/engineering-jobs";
import { Store } from "../../server/store";
import { VersionService } from "../../server/versions";

// Synthetic fixture in the shape of saved engineering jobs. The numbers mirror a matched
// camera-arm comparison: upper link 110 x 4 x 24 mm against 110 x 6 x 24 mm, 0.5 kg payload.
export const MATERIAL = { name: "Aluminum 6061-T6 — typical elastic properties", youngModulusMPa: 70000, poissonRatio: 0.33, densityKgM3: 2700, yieldStrengthMPa: 240 };
export const SETUP = {
  partId: "upper-arm", material: MATERIAL,
  supports: [{ axis: "x", side: "min" }],
  loads: [{ axis: "x", side: "max", forceN: [0, -4.903325, 0] }],
  mesh: { maxSizeMm: 4, refinements: 2 },
};
export const ORIGINAL_RESULT = {
  status: "solved", type: "strength", maxDisplacementMm: 0.253801343, p95VonMisesMPa: 5.376473409,
  convergence: { status: "converged", displacementRelativeChange: 0.0021751, p95StressRelativeChange: 0.0368998, levels: [{ maxSizeMm: 4 }, { maxSizeMm: 2.8 }, { maxSizeMm: 1.96, elements: 8169 }] },
};
export const PROPOSED_RESULT = {
  status: "solved", type: "strength", maxDisplacementMm: 0.075794051, p95VonMisesMPa: 2.642597191,
  convergence: { status: "converged", displacementRelativeChange: 0.0017265, p95StressRelativeChange: 0.0134249, levels: [{ maxSizeMm: 4 }, { maxSizeMm: 2.8 }, { maxSizeMm: 1.96, elements: 12945 }] },
};

export function studyRecord(snapshot: Snapshot, overrides: Partial<EngineeringJob> = {}): EngineeringJob {
  return {
    id: randomUUID(), designId: snapshot.design.id, revision: snapshot.design.revision,
    snapshotHash: studySourceHash(snapshot), partId: "upper-arm", type: "strength", status: "ready",
    createdAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    setup: structuredClone(SETUP), ...overrides,
  };
}

export function saveStudy(store: Store, study: EngineeringJob) {
  store.db.exec("CREATE TABLE IF NOT EXISTS engineering_jobs(id TEXT PRIMARY KEY,design_id TEXT NOT NULL,job TEXT NOT NULL)");
  store.db.prepare("INSERT INTO engineering_jobs VALUES(?,?,?)").run(study.id, study.designId, JSON.stringify(study));
  return study;
}

// Reads saved studies the same way the study list does: newest first, stale by revision.
export function savedStudies(store: Store) {
  store.db.exec("CREATE TABLE IF NOT EXISTS engineering_jobs(id TEXT PRIMARY KEY,design_id TEXT NOT NULL,job TEXT NOT NULL)");
  return (designId: string): EngineeringJob[] => {
    const current = store.get(designId).design.revision;
    return (store.db.prepare("SELECT job FROM engineering_jobs WHERE design_id=? ORDER BY rowid DESC").all(designId) as { job: string }[])
      .map((row) => JSON.parse(row.job) as EngineeringJob).map((job) => ({ ...job, stale: job.revision !== current }));
  };
}

// Main design r0 with the 4 mm link, a proposed version whose upper link becomes 6 mm, and
// one matched strength study on each side.
export function seedProof(store: Store, versions = new VersionService(store), { studies = true } = {}) {
  const owner = store.create("custom", "Camera arm", deskArmParts());
  const view = versions.create(owner.snapshot.design.id, owner.access.editorToken, { actor: "Maker", expectedRevision: 0, name: "Thicker upper link" });
  const parts = structuredClone(view.proposed.design.customParts!);
  parts.find((p) => p.id === "upper-arm")!.size[1] = 6;
  const proposed = store.apply(view.version.proposedDesignId, { id: randomUUID(), actor: "Maker", baseRevision: 0, changes: {}, readSet: {}, customParts: parts, summary: "Thicken the upper link" });
  const original = studies ? saveStudy(store, studyRecord(owner.snapshot, { result: structuredClone(ORIGINAL_RESULT), createdAt: "2026-11-01T10:00:00.000Z" })) : undefined;
  const after = studies ? saveStudy(store, studyRecord(proposed, { result: structuredClone(PROPOSED_RESULT), createdAt: "2026-11-01T10:05:00.000Z" })) : undefined;
  return { owner, view, proposed, original, after, versions };
}
