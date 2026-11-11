import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDesign, deriveDesign } from "../src/shared/engine";
import type { Part, Snapshot, Vec3 } from "../src/shared/types";
import { createSelection, resolveSelectionSurface, type SelectionRef } from "../src/shared/selection";
import { localSurfaceEdit, partFeatures, resolveSurfaceFeature, resolveSurfaceTarget, surfaceConflict, surfaceTargetFromHit, type ResolvedSurfaceTarget } from "../src/shared/surface";
import { deskArmParts } from "../src/shared/desk-arm";
import { Store } from "../server/store";
import { editMatchesTarget, parseTargetEdit, propose } from "../server/proposals";
import { cycleSurface, freezeTarget, targetLabel, withoutSurface } from "../src/lib/pointing";

afterEach(() => vi.unstubAllGlobals());
const arm = (): Snapshot => {
  const design = createDesign("custom", "Camera arm", deskArmParts());
  return { design, derived: deriveDesign(design), history: [], role: "editor" };
};
const part = (snapshot: Snapshot, id: string) => snapshot.derived.parts.find(p => p.id === id)!;
const pointAt = (snapshot: Snapshot, id: string, point: Vec3, normal: Vec3, source: SelectionRef["source"] = "click") =>
  createSelection(snapshot, [id], source, surfaceTargetFromHit(part(snapshot, id), point, normal));
const resolved = (snapshot: Snapshot, selection: SelectionRef) => resolveSelectionSurface(snapshot, selection)!;

describe("hit to feature resolution", () => {
  const snapshot = arm(), upper = part(snapshot, "upper-arm"), column = part(snapshot, "column");
  it("names planar faces of the upper link by local axis, with end faces on the long axis", () => {
    expect(resolveSurfaceFeature(upper, [0, 2, 5], [0, 1, 0])).toMatchObject({ id: "face+y", label: "top face" });
    expect(resolveSurfaceFeature(upper, [0, -2, 5], [0, -1, 0])).toMatchObject({ id: "face-y", label: "bottom face" });
    expect(resolveSurfaceFeature(upper, [55, 0, 3], [1, 0, 0])).toMatchObject({ id: "face+x", label: "+X end face", dimensions: { sizeY: 4, sizeZ: 24 } });
    expect(resolveSurfaceFeature(upper, [-55, 1, -3], [-1, 0, 0])).toMatchObject({ id: "face-x", label: "−X end face" });
    expect(resolveSurfaceFeature(upper, [10, 0, 12], [0, 0, 1])).toMatchObject({ id: "face+z", label: "+Z side face" });
  });
  it("resolves holes by position from their wall or the face around their rim", () => {
    expect(resolveSurfaceFeature(upper, [-45 + 3.2, 0, 0], [-1, 0, 0])).toMatchObject({ id: "hole-0", kind: "hole", holeIndex: 0, label: "Ø6.4 mm hole 1", dimensions: { diameter: 6.4, centerX: -45 } });
    expect(resolveSurfaceFeature(upper, [45, -1, 3.2], [0, 0, -1])).toMatchObject({ id: "hole-1", label: "Ø6.4 mm hole 2" });
    expect(resolveSurfaceFeature(upper, [45 + 4.5, 2, 0], [0, 1, 0]).id).toBe("hole-1");
    expect(resolveSurfaceFeature(upper, [45 + 6, 2, 0], [0, 1, 0]).id).toBe("face+y");
  });
  it("separates a tube bore, outer surface and end faces", () => {
    expect(resolveSurfaceFeature(column, [12.5, 0, 0], [1, 0, 0])).toMatchObject({ id: "outer", label: "outer surface Ø25 mm" });
    expect(resolveSurfaceFeature(column, [0, 5, 3.5], [0, 0, -1])).toMatchObject({ id: "bore", label: "Ø7 mm bore" });
    expect(resolveSurfaceFeature(column, [0, 30, 8], [0, 1, 0])).toMatchObject({ id: "face+y", label: "top end face" });
  });
  it("recognizes counterbores and channels, and falls back to a described face otherwise", () => {
    const plate: Part = { id: "plate", name: "Mounting plate", shape: "box", size: [80, 8, 60], position: [0, 4, 0], color: "#A2C7FF", material: "PETG", process: "print",
      holes: [{ x: 20, z: 0, diameter: 6, counterbore: { diameter: 12, depth: 3 } }], channel: { width: 20, depth: 3 } };
    expect(resolveSurfaceFeature(plate, [24, 1, 0], [0, 1, 0]).id).toBe("hole-0");
    expect(resolveSurfaceFeature(plate, [26, 2.5, 0], [-1, 0, 0]).id).toBe("hole-0");
    expect(resolveSurfaceFeature(plate, [-10, -1, 0], [0, -1, 0])).toMatchObject({ id: "channel", label: "underside channel 20 mm wide" });
    expect(resolveSurfaceFeature(plate, [-10, -4, 25], [0, -1, 0]).id).toBe("face-y");
    // An unnamed surface reads as plain words, never coordinates or a normal vector.
    expect(resolveSurfaceFeature(upper, [10, 0, 0], [0.7071, 0.7071, 0])).toMatchObject({ id: "surface", kind: "surface", label: "curved surface", short: "curved surface" });
    expect(resolveSurfaceFeature(column, [0, 5, 20], [0, 0, 1])).toMatchObject({ id: "surface", kind: "surface", label: "surface" });
  });
  it("lists only declared features, each with a target that resolves back to itself", () => {
    expect(partFeatures(upper).map(f => f.feature.id)).toEqual(["hole-0", "hole-1", "face+x", "face-x", "face+y", "face-y", "face+z", "face-z"]);
    expect(partFeatures(column).map(f => f.feature.id)).toEqual(["bore", "outer", "face+y", "face-y"]);
    for (const p of snapshot.derived.parts) for (const { feature, target } of partFeatures(p))
      expect(resolveSurfaceFeature(p, target.point, target.normal).id, `${p.id} ${feature.id}`).toBe(feature.id);
    // The base plate's 26 mm hole sits under its top-face centre; the face target moves off it.
    const base = part(snapshot, "base-plate"), top = partFeatures(base).find(f => f.feature.id === "face+y")!;
    expect(resolveSurfaceFeature(base, top.target.point, top.target.normal).id).toBe("face+y");
  });
});

