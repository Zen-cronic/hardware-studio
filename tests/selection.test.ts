import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createDesign, deriveDesign } from "../src/shared/engine";
import type { Part, ProductKind, Snapshot } from "../src/shared/types";
import { applySemanticEdit, createSelection, getSelectionControls } from "../src/shared/selection";
import { decodeSelectionPixels, pointInPolygon, visiblePartsInPolygon } from "../src/lib/selection";

const snap = (kind: ProductKind, customParts?: Part[]): Snapshot => {
  const design = createDesign(kind, undefined, customParts);
  return { design, derived: deriveDesign(design), history: [], role: "editor" };
};
const plate: Part = { id: "plate", name: "Mounting plate", shape: "box", size: [80, 8, 60], position: [0, 4, 0],
  holes: [{ x: 20, z: 0, diameter: 6, counterbore: { diameter: 12, depth: 3 } }],
  material: "Aluminium 6061", process: "machine", color: "#A2C7FF" };

describe("grounded semantic edits", () => {
  const examples: [ProductKind, string, string, number][] = [
    ["turntable", "platter", "diameter", 280], ["slider", "rail-front", "travel", 650],
    ["conveyor", "bed", "beltWidth", 140], ["lamp", "lower-arm", "reach", 350],
    ["planter", "pot-0", "pots", 4], ["holder", "jaw-moving", "opening", 100],
  ];
  for (const [kind, partId, key, value] of examples) it(`${kind} selection regenerates its linked assembly`, () => {
    const before = snap(kind), original = structuredClone(before);
    const selection = createSelection(before, [partId], "circle");
    expect(getSelectionControls(before, selection).some(control => control.id === key)).toBe(true);
    const result = applySemanticEdit(before, selection, { type: "parameter", key, value });
    expect(result.command.changes).toEqual({ [key]: value });
    expect(result.preview.design.params[key]).toBe(value);
    expect(result.preview.derived).toEqual(deriveDesign(result.preview.design));
    expect(result.affectedPartIds.length).toBeGreaterThan(1);
    expect(before).toEqual(original);
  });
  it("keeps the legacy mechanism's own limits and fixed standard-parts controls", () => {
    const standard = snap("turntable");
    expect(getSelectionControls(standard, createSelection(standard, ["shaft"])).some(c => c.id === "shaftDiameter")).toBe(false);
    const legacy = structuredClone(standard);
    delete legacy.design.mechanismVersion;
    legacy.design.params.height = 55;
    legacy.derived = deriveDesign(legacy.design);
    expect(getSelectionControls(legacy, createSelection(legacy, ["shaft"])).some(c => c.id === "shaftDiameter")).toBe(true);
    const result = applySemanticEdit(legacy, createSelection(legacy, ["shaft"]), { type: "parameter", key: "shaftDiameter", value: 12 });
    expect(result.preview.design.mechanismVersion).toBeUndefined();
    expect(result.preview.derived.parts.find(p => p.id === "hub")!.holeDiameter).toBe(12.2);
  });
  it("rejects wrong designs, stale revisions, absent parts and viewer changes", () => {
    const before = snap("custom", [plate]), selection = createSelection(before, ["plate"]);
    const edit = { type: "dimension" as const, axis: "y" as const, value: 10 };
    expect(() => applySemanticEdit({ ...before, design: { ...before.design, revision: 1 } }, selection, edit)).toThrow("Select the part again");
    expect(() => applySemanticEdit(before, { ...selection, designId: "another-design" }, edit)).toThrow("Select the part again");
    expect(() => createSelection(before, ["missing"])).toThrow("no longer");
    expect(() => applySemanticEdit({ ...before, role: "viewer" }, selection, edit)).toThrow("View-only");
  });
  it("enlarges and shrinks a specific hole while retaining counterbore and position", () => {
    const before = snap("custom", [plate]), selection = createSelection(before, ["plate"]);
    for (const diameter of [4, 8]) {
      const result = applySemanticEdit(before, selection, { type: "hole", holeIndex: 0, diameter });
      const hole = result.preview.derived.parts[0].holes![0];
      expect(hole).toEqual({ ...plate.holes![0], diameter });
      expect(result.preview.derived.parts[0].position).toEqual(plate.position);
      expect(result.command.customParts![0].holes![0].diameter).toBe(diameter);
    }
    expect(() => applySemanticEdit(before, selection, { type: "hole", holeIndex: 0, diameter: 12 })).toThrow("counterbore");
  });
  it("edits displayed millimetres correctly when custom source geometry is scaled", () => {
    const before = snap("custom", [plate]); before.design.params.scale = 2; before.derived = deriveDesign(before.design);
    const selection = createSelection(before, ["plate"]);
    const result = applySemanticEdit(before, selection, { type: "dimension", axis: "y", value: 20 });
    expect(result.command.customParts![0].size[1]).toBe(10);
    expect(result.preview.derived.parts[0].size[1]).toBe(20);
    expect(result.preview.derived.parts[0].holes).toEqual(before.derived.parts[0].holes);
  });
  it("updates tube bore for wall thickness and preserves the outside", () => {
    const tube: Part = { ...plate, id: "tube", shape: "tube", size: [30, 15, 30], holes: undefined, holeDiameter: 24 };
    const before = snap("custom", [tube]), selection = createSelection(before, ["tube"]);
    const result = applySemanticEdit(before, selection, { type: "wallThickness", value: 5 });
    expect(result.preview.derived.parts[0].holeDiameter).toBe(20);
    expect(result.preview.derived.parts[0].size).toEqual(tube.size);
  });
  it("rejects ambiguous local edits, direct preset resizes, unsupported controls and broken walls", () => {
    const before = snap("custom", [plate, { ...plate, id: "other", position: [150, 4, 0] }]);
    expect(() => applySemanticEdit(before, createSelection(before, ["plate", "other"]), { type: "dimension", axis: "y", value: 10 })).toThrow("Choose one part");
    expect(() => applySemanticEdit(before, createSelection(before, ["plate"]), { type: "dimension", axis: "x", value: 20 })).toThrow("inside");
    const standard = snap("turntable"), selection = createSelection(standard, ["platter"]);
    expect(() => applySemanticEdit(standard, selection, { type: "dimension", axis: "x", value: 280 })).toThrow("linked assembly");
    expect(() => applySemanticEdit(standard, selection, { type: "parameter", key: "payload", value: 3 })).toThrow("does not belong");
    expect(() => applySemanticEdit(standard, selection, { type: "parameter", key: "diameter", value: Infinity })).toThrow("finite");
  });
  it("keeps purchased and reference dimensions out of fabrication edits", () => {
    const before = snap("custom", [{ ...plate, process: "buy" }]);
    const selection = createSelection(before, ["plate"], "list");
    expect(getSelectionControls(before, selection)).toEqual([]);
    expect(() => applySemanticEdit(before, selection, { type: "dimension", axis: "y", value: 10 })).toThrow("purchased");
  });
});

