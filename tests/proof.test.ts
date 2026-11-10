import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildProofCard, compareConditions, describeSide, exportAlignment, formatPercent, metricDeltas,
  percentChange, selectPair, type ProofStudyRecord,
} from "../src/shared/proof";
import type { ProposedVersion } from "../src/shared/versions";
import type { BuildJob } from "../src/shared/types";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { ResourceAdmission } from "../server/resource-admission";
import { ORIGINAL_RESULT, PROPOSED_RESULT, SETUP, saveStudy, savedStudies, seedProof, studyRecord } from "./helpers/proof-fixture";
import { formFromSetup, prefillFromProof, strengthRequest } from "../src/lib/strengthSetup";
import { deskArmParts } from "../src/shared/desk-arm";

const stores: Store[] = [], dirs: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) if (store.db.open) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(options?: { studies?: boolean }) {
  const store = new Store(":memory:"); stores.push(store);
  return { store, ...seedProof(store, undefined, options) };
}
const study = (overrides: Partial<ProofStudyRecord> = {}): ProofStudyRecord => ({
  id: randomUUID(), designId: "design", revision: 0, type: "strength", status: "ready", partId: "upper-arm",
  createdAt: "2026-11-01T10:00:00.000Z", setup: structuredClone(SETUP), result: structuredClone(ORIGINAL_RESULT), ...overrides,
});
const version = (overrides: Partial<ProposedVersion> = {}): ProposedVersion => ({
  id: "v", parentDesignId: "main", proposedDesignId: "proposed", baseRevision: 0, baseSnapshotHash: "a".repeat(64),
  status: "open", name: "Thicker upper link", createdAt: "2026-11-01T09:00:00.000Z", createdBy: "Maker", ...overrides,
});
const accepted = (mainRevision = 1) => version({ status: "accepted", acceptedMainRevision: mainRevision, acceptedProposedRevision: 2, acceptedBy: "Maker", closedAt: "2026-11-01T11:00:00.000Z" });
const build = (overrides: Partial<BuildJob> = {}): BuildJob => ({ id: "b1", designId: "main", revision: 1, status: "ready", downloadUrl: "/api/builds/b1/download", archiveSha256: "c".repeat(64), ...overrides });

describe("identical-assumption check", () => {
  it("confirms identical material, support, load and mesh", () => {
    const check = compareConditions(SETUP, structuredClone(SETUP), () => "Upper arm link");
    expect(check.state).toBe("same");
    expect(check.differences).toEqual([]);
    expect(check.items.map((i) => i.key)).toEqual(["component", "material", "supports", "loads", "mesh"]);
    expect(check.items.find((i) => i.key === "loads")!.original).toBe("4.903 N toward local −Y on the +X end");
    expect(check.items.find((i) => i.key === "supports")!.original).toBe("−X end fully fixed");
    expect(check.items.find((i) => i.key === "mesh")!.original).toBe("Start 4 mm, 2 refinements");
    expect(check.items.find((i) => i.key === "material")!.original).toContain("E 70,000 MPa");
  });
  it("lists every differing assumption in plain language", () => {
    const other = structuredClone(SETUP) as any;
    other.material.youngModulusMPa = 68900;
    other.loads[0].forceN = [0, -9.80665, 0];
    other.supports[0].side = "max"; other.loads[0].side = "min";
    other.mesh.maxSizeMm = 2;
    const check = compareConditions(SETUP, other);
    expect(check.state).toBe("different");
    expect(check.differences).toEqual(["Material", "Fixed support", "Load", "Mesh settings"]);
    const load = check.items.find((i) => i.key === "loads")!;
    expect(load).toMatchObject({ same: false, original: "4.903 N toward local −Y on the +X end", proposed: "9.807 N toward local −Y on the −X end" });
  });
  it("treats a different component, a load direction flip and a refinement count as differences", () => {
    expect(compareConditions(SETUP, { ...SETUP, partId: "lower-arm" }).differences).toEqual(["Component"]);
    expect(compareConditions(SETUP, { ...SETUP, loads: [{ axis: "x", side: "max", forceN: [0, 4.903325, 0] }] }).differences).toEqual(["Load"]);
    expect(compareConditions(SETUP, { ...SETUP, mesh: { maxSizeMm: 4, refinements: 1 } }).differences).toEqual(["Mesh settings"]);
  });
  it("reports unknown conditions when a side has no recorded setup", () => {
    expect(compareConditions(undefined, SETUP)).toEqual({ state: "unknown", items: [], differences: [] });
  });
});