describe("target serialization and validation", () => {
  it("round-trips a rounded target through JSON and the selection contract", () => {
    const snapshot = arm(), selection = pointAt(snapshot, "upper-arm", [-41.80412, 0.123456, 0.000001], [-0.99999, 0.00001, 0]);
    expect(selection.surface).toEqual({ partId: "upper-arm", featureId: "hole-0", point: [-41.8, 0.12, 0], normal: [-1, 0, 0] });
    const wire = JSON.parse(JSON.stringify(selection));
    expect(resolved(snapshot, wire)).toMatchObject({ partName: "Upper arm link", label: "Upper arm link, Ø6.4 mm hole 1" });
  });
  it("rejects a forged feature, another part, an out-of-part point and non-finite values", () => {
    const snapshot = arm(), good = pointAt(snapshot, "upper-arm", [55, 0, 0], [1, 0, 0]);
    expect(() => createSelection(snapshot, ["upper-arm"], "click", { ...good.surface!, featureId: "hole-0" })).toThrow("Point at it again");
    expect(() => createSelection(snapshot, ["lower-arm"], "click", good.surface)).toThrow("one targeted part");
    expect(() => createSelection(snapshot, ["upper-arm", "lower-arm"], "click", good.surface)).toThrow("one targeted part");
    expect(() => createSelection(snapshot, ["upper-arm"], "click", { ...good.surface!, point: [500, 0, 0] })).toThrow("outside this part");
    expect(() => createSelection(snapshot, ["upper-arm"], "click", { ...good.surface!, normal: [NaN, 0, 0] })).toThrow("not valid");
    expect(() => resolveSurfaceTarget(snapshot.derived.parts, ["upper-arm"], null)).toThrow("not valid");
  });
  it("a geometry change after pointing invalidates the frozen feature instead of rebinding it", () => {
    const snapshot = arm(), selection = pointAt(snapshot, "upper-arm", [-45 + 3.2, 0, 0], [-1, 0, 0]);
    const moved = structuredClone(snapshot);
    moved.design.customParts!.find(p => p.id === "upper-arm")!.holes![0].x = -30;
    moved.derived = deriveDesign(moved.design);
    expect(() => resolveSelectionSurface(moved, selection)).toThrow("Point at it again");
  });
});