describe("visible pixel circle selection", () => {
  const polygon = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }];
  it("decodes only covered front-surface IDs, with correct top/bottom origin", () => {
    const pixels = new Uint8Array(4 * 4 * 4);
    // Framebuffer top-left is source row 3. Hidden geometry has no pixel.
    pixels[(3 * 4 + 1) * 4] = 1;
    pixels[(2 * 4 + 2) * 4] = 2;
    pixels[(0 * 4 + 2) * 4] = 3;
    const ids = new Map([[1, "front"], [2, "beside"], [3, "outside"], [4, "occluded"]]);
    expect(decodeSelectionPixels(pixels, 4, 4, polygon, ids)).toEqual(["beside", "front"]);
  });
  it("handles concave polygons, edges and tiny accidental strokes", () => {
    const concave = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 5 }, { x: 0, y: 5 }];
    expect(pointInPolygon({ x: 4, y: 4 }, concave)).toBe(false);
    expect(pointInPolygon({ x: 2, y: 2 }, concave)).toBe(true);
    expect(decodeSelectionPixels(new Uint8Array(16), 2, 2, [{ x: 0, y: 0 }, { x: 1, y: 0 }], new Map())).toEqual([]);
  });
  it("restores rendering state when framebuffer readback fails", () => {
    const scene = new THREE.Scene(), original = new THREE.MeshStandardMaterial();
    const part = new THREE.Mesh(new THREE.BoxGeometry(), original); part.userData.partId = "part";
    const decoration = new THREE.Mesh(new THREE.BoxGeometry(), original); scene.add(part, decoration);
    const background = new THREE.Color("#123456"); scene.background = background;
    let currentTarget: unknown = null, scissor = true, color = new THREE.Color("#abcdef"), alpha = .5;
    const renderer = { autoClear: false,
      getRenderTarget: () => currentTarget, setRenderTarget: (target: unknown) => { currentTarget = target; },
      getClearColor: (target: THREE.Color) => target.copy(color), getClearAlpha: () => alpha,
      setClearColor: (next: THREE.ColorRepresentation, nextAlpha: number) => { color = new THREE.Color(next); alpha = nextAlpha; },
      getViewport: (target: THREE.Vector4) => target.set(0, 0, 10, 10), setViewport: () => {},
      getScissor: (target: THREE.Vector4) => target.set(0, 0, 10, 10), setScissor: () => {},
      getScissorTest: () => scissor, setScissorTest: (next: boolean) => { scissor = next; },
      clear: () => {}, render: () => { expect(part.material).not.toBe(original); expect(decoration.visible).toBe(false); },
      readRenderTargetPixels: () => { throw new Error("driver unavailable"); },
    };
    expect(() => visiblePartsInPolygon(renderer as unknown as THREE.WebGLRenderer, scene, new THREE.PerspectiveCamera(), 4, 4, polygon)).toThrow("driver unavailable");
    expect(part.material).toBe(original); expect(decoration.visible).toBe(true); expect(scene.background).toBe(background);
    expect(currentTarget).toBeNull(); expect(renderer.autoClear).toBe(false); expect(scissor).toBe(true);
    expect(color.getHexString()).toBe("abcdef"); expect(alpha).toBe(.5);
    part.geometry.dispose(); decoration.geometry.dispose(); original.dispose();
  });
});