describe("measured deltas", () => {
  it("computes percent change from recorded values", () => {
    const percent = percentChange(0.253801343, 0.075794051)!;
    expect(percent).toBeCloseTo(-70.1367, 3);
    expect(formatPercent(percent)).toBe("−70.14%");
    expect(formatPercent(percentChange(5.376473409, 2.642597191)!)).toBe("−50.85%");
    expect(formatPercent(12.5)).toBe("+12.50%");
    expect(formatPercent(-0.001)).toBe("0.00%");
    expect(percentChange(0, 1)).toBeUndefined();
    expect(percentChange(Number.NaN, 1)).toBeUndefined();
  });
  it("reports peak stress but keeps it out of the verdict", () => {
    const rows = metricDeltas({ ...ORIGINAL_RESULT, maxVonMisesMPa: 20 }, { ...PROPOSED_RESULT, maxVonMisesMPa: 30 });
    expect(rows.map((r) => [r.key, r.direction, r.inVerdict])).toEqual([
      ["maxDisplacementMm", "lower", true], ["p95VonMisesMPa", "lower", true], ["maxVonMisesMPa", "higher", false],
    ]);
    expect(rows[0].change).toBeCloseTo(0.075794051 - 0.253801343, 12);
  });
  it("labels changes within one percent as the same and omits absent measures", () => {
    const rows = metricDeltas({ maxDisplacementMm: 1 }, { maxDisplacementMm: 1.005 });
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe("same");
    const half = metricDeltas({ maxDisplacementMm: 1 }, undefined)[0];
    expect(half.original).toBe(1);
    expect(half.proposed).toBeUndefined();
    expect(half.percent).toBeUndefined();
  });
});

describe("study states stay visible", () => {
  const expected = { revision: 0, sourceHash: "hash" };
  it.each([
    [undefined, "missing", false],
    [study({ status: "queued", result: undefined }), "queued", false],
    [study({ status: "running", result: undefined }), "running", false],
    [study({ status: "failed", result: undefined, error: "Analysis interrupted. Run the study again." }), "failed", false],
    [study({ status: "cancelled", result: undefined }), "cancelled", false],
    [study({ result: { status: "needs_inputs", error: "Choose a material" } }), "no_result", false],
    [study(), "converged", true],
    [study({ result: { ...ORIGINAL_RESULT, status: "unconverged", convergence: { status: "unconverged" } } }), "unconverged", true],
    [study({ result: { ...ORIGINAL_RESULT, convergence: { status: "not_assessed", levels: [] } } }), "not_assessed", true],
  ])("describes %#", (record, state, numbers) => {
    const side = describeSide("original", 0, record, expected);
    expect(side.state).toBe(state);
    expect(side.hasNumbers).toBe(numbers);
    expect(side.summary.length).toBeGreaterThan(10);
  });
  it("keeps failure messages and element counts", () => {
    expect(describeSide("proposed", 0, study({ status: "failed", result: undefined, error: "Mesh worker stopped" }), expected).summary).toBe("Study failed: Mesh worker stopped");
    expect(describeSide("original", 0, study(), expected).study!.elements).toBe(8169);
  });
  it("marks earlier, different-revision and changed-source studies as stale", () => {
    expect(describeSide("proposed", 2, study({ revision: 1 }), { revision: 2 }).stale).toBe("earlier_revision");
    expect(describeSide("original", 0, study({ revision: 1 }), { revision: 0 }).stale).toBe("different_revision");
    expect(describeSide("original", 0, study({ snapshotHash: "other" }), expected).stale).toBe("source_changed");
    expect(describeSide("original", 0, study({ stale: true }), { revision: 0 }).stale).toBe("source_changed");
    expect(describeSide("original", 0, study({ snapshotHash: "hash" }), expected).stale).toBeUndefined();
    expect(describeSide("proposed", 2, study({ revision: 1 }), { revision: 2 }).summary).toContain("The proposed study is for r1, but the proposed design is r2.");
  });
});