describe("deictic binding", () => {
  const snapshot = arm(), upper = part(snapshot, "upper-arm");
  const hole = resolved(snapshot, pointAt(snapshot, "upper-arm", [-45 + 3.2, 0, 0], [-1, 0, 0]));
  const top = resolved(snapshot, pointAt(snapshot, "upper-arm", [0, 2, 5], [0, 1, 0]));
  const end = resolved(snapshot, pointAt(snapshot, "upper-arm", [55, 0, 3], [1, 0, 0]));
  it("accepts wording that agrees with the pointed feature", () => {
    for (const [prompt, target] of [["make this hole 8 mm", hole], ["Widen hole 1 to 8 mm", hole], ["make this thicker", top], ["make this end 130 mm long", end]] as [string, ResolvedSurfaceTarget][])
      expect(surfaceConflict(prompt, target), prompt).toBeNull();
  });
  it("turns a request naming another feature into a clarification", () => {
    expect(surfaceConflict("make hole 2 8 mm", hole)).toContain("names hole 2");
    expect(surfaceConflict("make the second hole 8 mm", hole)).toContain("names hole 2");
    expect(surfaceConflict("move that end 10 mm", hole)).toContain("“that end”");
    expect(surfaceConflict("make this hole bigger", top)).toContain("“this hole”");
    expect(surfaceConflict("make this top 6 mm", end)).toContain("Upper arm link, +X end face");
  });
  it("binds fully specified measurements deterministically and leaves the rest to the assistant", () => {
    expect(localSurfaceEdit("make this hole 8 mm", hole, upper)).toEqual({ type: "hole", holeIndex: 0, diameter: 8 });
    expect(localSurfaceEdit("Make hole 1 8.5mm", hole, upper)).toEqual({ type: "hole", holeIndex: 0, diameter: 8.5 });
    expect(localSurfaceEdit("make this 6 mm thick", top, upper)).toEqual({ type: "dimension", axis: "y", value: 6 });
    expect(localSurfaceEdit("make this end 130 mm long", end, upper)).toEqual({ type: "dimension", axis: "x", value: 130 });
    for (const [prompt, target] of [["make this thicker", top], ["make this hole 8 mm deep", hole], ["make this hole 0.3 in", hole], ["move that end 10 mm", end],
      ["widen this hole for an M8 bolt", hole], ["make this 6 mm wide", top]] as [string, ResolvedSurfaceTarget][])
      expect(localSurfaceEdit(prompt, target, upper), prompt).toBeNull();
  });
  it("checks model edits for shape and for the pointed feature", () => {
    expect(parseTargetEdit({ type: "hole", holeIndex: 0, diameter: 8 })).toEqual({ type: "hole", holeIndex: 0, diameter: 8 });
    for (const bad of [null, [], { type: "hole", holeIndex: -1, diameter: 8 }, { type: "hole", holeIndex: 0, diameter: 8, extra: 1 }, { type: "dimension", axis: "w", value: 3 }, { type: "code", value: "x" }])
      expect(() => parseTargetEdit(bad)).toThrow("unsupported targeted edit");
    expect(editMatchesTarget({ type: "hole", holeIndex: 0, diameter: 8 }, hole)).toBe(true);
    expect(editMatchesTarget({ type: "hole", holeIndex: 1, diameter: 8 }, hole)).toBe(false);
    expect(editMatchesTarget({ type: "hole", holeIndex: 0, diameter: 8 }, top)).toBe(false);
    expect(editMatchesTarget({ type: "dimension", axis: "y", value: 6 }, top)).toBe(true);
  });
});

