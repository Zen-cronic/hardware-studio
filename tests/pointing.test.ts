import { describe, expect, it } from "vitest";
import { Store } from "../server/store";
import { droneParts } from "../src/shared/drone";
import { assertCurrentSelection, createSelection } from "../src/shared/selection";
import { partFeatures } from "../src/shared/surface";
import { currentTarget } from "../src/lib/pointing";

describe("the target pinned when the mic is held", () => {
  it("moves a target from before an applied change to the current revision, without its old surface", () => {
    const store = new Store(":memory:");
    const created = store.create("custom", "Camera drone", droneParts());
    const s0 = store.get(created.snapshot.design.id);
    const arm = s0.derived.parts.find(p => p.id === "arm-front-left")!;
    const pinned = createSelection(s0, [arm.id], "click", partFeatures(arm).find(f => f.feature.id === "face+y")!.target);
    const customParts = s0.design.customParts!.map(p => p.id === arm.id ? { ...p, size: [p.size[0], 6, p.size[2]] as typeof p.size } : p);
    const s1 = store.apply(s0.design.id, { id: "thicker", actor: "Maker", baseRevision: 0, changes: {}, readSet: { ...s0.design.params }, customParts });
    expect(() => assertCurrentSelection(s1, pinned)).toThrow(/changed/);
    const moved = currentTarget(s1, pinned)!;
    expect(moved).toMatchObject({ designId: s1.design.id, revision: s1.design.revision, partIds: [arm.id] });
    expect(moved.surface).toBeUndefined();
    expect(() => assertCurrentSelection(s1, moved)).not.toThrow();
    expect(currentTarget(s1, { ...pinned, partIds: ["gone"] })).toBeNull();
    expect(currentTarget(s0, pinned)).toBe(pinned);
  });
});