describe("pair selection", () => {
  const expected = { original: { revision: 0 }, proposed: { revision: 2 } };
  it("prefers the newest finished pair with identical conditions over a newer mismatched study", () => {
    const matchedA = study({ createdAt: "2026-11-01T10:00:00Z" }), matchedB = study({ revision: 2, createdAt: "2026-11-01T10:05:00Z", result: PROPOSED_RESULT });
    const newer = study({ revision: 2, createdAt: "2026-11-01T11:00:00Z", setup: { ...SETUP, mesh: { maxSizeMm: 8, refinements: 2 } } });
    expect(selectPair([matchedA], [newer, matchedB], expected)).toEqual({ original: matchedA, proposed: matchedB });
  });
  it("shows the newest current studies when nothing matches", () => {
    const a = study(), old = study({ revision: 1, createdAt: "2026-11-01T12:00:00Z" });
    const b = study({ revision: 2, createdAt: "2026-11-01T11:00:00Z", setup: { ...SETUP, mesh: { maxSizeMm: 8, refinements: 2 } } });
    expect(selectPair([a], [old, b], expected)).toEqual({ original: a, proposed: b });
    expect(selectPair([], [old], expected)).toEqual({ original: undefined, proposed: old });
  });
});

describe("export alignment", () => {
  it("waits for acceptance and reports rejection", () => {
    expect(exportAlignment(version(), 0, build({ revision: 0 }))).toMatchObject({ state: "not_accepted", build: { revision: 0 } });
    expect(exportAlignment(version({ status: "rejected" }), 0, null).state).toBe("rejected");
  });
  it("matches only a ready package for the accepted revision and carries its hash", () => {
    const result = exportAlignment(accepted(1), 1, build());
    expect(result).toMatchObject({ state: "matches", acceptedRevision: 1, mainChangedSinceAcceptance: false, build: { id: "b1", revision: 1, archiveSha256: "c".repeat(64), downloadUrl: "/api/builds/b1/download" } });
    expect(result.title).toBe("Download matches accepted r1");
  });
  it.each([
    [null, "missing"], [build({ revision: 0 }), "older"], [build({ revision: 3 }), "newer"],
    [build({ status: "queued", downloadUrl: undefined }), "preparing"], [build({ status: "running" }), "preparing"],
    [build({ status: "failed", error: "CAD did not produce a complete package." }), "failed"],
  ] as const)("reports %# as %s", (job, state) => {
    expect(exportAlignment(accepted(1), 1, job as BuildJob | null).state).toBe(state);
  });
  it("says when the export is for an older revision and when main moved on", () => {
    expect(exportAlignment(accepted(1), 1, build({ revision: 0 })).title).toBe("Export is for an older revision");
    const moved = exportAlignment(accepted(1), 3, build({ revision: 3 }));
    expect(moved).toMatchObject({ state: "newer", mainChangedSinceAcceptance: true });
    expect(moved.detail).toContain("now r3");
  });
});

