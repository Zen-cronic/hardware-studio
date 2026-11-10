import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app";
import { deskArmParts } from "../src/shared/desk-arm";
import { createSelection } from "../src/shared/selection";
import { surfaceTargetFromHit } from "../src/shared/surface";
import { acceptCheckedVersion, CHANGED_WHILE_CHECKING, prepareCheckedVersion, PROPOSAL_OUT_OF_DATE } from "../src/lib/check-version";
import type { Proposal, Snapshot } from "../src/shared/types";

// "Check it before applying" against the real routes: the browser's fetch is routed to the app.
let app: Awaited<ReturnType<typeof createApp>>["app"], dataDir: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "check-version-"));
  ({ app } = await createApp({ dataDir, serveStatic: false, aiKey: "" }));
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const r = await app.inject({ method: (init.method || "GET") as "GET", url, headers: init.headers as Record<string, string>, ...(init.body ? { payload: init.body as string } : {}) });
    return new Response(r.body, { status: r.statusCode, headers: { "content-type": "application/json" } });
  });
});
afterEach(async () => { vi.unstubAllGlobals(); await app.close(); rmSync(dataDir, { recursive: true, force: true }); });

async function call(method: string, url: string, token: string, payload?: unknown) {
  const r = await app.inject({ method: method as "GET", url: "/api" + url, headers: { authorization: "Bearer " + token }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: r.statusCode, body: r.json() };
}
async function newArm() {
  const created = (await app.inject({ method: "POST", url: "/api/designs", payload: { kind: "custom", name: "Arm", customParts: deskArmParts() } })).json();
  return { id: created.snapshot.design.id as string, token: created.access.editorToken as string, s0: created.snapshot as Snapshot };
}
async function proposeThick(id: string, token: string, snapshot: Snapshot, mm: number): Promise<Proposal> {
  const part = snapshot.derived.parts.find(p => p.id === "upper-arm")!;
  const selection = createSelection(snapshot, ["upper-arm"], "hover", surfaceTargetFromHit(part, [0, 2, 5], [0, 1, 0]));
  const r = await call("POST", `/designs/${id}/propose`, token, { prompt: `make this ${mm} mm thick`, actor: "Owner", selection });
  expect(r.status).toBe(200);
  return r.body;
}
async function setLowerArm(id: string, token: string, mm: number) {
  const current = (await call("GET", `/designs/${id}`, token)).body as Snapshot;
  const customParts = current.design.customParts!.map(p => p.id === "lower-arm" ? { ...p, size: [p.size[0], mm, p.size[2]] } : p);
  const r = await call("POST", `/designs/${id}/commands`, token, { id: randomUUID(), actor: "Peer", baseRevision: current.design.revision, changes: {}, readSet: { ...current.design.params }, customParts, summary: "lower arm" });
  expect(r.status).toBe(200);
  return r.body as Snapshot;
}
const thickness = (s: Snapshot, id: string) => s.design.customParts!.find(p => p.id === id)!.size[1];

describe("checking a proposal before applying it", () => {
  it("refuses Apply when the design changed during the check, and keeps the other edit", async () => {
    const { id, token, s0 } = await newArm();
    const proposal = await proposeThick(id, token, s0, 6);
    const checked = await prepareCheckedVersion(s0, proposal, token, "Owner");
    expect(checked.expectedMainRevision).toBe(s0.design.revision);
    await setLowerArm(id, token, 9);
    await expect(acceptCheckedVersion(checked, token, "Owner")).rejects.toThrow(CHANGED_WHILE_CHECKING);
    const main = (await call("GET", `/designs/${id}`, token)).body as Snapshot;
    expect(thickness(main, "lower-arm")).toBe(9);
    expect(thickness(main, "upper-arm")).toBe(thickness(s0, "upper-arm"));
  });

  it("refuses a proposal made on an older revision instead of applying it to a newer copy", async () => {
    const { id, token, s0 } = await newArm();
    const proposal = await proposeThick(id, token, s0, 6);
    const s1 = await setLowerArm(id, token, 9);
    await expect(prepareCheckedVersion(s1, proposal, token, "Owner")).rejects.toThrow(PROPOSAL_OUT_OF_DATE);
    const versions = (await call("GET", `/designs/${id}/proposed-versions`, token)).body;
    expect(versions).toHaveLength(0);
  });

  it("accepts the checked version when nothing moved", async () => {
    const { id, token, s0 } = await newArm();
    const proposal = await proposeThick(id, token, s0, 6);
    const checked = await prepareCheckedVersion(s0, proposal, token, "Owner");
    expect(checked.proposalId).toBe(proposal.command.id);
    expect(checked.expectedProposedRevision).toBe(1);
    await acceptCheckedVersion(checked, token, "Owner");
    const main = (await call("GET", `/designs/${id}`, token)).body as Snapshot;
    expect(thickness(main, "upper-arm")).toBe(6);
  });
});
