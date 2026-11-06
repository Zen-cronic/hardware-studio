import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { VersionService, snapshotHash } from "../server/versions";
import { readSetFor } from "../src/shared/engine";
import type { Command, Snapshot } from "../src/shared/types";
const stores: Store[] = [], dirs: string[] = [];
afterEach(() => { for (const s of stores.splice(0)) if (s.db.open) s.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function setup(path = ":memory:") {
  const store = new Store(path); stores.push(store);
  const owner = store.create("turntable"), versions = new VersionService(store);
  const view = versions.create(owner.snapshot.design.id, owner.access.editorToken, { actor: "Maker", name: "Better support", expectedRevision: 0 });
  return { store, owner, versions, view };
}
function command(snapshot: Snapshot, changes: Record<string, number>): Command {
  return { id: crypto.randomUUID(), actor: "Maker", baseRevision: snapshot.design.revision, changes, readSet: readSetFor(snapshot.design, changes) };
}
function acceptance(view: ReturnType<VersionService["view"]>) {
  return { operationId: crypto.randomUUID(), actor: "Maker", expectedMainRevision: view.main.design.revision,
    expectedProposedRevision: view.proposed.design.revision, reviewedSnapshotHash: view.proposedSnapshotHash };
}
describe("proposed versions", () => {
  it("persists immutable ancestry and compares coupled parts without changing main", () => {
    const { store, owner, versions, view } = setup();
    store.apply(view.version.proposedDesignId, command(view.proposed, { diameter: 280 }));
    const current = versions.view(view.version.id, owner.access.editorToken);
    expect(current.base.design.params.diameter).toBe(220);
    expect(current.main.design.params.diameter).toBe(220);
    expect(current.proposed.design.params.diameter).toBe(280);
    expect(current.diff.parameters).toEqual([{ key: "diameter", before: 220, after: 280 }]);
    expect(current.diff.parts.length).toBeGreaterThan(1);
    expect(current.version.baseSnapshotHash).toBe(snapshotHash(owner.snapshot));
    expect(current.canAccept).toBe(true);
  });
  it("accepts atomically once, records provenance and returns the same receipt on replay", () => {
    const { store, owner, versions, view } = setup();
    store.apply(view.version.proposedDesignId, command(view.proposed, { rpm: 9 }));
    const reviewed = versions.view(view.version.id, owner.access.editorToken), input = acceptance(reviewed);
    const result = versions.accept(view.version.id, owner.access.editorToken, input);
    expect(result.snapshot.design.params.rpm).toBe(9);
    expect(result.snapshot.design.revision).toBe(1);
    expect(result.version).toMatchObject({ status: "accepted", acceptedBy: "Maker", acceptedMainRevision: 1, acceptedProposedRevision: 1 });
    expect(result.snapshot.history[0].summary).toContain("Better support");
    expect(versions.accept(view.version.id, owner.access.editorToken, input)).toEqual(result);
    expect(versions.view(view.version.id, owner.access.editorToken).diff.hasChanges).toBe(true);
    expect(store.get(owner.snapshot.design.id).design.revision).toBe(1);
    expect(() => versions.accept(view.version.id, owner.access.editorToken, { ...input, actor: "Other" })).toThrow(/identifier/);
  });
  it("rejects either changed head and mismatched reviewed content without partial acceptance", () => {
    for (const mutate of ["main", "proposed", "hash"] as const) {
      const { store, owner, versions, view } = setup();
      store.apply(view.version.proposedDesignId, command(view.proposed, { rpm: 9 }));
      const reviewed = versions.view(view.version.id, owner.access.editorToken), input = acceptance(reviewed);
      if (mutate === "main") store.apply(owner.snapshot.design.id, command(owner.snapshot, { diameter: 260 }));
      if (mutate === "proposed") store.apply(view.version.proposedDesignId, command(reviewed.proposed, { rpm: 10 }));
      if (mutate === "hash") input.reviewedSnapshotHash = "0".repeat(64);
      const before = store.get(owner.snapshot.design.id);
      expect(() => versions.accept(view.version.id, owner.access.editorToken, input)).toThrow(/changed after/);
      expect(store.get(owner.snapshot.design.id)).toEqual(before);
      expect(versions.record(view.version.id).status).toBe("open");
      expect(store.db.prepare("SELECT COUNT(*) AS n FROM version_receipts").get()).toEqual({ n: 0 });
    }
  });
  it("makes a changed main explicit on renewed comparison", () => {
    const { store, owner, versions, view } = setup();
    store.apply(owner.snapshot.design.id, command(owner.snapshot, { rpm: 10 }));
    expect(versions.view(view.version.id, owner.access.editorToken)).toMatchObject({ mainChangedSinceBase: true,
      diff: { parameters: [{ key: "rpm", before: 10, after: owner.snapshot.design.params.rpm }] } });
  });
  it("never exposes child write tokens to viewers or child editors, and only main editor accepts", () => {
    const { store, owner, versions, view } = setup();
    store.apply(view.version.proposedDesignId, command(view.proposed, { rpm: 9 }));
    const parentViewer = versions.view(view.version.id, owner.access.viewerToken);
    const childEditor = versions.view(view.version.id, view.access!.editorToken);
    expect(parentViewer.access).toBeUndefined(); expect(parentViewer.canAccept).toBe(false);
    expect(childEditor.access).toBeUndefined(); expect(childEditor.canAccept).toBe(false);
    for (const token of [owner.access.viewerToken, view.access!.editorToken, view.access!.viewerToken])
      expect(() => versions.accept(view.version.id, token, acceptance(versions.view(view.version.id, owner.access.editorToken)))).toThrow();
    expect(() => versions.create(owner.snapshot.design.id, owner.access.viewerToken, { actor: "Viewer", expectedRevision: 0 })).toThrow(/viewing/);
  });
  it("bounds agent access to its proposal and revokes access on acceptance", () => {
    const { store, owner, versions, view } = setup();
    const agent = versions.issueAgent(view.version.id, owner.access.editorToken, { role: "designer", label: "Design agent" });
    expect(() => store.authorize(owner.snapshot.design.id, agent.token, true)).toThrow();
    expect(() => store.authorize(view.version.proposedDesignId, agent.token, true)).toThrow();
    expect(() => versions.accept(view.version.id, agent.token, acceptance(view))).toThrow();
    const c = command(view.proposed, { rpm: 9 });
    versions.apply(view.version.id, agent.token, { ...c, actor: "Maker" });
    const reviewed = versions.view(view.version.id, owner.access.editorToken);
    expect(reviewed.proposed.history[0].actor).toBe("Agent designer:" + agent.credential.id);
    versions.accept(view.version.id, owner.access.editorToken, acceptance(reviewed));
    expect(() => versions.agent(view.version.id, agent.token)).toThrow();
    expect(() => store.apply(view.version.proposedDesignId, command(reviewed.proposed, { rpm: 11 }))).toThrow(/closed/);
    expect(versions.credentials(view.version.id, owner.access.editorToken)[0].revokedAt).toBeTruthy();
  });
  it("rejects another proposal’s credential and label-based impersonation during undo", () => {
    const { store, owner, versions, view } = setup();
    const first = versions.issueAgent(view.version.id, owner.access.editorToken, { role: "external", label: "Same name" });
    const second = versions.issueAgent(view.version.id, owner.access.editorToken, { role: "external", label: "Same name" });
    const other = versions.create(owner.snapshot.design.id, owner.access.editorToken, { actor: "Maker", expectedRevision: 0 });
    expect(() => versions.agent(other.version.id, first.token)).toThrow();
    const c = command(view.proposed, { rpm: 9 }); versions.apply(view.version.id, first.token, c);
    expect(() => versions.undo(view.version.id, second.token, c.id, crypto.randomUUID())).toThrow(/own/);
    versions.undo(view.version.id, first.token, c.id, crypto.randomUUID());
    expect(store.get(view.version.proposedDesignId).design.params.rpm).toBe(view.proposed.design.params.rpm);
  });
  it("rejects a proposal without changing main and locks further direct writes", () => {
    const { store, owner, versions, view } = setup();
    const agent = versions.issueAgent(view.version.id, owner.access.editorToken, { role: "engineer", label: "Engineering" });
    const before = store.get(owner.snapshot.design.id);
    expect(versions.reject(view.version.id, owner.access.editorToken).status).toBe("rejected");
    expect(store.get(owner.snapshot.design.id)).toEqual(before);
    expect(() => versions.agent(view.version.id, agent.token)).toThrow();
    expect(() => store.authorize(view.version.proposedDesignId, view.access!.editorToken, true)).toThrow(/closed/);
    expect(() => versions.accept(view.version.id, owner.access.editorToken, acceptance(view))).toThrow(/closed/);
  });
  it("preserves proposed geometry, credentials, ancestry and receipts across restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "versions-test-")); dirs.push(dir);
    const path = join(dir, "db.sqlite"), { store, owner, versions, view } = setup(path);
    const agent = versions.issueAgent(view.version.id, owner.access.editorToken, { role: "external", label: "External CAD agent" });
    versions.apply(view.version.id, agent.token, command(view.proposed, { rpm: 9 }));
    store.close();
    const restored = new Store(path); stores.push(restored);
    const next = new VersionService(restored), reviewed = next.view(view.version.id, owner.access.editorToken);
    expect(reviewed.proposed.design.params.rpm).toBe(9);
    expect(next.agent(view.version.id, agent.token).id).toBe(agent.credential.id);
    const input = acceptance(reviewed), accepted = next.accept(view.version.id, owner.access.editorToken, input);
    restored.close(); const again = new Store(path); stores.push(again);
    expect(new VersionService(again).accept(view.version.id, owner.access.editorToken, input)).toEqual(accepted);
  });
  it("checks preview constraints and preserves independent concurrent edits", () => {
    const { store, owner, versions, view } = setup();
    const agent = versions.issueAgent(view.version.id, owner.access.editorToken, { role: "external", label: "External agent" });
    const c = command(view.proposed, { rpm: 9 });
    expect(versions.preview(view.version.id, agent.token, c).diff.parameters).toHaveLength(1);
    expect(store.get(view.version.proposedDesignId).design.revision).toBe(0);
    expect(() => versions.preview(view.version.id, agent.token, { ...c, changes: { rpm: 99999 } })).toThrow();
    store.apply(view.version.proposedDesignId, command(view.proposed, { diameter: 260 }));
    const changed = versions.apply(view.version.id, agent.token, c);
    expect(changed.design.params).toMatchObject({ diameter: 260, rpm: 9 });
    expect(versions.apply(view.version.id, agent.token, c).design.revision).toBe(2);
    expect(store.get(view.version.proposedDesignId).design.revision).toBe(2);
  });
});