describe("before/after proof card", () => {
  it("reproduces the matched camera-arm comparison from saved records", () => {
    const f = fixture();
    const card = f.versions.proof(f.view.version.id, f.owner.access.editorToken, savedStudies(f.store), () => null);
    expect(card).toMatchObject({
      status: "open", partId: "upper-arm", partName: "Upper arm link", comparability: "confirmed",
      original: { revision: 0 }, proposed: { revision: 1 },
      conditions: { state: "same", differences: [] },
      sides: { original: { state: "converged" }, proposed: { state: "converged" } },
      verdict: { state: "improved", title: "Improved under the same conditions" },
      export: { state: "not_accepted" }, otherStudies: { original: 0, proposed: 0 },
    });
    expect([card.sides.original.stale, card.sides.proposed.stale]).toEqual([undefined, undefined]);
    expect(card.verdict.detail).toBe("Upper arm link: maximum displacement −70.14% and 95th-percentile stress −50.85%, both meshes converged.");
    expect(card.changes.parts).toEqual([{ partId: "upper-arm", name: "Upper arm link", type: "changed", fields: ["size"], beforeSize: [110, 4, 24], afterSize: [110, 6, 24] }]);
    expect(card.components).toEqual([{ partId: "upper-arm", name: "Upper arm link", originalStudies: 1, proposedStudies: 1 }]);
    expect(card.scope).toContain("not an assembly certification");
  });
  it("labels mismatched conditions as not comparable while keeping both values", () => {
    const f = fixture();
    saveStudy(f.store, studyRecord(f.proposed, { createdAt: "2026-11-01T12:00:00.000Z", result: { ...PROPOSED_RESULT, maxDisplacementMm: 0.15 }, setup: { ...SETUP, loads: [{ axis: "x", side: "max", forceN: [0, -9.80665, 0] }] } }));
    f.store.db.prepare("DELETE FROM engineering_jobs WHERE id=?").run(f.after!.id);
    const card = f.versions.proof(f.view.version.id, f.owner.access.editorToken, savedStudies(f.store), () => null);
    expect(card).toMatchObject({ comparability: "not_comparable", verdict: { state: "not_comparable", title: "Not comparable: test conditions differ" }, conditions: { differences: ["Load"] } });
    expect(card.metrics[0]).toMatchObject({ original: 0.253801343, proposed: 0.15 });
  });
  it("keeps an unconverged side visible as preliminary", () => {
    const f = fixture();
    f.store.db.prepare("UPDATE engineering_jobs SET job=json_set(job,'$.result.status','unconverged','$.result.convergence.status','unconverged') WHERE id=?").run(f.after!.id);
    const card = f.versions.proof(f.view.version.id, f.owner.access.editorToken, savedStudies(f.store), () => null);
    expect(card).toMatchObject({ comparability: "preliminary", verdict: { state: "preliminary" }, sides: { proposed: { state: "unconverged" } } });
    expect(card.verdict.detail).toContain("Proposed result may still change");
    expect(card.metrics[0].percent).toBeCloseTo(-70.14, 1);
  });
  it("marks a proposed study as out of date after a later proposed edit", () => {
    const f = fixture();
    const parts = structuredClone(f.proposed.design.customParts!); parts.find((p) => p.id === "upper-arm")!.size[1] = 7;
    f.store.apply(f.view.version.proposedDesignId, { id: randomUUID(), actor: "Maker", baseRevision: 1, changes: {}, readSet: {}, customParts: parts });
    const card = f.versions.proof(f.view.version.id, f.owner.access.editorToken, savedStudies(f.store), () => null);
    expect(card).toMatchObject({ proposed: { revision: 2 }, sides: { proposed: { stale: "earlier_revision" } }, verdict: { state: "not_comparable", title: "Not comparable: a study is out of date" } });
  });
  it("asks for the missing side and handles designs without studies", () => {
    const f = fixture({ studies: false });
    const empty = f.versions.proof(f.view.version.id, f.owner.access.editorToken, savedStudies(f.store), () => null);
    expect(empty).toMatchObject({ components: [], verdict: { state: "incomplete" }, sides: { original: { state: "missing" }, proposed: { state: "missing" } } });
    saveStudy(f.store, studyRecord(f.owner.snapshot, { result: ORIGINAL_RESULT }));
    const one = f.versions.proof(f.view.version.id, f.owner.access.editorToken, savedStudies(f.store), () => null);
    expect(one).toMatchObject({ partId: "upper-arm", verdict: { state: "incomplete", title: "Needs a proposed study" }, sides: { original: { state: "converged" }, proposed: { state: "missing" } } });
  });
  it("binds export alignment to the accepted main revision", () => {
    const f = fixture();
    f.store.setBuild({ id: "before", designId: f.owner.snapshot.design.id, revision: 0, status: "ready", downloadUrl: "/api/builds/before/download" });
    const latest = (id: string) => f.store.latestBuild(id);
    const open = f.versions.proof(f.view.version.id, f.owner.access.editorToken, savedStudies(f.store), latest);
    expect(open.export).toMatchObject({ state: "not_accepted", build: { revision: 0 } });
    const view = f.versions.view(f.view.version.id, f.owner.access.editorToken);
    f.versions.accept(f.view.version.id, f.owner.access.editorToken, { operationId: "accept-1", actor: "Maker", expectedMainRevision: 0, expectedProposedRevision: 1, reviewedSnapshotHash: view.proposedSnapshotHash });
    const stale = f.versions.proof(f.view.version.id, f.owner.access.editorToken, savedStudies(f.store), latest);
    expect(stale).toMatchObject({ status: "accepted", acceptance: { acceptedMainRevision: 1, acceptedProposedRevision: 1 }, export: { state: "older", acceptedRevision: 1 } });
    // The original study now predates main, but it still describes the original revision.
    expect(stale.sides.original.stale).toBeUndefined();
    expect(stale.verdict.state).toBe("improved");
    f.store.setBuild({ id: "after", designId: f.owner.snapshot.design.id, revision: 1, status: "ready", downloadUrl: "/api/builds/after/download", archiveSha256: "d".repeat(64) });
    expect(f.versions.proof(f.view.version.id, f.owner.access.editorToken, savedStudies(f.store), latest).export).toMatchObject({ state: "matches", build: { id: "after", archiveSha256: "d".repeat(64) } });
  });
  it("is pure over its inputs and selects the requested component", () => {
    const f = fixture();
    saveStudy(f.store, studyRecord(f.owner.snapshot, { partId: "lower-arm", setup: { ...SETUP, partId: "lower-arm" }, result: ORIGINAL_RESULT }));
    const card = f.versions.proof(f.view.version.id, f.owner.access.editorToken, savedStudies(f.store), () => null, "lower-arm");
    expect(card).toMatchObject({ partId: "lower-arm", sides: { proposed: { state: "missing" } } });
    expect(card.components.map((c) => c.partId).sort()).toEqual(["lower-arm", "upper-arm"]);
    const fallback = f.versions.proof(f.view.version.id, f.owner.access.editorToken, savedStudies(f.store), () => null, "not-a-part");
    expect(fallback.partId).toBe("upper-arm");
    const input = { version: version(), base: f.owner.snapshot, main: f.owner.snapshot, proposed: f.proposed, diff: { parameters: [], parts: [], metrics: [], hasChanges: false }, originalStudies: [], proposedStudies: [], latestBuild: null };
    expect(buildProofCard(input)).toEqual(buildProofCard(structuredClone(input)));
  });
});

