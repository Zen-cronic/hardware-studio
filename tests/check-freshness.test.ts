import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app";
import { checkFreshness, rerunRequest, studyInputKey } from "../src/shared/check-freshness";
import { seedAgentOutcomes } from "./helpers/agent-outcome-fixture";
import { seedProof } from "./helpers/proof-fixture";

const study = (id: string, revision: number, extra: Record<string, unknown> = {}) => ({ id, type: "manufacturing", partId: "p" + id, status: "ready", revision, ...extra });

describe("check freshness for acceptance", () => {
  it("blocks when the latest check per component predates the revision being accepted", () => {
    const fresh = checkFreshness([study("1", 2), study("2", 2)], 2);
    expect(fresh).toMatchObject({ blocked: false, stale: [], running: [], reason: "" });
    const old = checkFreshness([study("1", 1), study("2", 1)], 2);
    expect(old.blocked).toBe(true);
    expect(old.reason).toBe("2 checks shown are from r1; this version is r2. Re-run them on this version before accepting.");
    // A newer study for the same component replaces the older one; studies are newest first.
    expect(checkFreshness([study("3", 2, { partId: "p1" }), study("1", 1)], 2).blocked).toBe(false);
    expect(checkFreshness([study("1", 2, { stale: true })], 2).reason).toBe("1 check on r2 predates a source change. Re-run it before accepting.");
  });

  it("waits for checks still running, and does not block without any checks", () => {
    const running = checkFreshness([study("1", 2, { status: "running" })], 2);
    expect(running).toMatchObject({ blocked: true, reason: "1 check is still running on r2. Accept when it finishes." });
    expect(checkFreshness([], 3).blocked).toBe(false);
    // A failed check on this revision is not out of date; its result is shown as failed.
    expect(checkFreshness([study("1", 2, { status: "failed" })], 2).blocked).toBe(false);
  });

  it("repeats a recorded check with the same inputs, or says it needs the study form", () => {
    const setup = { partId: "upper-arm", material: { name: "Al" }, supports: [{ axis: "x", side: "min" }], loads: [{ axis: "x", side: "max", forceN: [0, -1, 0] }], mesh: { maxSizeMm: 4, refinements: 2 } };
    expect(rerunRequest({ type: "strength", setup }, 3)).toEqual({ type: "strength", revision: 3, ...setup });
    expect(rerunRequest({ type: "manufacturing", partId: "base" }, 3, "print")).toEqual({ type: "manufacturing", revision: 3, partId: "base", profile: "fdm" });
    expect(rerunRequest({ type: "strength", setup: { importId: "x" } }, 3)).toBeNull();
  });
});

describe("checks that are not about one part", () => {
  const rigid = { mechanism: { kind: "rigid_body", durationSeconds: 1, bodies: [{ partId: "lower-arm", massKg: 0.1 }] } };
  it("identifies a study of no single part by its inputs, so a re-run with the same inputs replaces it", () => {
    const old = { id: "a", type: "mechanism", status: "ready", revision: 1, setup: rigid };
    expect(checkFreshness([old], 2).blocked).toBe(true);
    const rerun = { id: "b", type: "mechanism", status: "ready", revision: 2, setup: structuredClone(rigid) };
    expect(checkFreshness([rerun, old], 2)).toMatchObject({ blocked: false, stale: [] });
    // Study outcomes carry the same identity without the inputs.
    expect(checkFreshness([{ ...rerun, setup: undefined, inputKey: studyInputKey(rigid) }, old], 2).blocked).toBe(false);
  });

  it("does not hold Accept for a part the version removed", () => {
    const removed = { id: "a", type: "manufacturing", partId: "camera-platform", status: "ready", revision: 1 };
    expect(checkFreshness([removed], 2).blocked).toBe(true);
    expect(checkFreshness([removed], 2, ["upper-arm", "lower-arm"]).blocked).toBe(false);
  });

  it("re-runs a part-bound mechanism study with its part, material and profile", () => {
    const setup = { partId: "upper-arm", material: { name: "Al" }, profile: "cnc", mechanism: { kind: "arm", payloadKg: 0.5, reachMm: 250 } };
    expect(rerunRequest({ type: "mechanism", partId: "upper-arm", setup }, 3)).toEqual({ type: "mechanism", revision: 3, ...setup });
    expect(rerunRequest({ type: "mechanism", setup: rigid }, 3)).toEqual({ type: "mechanism", revision: 3, ...rigid });
  });
});

describe("accept route", () => {
  it("checks the owner and the request before the checks gate", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "check-freshness-"));
    const { app, store } = await createApp({ dataDir, aiKey: "" });
    try {
      const f = seedAgentOutcomes(store);
      const url = `/api/proposed-versions/${f.view.version.id}/accept`;
      const viewer = await app.inject({ method: "POST", url, headers: { authorization: "Bearer " + f.owner.access.viewerToken },
        payload: { operationId: "x", actor: "Maker", expectedMainRevision: 0, expectedProposedRevision: 2, reviewedSnapshotHash: "0".repeat(64) } });
      expect(viewer.statusCode).toBe(403);
      const empty = await app.inject({ method: "POST", url, headers: { authorization: "Bearer " + f.owner.access.editorToken }, payload: {} });
      expect(empty.statusCode).toBe(422);
    } finally { await app.close(); rmSync(dataDir, { recursive: true, force: true }); }
  });

  it("refuses a version whose shown checks predate it unless the caller overrides, and accepts current checks", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "check-freshness-"));
    const { app, store } = await createApp({ dataDir, aiKey: "" });
    try {
      const f = seedAgentOutcomes(store);
      const headers = { authorization: "Bearer " + f.owner.access.editorToken };
      const view = (await app.inject({ method: "GET", url: `/api/proposed-versions/${f.view.version.id}`, headers })).json();
      const payload = { operationId: "accept-1", actor: "Maker", expectedMainRevision: 0, expectedProposedRevision: view.proposed.design.revision, reviewedSnapshotHash: view.proposedSnapshotHash };
      const refused = await app.inject({ method: "POST", url: `/api/proposed-versions/${f.view.version.id}/accept`, headers, payload });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: "CHECKS_STALE", error: "8 checks shown are from r1; this version is r2. Re-run them on this version before accepting." });
      const overridden = await app.inject({ method: "POST", url: `/api/proposed-versions/${f.view.version.id}/accept`, headers, payload: { ...payload, acceptStaleChecks: true } });
      expect(overridden.statusCode).toBe(200);

      const p = seedProof(store);
      const proofHeaders = { authorization: "Bearer " + p.owner.access.editorToken };
      const current = (await app.inject({ method: "GET", url: `/api/proposed-versions/${p.view.version.id}`, headers: proofHeaders })).json();
      expect((await app.inject({ method: "POST", url: `/api/proposed-versions/${p.view.version.id}/accept`, headers: proofHeaders,
        payload: { operationId: "accept-2", actor: "Maker", expectedMainRevision: 0, expectedProposedRevision: 1, reviewedSnapshotHash: current.proposedSnapshotHash } })).statusCode).toBe(200);
    } finally { await app.close(); rmSync(dataDir, { recursive: true, force: true }); }
  });
});