describe("proposal requests bound to a pointed feature", () => {
  const withStore = async (run: (store: Store) => Promise<void>) => {
    const dir = mkdtempSync(join(tmpdir(), "surface-target-")), store = new Store(join(dir, "s.sqlite"));
    try { await run(store); } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  };
  const reply = (proposal: unknown) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(proposal) }] }], usage: { input_tokens: 0, output_tokens: 0 } });
  const holeSelection = (snapshot: Snapshot) => pointAt(snapshot, "upper-arm", [-45 + 3.2, 0, 0], [-1, 0, 0], "hover");

  it("changes only the pointed hole without any assistant request", async () => withStore(async store => {
    const { snapshot } = store.create("custom", "Camera arm", deskArmParts());
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const result = await propose(store, snapshot, { prompt: "make this hole 8 mm", actor: "Owner", selection: holeSelection(snapshot) }, "test-credential");
    expect(fetch).not.toHaveBeenCalled();
    expect(result.target).toEqual({ partIds: ["upper-arm"], featureId: "hole-0", label: "Upper arm link, Ø6.4 mm hole 1" });
    const before = snapshot.design.customParts!, after = result.command.customParts!;
    expect(after.find(p => p.id === "upper-arm")!.holes).toEqual([{ x: -45, z: 0, diameter: 8 }, { x: 45, z: 0, diameter: 6.4 }]);
    expect({ ...after.find(p => p.id === "upper-arm")!, holes: undefined }).toEqual({ ...before.find(p => p.id === "upper-arm")!, holes: undefined });
    expect(after.filter(p => p.id !== "upper-arm")).toEqual(before.filter(p => p.id !== "upper-arm"));
    expect(result.questions).toEqual([]);
  }));

  it("asks instead of guessing when the request names a different feature, before any spending", async () => withStore(async store => {
    const { snapshot } = store.create("custom", "Camera arm", deskArmParts());
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const result = await propose(store, snapshot, { prompt: "make hole 2 8 mm", actor: "Owner", selection: holeSelection(snapshot) }, "test-credential");
    expect(fetch).not.toHaveBeenCalled();
    expect(result.command.customParts).toBeUndefined(); expect(result.command.changes).toEqual({});
    expect(result.explanation).toContain("names hole 2"); expect(result.questions).toHaveLength(1);
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM ai_usage").get()).toEqual({ n: 0 });
  }));

  it("sends the structured target to the assistant and applies its edit through the validated rules", async () => withStore(async store => {
    const { snapshot } = store.create("custom", "Camera arm", deskArmParts());
    let sent: any;
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: any) => {
      if (url.endsWith("/input_tokens")) return new Response(JSON.stringify({ input_tokens: 4000 }));
      sent = JSON.parse(options.body);
      return new Response(JSON.stringify(reply({ changes: {}, partChanges: null, customParts: null, targetEdit: { type: "hole", holeIndex: 0, diameter: 8.4 }, explanation: "Hole 1 now clears an M8 bolt.", questions: [] })));
    }));
    const result = await propose(store, snapshot, { prompt: "widen this hole for an M8 bolt", actor: "Owner", selection: holeSelection(snapshot) }, "test-credential");
    const context = JSON.parse(sent.instructions.match(/Source design=(\{.*\})\. For a selected-part/)[1]);
    expect(context.pointedTarget).toMatchObject({ partId: "upper-arm", partName: "Upper arm link", feature: { id: "hole-0", kind: "hole", holeIndex: 0, dimensionsMm: { diameter: 6.4, centerX: -45 } }, hitPointMm: [-41.8, 0, 0], surfaceNormal: [-1, 0, 0] });
    expect(sent.instructions).toContain("Deictic words such as this, that, here, it, this hole and that end refer to pointedTarget only");
    expect(result.source).toBe("ai"); expect(result.explanation).toBe("Hole 1 now clears an M8 bolt.");
    expect(result.command.customParts!.find(p => p.id === "upper-arm")!.holes![0].diameter).toBe(8.4);
    expect(result.command.customParts!.find(p => p.id === "upper-arm")!.holes![1].diameter).toBe(6.4);
  }));

  it.each([
    [{ changes: {}, targetEdit: { type: "hole", holeIndex: 1, diameter: 8 }, questions: [] }, "does not match"],
    [{ changes: {}, partChanges: [{ id: "lower-arm", size: [120, 6, 24] }], questions: [] }, "other than Upper arm link"],
  ])("refuses an assistant edit that leaves the pointed feature", async (answer, message) => withStore(async store => {
    const { snapshot } = store.create("custom", "Camera arm", deskArmParts());
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/input_tokens") ? { input_tokens: 4000 } : reply(answer)))));
    const result = await propose(store, snapshot, { prompt: "widen this hole for an M8 bolt", actor: "Owner", selection: holeSelection(snapshot) }, "test-credential");
    expect(result.explanation).toContain(message); expect(result.command.customParts).toBeUndefined(); expect(result.command.changes).toEqual({});
  }));

  it("keeps a typed request without a key honest, and rejects a stale pointed feature", async () => withStore(async store => {
    const { snapshot } = store.create("custom", "Camera arm", deskArmParts());
    const result = await propose(store, snapshot, { prompt: "make this a bit sturdier", actor: "Owner", selection: holeSelection(snapshot) }, "");
    expect(result.explanation).toContain("needs the design assistant"); expect(result.target?.label).toBe("Upper arm link, Ø6.4 mm hole 1");
    const forged = { ...holeSelection(snapshot), surface: { ...holeSelection(snapshot).surface!, featureId: "face+x" } };
    await expect(propose(store, snapshot, { prompt: "make this 8 mm", actor: "Owner", selection: forged }, "")).rejects.toThrow("Point at it again");
  }));
});