describe("proof route", () => {
  it("serves the card to viewers, refuses strangers, and matches real study and download hashes", async () => {
    const root = mkdtempSync(join(tmpdir(), "studio-proof-")); dirs.push(root);
    const python = join(root, "controlled-worker");
    // A real subprocess that writes a small archive; not a CAD correctness fixture.
    writeFileSync(python, `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const args = process.argv;
if (!args.includes('--output')) { process.stdout.write(JSON.stringify({status:'needs_inputs',error:'Controlled worker'})+'\\n'); process.exit(2); }
const output = args[args.indexOf('--output')+1];
fs.mkdirSync(output, {recursive:true});
const archive = path.join(output,'package.zip');
fs.writeFileSync(archive,'archive bytes for '+path.basename(path.dirname(output)));
console.log(JSON.stringify({ok:true,archive}));
`, { mode: 0o700 });
    const { app, store } = await createApp({ resources: new ResourceAdmission({ dataDir: root, queueLimit: 20 }), dataDir: root, python, serveStatic: false, aiKey: "" });
    try {
      const f = seedProof(store);
      const headers = { authorization: "Bearer " + f.owner.access.editorToken };
      const url = `/api/proposed-versions/${f.view.version.id}/proof`;
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(403);
      const viewer = await app.inject({ method: "GET", url, headers: { authorization: "Bearer " + f.owner.access.viewerToken } });
      expect(viewer.statusCode).toBe(200);
      expect(viewer.json().verdict.state).toBe("improved");
      // A study submitted through the real API carries the same source fingerprint as the version base.
      const submitted = await app.inject({ method: "POST", url: `/api/designs/${f.owner.snapshot.design.id}/studies`, headers,
        payload: { type: "strength", revision: 0, ...structuredClone(SETUP), partId: "lower-arm" } });
      expect(submitted.statusCode).toBe(202);
      let card: any;
      for (let i = 0; i < 100; i++) {
        card = (await app.inject({ method: "GET", url: url + "?part=lower-arm", headers })).json();
        if (!["queued", "running"].includes(card.sides.original.state)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(card.partId).toBe("lower-arm");
      expect(card.sides.original.stale).toBeUndefined();
      expect(card.sides.original.state).toBe("no_result");
      const view = (await app.inject({ method: "GET", url: `/api/proposed-versions/${f.view.version.id}`, headers })).json();
      expect((await app.inject({ method: "POST", url: `/api/proposed-versions/${f.view.version.id}/accept`, headers,
        payload: { operationId: "accept-1", actor: "Maker", expectedMainRevision: 0, expectedProposedRevision: 1, reviewedSnapshotHash: view.proposedSnapshotHash } })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url, headers })).json().export.state).toBe("missing");
      expect((await app.inject({ method: "POST", url: `/api/designs/${f.owner.snapshot.design.id}/build`, headers })).statusCode).toBe(200);
      for (let i = 0; i < 100; i++) {
        card = (await app.inject({ method: "GET", url, headers })).json();
        if (!["preparing"].includes(card.export.state)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(card.export).toMatchObject({ state: "matches", acceptedRevision: 1, build: { revision: 1, status: "ready" } });
      const download = await app.inject({ method: "GET", url: card.export.build.downloadUrl, headers });
      expect(download.statusCode).toBe(200);
      expect(createHash("sha256").update(download.rawPayload).digest("hex")).toBe(card.export.build.archiveSha256);
    } finally { await app.close(); }
  }, 30000);
});

describe("prefill from the original study", () => {
  const upper = deskArmParts().find((p) => p.id === "upper-arm")!;
  const rebuild = (setup: any) => { const form = formFromSetup(setup, upper)!; return strengthRequest({ revision: 1, part: upper, ...form }); };
  it("maps the recorded setup back to the form and reproduces it exactly", () => {
    expect(formFromSetup(SETUP, upper)).toEqual({ material: SETUP.material, axis: "x", supportSide: "min", loadSide: "max", direction: "-y", mode: "payload", value: "0.5", meshSize: "4", refinements: 2 });
    expect(compareConditions(SETUP, rebuild(SETUP)).state).toBe("same");
  });
  it.each([0.1, 0.3, 1.7, 7, 9.80665, 123.456, 2500])("reproduces a %s N force bit for bit", (force) => {
    const setup = { ...structuredClone(SETUP), loads: [{ axis: "x", side: "max", forceN: [0, 0, force] }], mesh: { maxSizeMm: 2.8, refinements: 1 } };
    expect(rebuild(setup).loads).toEqual(setup.loads);
    expect(rebuild(setup).mesh).toEqual(setup.mesh);
  });
  it("refuses setups the form cannot reproduce", () => {
    expect(formFromSetup({ ...SETUP, loads: [{ axis: "x", side: "max", forceN: [1, -4, 0] }] }, upper)).toBeUndefined();
    expect(formFromSetup({ ...SETUP, supports: [{ axis: "y", side: "min" }] }, upper)).toBeUndefined();
    expect(formFromSetup({ ...SETUP, importId: "imported" }, upper)).toBeUndefined();
    expect(formFromSetup({ ...SETUP, partId: "lower-arm" }, upper)).toBeUndefined();
    expect(formFromSetup({ ...SETUP, mesh: { maxSizeMm: 0.01, refinements: 2 } }, upper)).toBeUndefined();
  });
  it("uses the same original study the proof compares against", () => {
    const f = fixture();
    // A newer original study with a coarser mesh does not match the proposed study.
    const newer = saveStudy(f.store, studyRecord(f.owner.snapshot, { createdAt: "2026-11-01T12:00:00.000Z", setup: { ...structuredClone(SETUP), mesh: { maxSizeMm: 8, refinements: 2 } }, result: ORIGINAL_RESULT }));
    const card = f.versions.proof(f.view.version.id, f.owner.access.editorToken, savedStudies(f.store), () => null, "upper-arm");
    const prefill = prefillFromProof(card, upper);
    expect(card.sides.original.study!.id).toBe(f.original!.id);
    expect(prefill).toMatchObject({ ok: true, studyId: f.original!.id, revision: 0, form: { meshSize: "4" } });
    // Without a proposed study, both follow the newest current original study.
    f.store.db.prepare("DELETE FROM engineering_jobs WHERE id=?").run(f.after!.id);
    const alone = f.versions.proof(f.view.version.id, f.owner.access.editorToken, savedStudies(f.store), () => null, "upper-arm");
    expect(alone.sides.original.study!.id).toBe(newer.id);
    expect(prefillFromProof(alone, upper)).toMatchObject({ ok: true, studyId: newer.id, form: { meshSize: "8" } });
  });
  it("falls back to the default setup and says why", () => {
    const f = fixture({ studies: false });
    const empty = f.versions.proof(f.view.version.id, f.owner.access.editorToken, savedStudies(f.store), () => null, "upper-arm");
    expect(prefillFromProof(empty, upper)).toEqual({ ok: false, message: "The original design has no strength study for Upper arm link. The study form uses the default setup." });
    saveStudy(f.store, studyRecord(f.owner.snapshot, { snapshotHash: "different-geometry", result: ORIGINAL_RESULT }));
    const stale = f.versions.proof(f.view.version.id, f.owner.access.editorToken, savedStudies(f.store), () => null, "upper-arm");
    const message = prefillFromProof(stale, upper);
    expect(message.ok).toBe(false);
    expect(message.message).toBe("The original study is out of date. The geometry behind the original study changed after it ran. The study form uses the default setup.");
    expect(prefillFromProof(null, upper).ok).toBe(false);
    expect(prefillFromProof(stale, undefined).message).toContain("Select a physical component.");
  });
});