describe("client pointing state", () => {
  it("freezes the full surface at speech onset; later pointer targets cannot change it", () => {
    const snapshot = arm();
    let hovered: SelectionRef | null = pointAt(snapshot, "upper-arm", [-45 + 3.2, 0, 0], [-1, 0, 0], "hover");
    const frozen = freezeTarget(hovered)!;
    hovered.surface!.featureId = "face+y"; hovered.surface!.point[0] = 0;
    hovered = pointAt(snapshot, "lower-arm", [0, 2, 5], [0, 1, 0], "hover");
    expect(frozen.surface).toEqual({ partId: "upper-arm", featureId: "hole-0", point: [-41.8, 0, 0], normal: [-1, 0, 0] });
    expect(targetLabel(snapshot, frozen)).toBe("Upper arm link, Ø6.4 mm hole 1");
    expect(freezeTarget(null)).toBeNull();
  });
  it("clearing the chip removes only the surface and keeps the part target", () => {
    const snapshot = arm(), pinned = pointAt(snapshot, "upper-arm", [0, 2, 5], [0, 1, 0]);
    const cleared = withoutSurface(pinned);
    expect(cleared).toEqual({ designId: snapshot.design.id, revision: 0, partIds: ["upper-arm"], source: "click" });
    expect("surface" in cleared).toBe(false);
    expect(targetLabel(snapshot, cleared)).toBe("Upper arm link");
    expect(pinned.surface).toBeDefined();
  });
  it("labels a stale pointed surface without throwing", () => {
    const snapshot = arm(), pinned = pointAt(snapshot, "upper-arm", [0, 2, 5], [0, 1, 0]);
    expect(targetLabel(snapshot, { ...pinned, surface: { ...pinned.surface!, featureId: "hole-0" } })).toBe("a surface that has changed");
    expect(targetLabel(snapshot, null)).toBe("");
  });
  it("cycles declared features in both directions and wraps through the whole part", () => {
    const snapshot = arm(), base = createSelection(snapshot, ["upper-arm"], "list");
    const order: string[] = [];
    let current = base;
    for (let i = 0; i < 9; i++) { current = cycleSurface(snapshot, current, 1); order.push(current.surface?.featureId || "part"); }
    expect(order).toEqual(["hole-0", "hole-1", "face+x", "face-x", "face+y", "face-y", "face+z", "face-z", "part"]);
    expect(cycleSurface(snapshot, base, -1).surface?.featureId).toBe("face-z");
    // Every keyboard-cycled target passes the same server validation as a pointer hit.
    current = base;
    for (let i = 0; i < 8; i++) { current = cycleSurface(snapshot, current, 1); expect(() => createSelection(snapshot, ["upper-arm"], "list", current.surface)).not.toThrow(); }
    const multi = createSelection(snapshot, ["upper-arm", "lower-arm"], "circle");
    expect(cycleSurface(snapshot, multi, 1)).toBe(multi);
  });
});
