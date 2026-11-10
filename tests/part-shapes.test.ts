import { describe, expect, it } from "vitest";
import { createDesign, deriveDesign, validateDesign } from "../src/shared/engine";
import { applySemanticEdit, createSelection, getSelectionControls } from "../src/shared/selection";
import { partFeatures, resolveSurfaceFeature, surfaceTargetFromHit } from "../src/shared/surface";
import { featuredGeometry, needsFeaturedGeometry } from "../src/lib/partGeometry";
import { finishFor, isCarbonFibre } from "../src/lib/droneLook";
import type { Part } from "../src/shared/types";

const base = { color: "#69737F", material: "PA12 nylon, printed", process: "print" as const, position: [0, 20, 0] as [number, number, number] };
const shell: Part = { id: "shell", name: "Body shell", shape: "box", size: [120, 30, 56], edgeRadius: 12, wall: 2, ...base };
const ball: Part = { id: "ball", name: "Camera ball", shape: "ellipsoid", size: [26, 26, 26], ...base };
const dome: Part = { id: "dome", name: "Dome", shape: "ellipsoid", size: [80, 30, 80], ...base, position: [0, 80, 0] };
const design = (parts: Part[]) => ({ ...createDesign("custom", "Shapes", parts), id: "shapes", createdAt: "", updatedAt: "" });

describe("rounded boxes and ellipsoids", () => {
  it("validate, scale with the design and describe themselves in the parts list", () => {
    const d = design([shell, ball, dome]);
    validateDesign(d);
    const scaled = deriveDesign({ ...d, params: { ...d.params, scale: 2 } }).parts;
    expect(scaled.find(p => p.id === "shell")).toMatchObject({ size: [240, 60, 112], edgeRadius: 24, wall: 4 });
    const bom = deriveDesign(d).bom;
    expect(bom.find(b => b.id === "shell")!.specification).toBe("120 × 30 × 56 mm / edges rounded, 12 mm radius / hollow shell, 2 mm wall");
    expect(bom.find(b => b.id === "ball")!.specification).toBe("26 mm ball");
    expect(bom.find(b => b.id === "dome")!.specification).toBe("80 mm diameter × 30 mm rounded solid");
  });

  it.each([
    [{ ...shell, edgeRadius: 15 }, "Rounded edges"],
    [{ ...shell, holes: [{ x: 0, z: 0, diameter: 4 }] }, "Rounded edges"],
    [{ ...shell, wall: 12 }, "hollow shell"],
    [{ ...shell, edgeRadius: undefined }, "hollow shell"],
    [{ ...ball, shape: "cylinder" as const, edgeRadius: 2 }, "Rounded edges"],
    [{ ...ball, size: [26, 26, 20] as [number, number, number] }, "diameters must match"],
    [{ ...ball, holeDiameter: 4 }, "ellipsoid"],
    [{ ...ball, holes: [{ x: 0, z: 0, diameter: 3 }] }, "ellipsoid"],
  ])("rejects an impossible variant %#", (part, message) => {
    expect(() => validateDesign(design([part as Part]))).toThrow(new RegExp(message, "i"));
  });

  it("points at a rounded box's flat faces and its rounded edge, and at an ellipsoid's surface", () => {
    expect(resolveSurfaceFeature(shell, [0, 15, 0], [0, 1, 0]).id).toBe("face+y");
    const r = 12, c = Math.SQRT1_2;
    const edge = resolveSurfaceFeature(shell, [60 - r + r * c, 15 - r + r * c, 0], [c, c, 0]);
    expect(edge).toMatchObject({ id: "edge", kind: "edge", label: "rounded edge, 12 mm radius" });
    expect(partFeatures(shell).map(f => f.feature.id)).toEqual(["face+x", "face-x", "face+y", "face-y", "face+z", "face-z", "edge"]);
    expect(resolveSurfaceFeature(ball, [0, 13, 0], [0, 1, 0])).toMatchObject({ id: "outer", label: "ball surface Ø26 mm" });
    expect(resolveSurfaceFeature(dome, [40, 0, 0], [1, 0, 0]).label).toBe("rounded surface Ø80 × 30 mm");
    expect(partFeatures(dome).map(f => f.feature.id)).toEqual(["outer"]);
    expect(surfaceTargetFromHit(ball, [9, 9, 0], [0.7, 0.7, 0]).featureId).toBe("outer");
  });

  it("edits an ellipsoid's diameter on both axes and labels its controls plainly", () => {
    const d = design([ball]), snapshot = { design: d, derived: deriveDesign(d), history: [], role: "editor" as const };
    const selection = createSelection(snapshot, ["ball"], "click");
    expect(getSelectionControls(snapshot, selection).map(c => c.label)).toEqual(["Diameter", "Height"]);
    const preview = applySemanticEdit(snapshot, selection, { type: "dimension", axis: "x", value: 30 });
    expect(preview.command.customParts![0].size).toEqual([30, 26, 30]);
  });

  it("draws exactly the declared outline", () => {
    expect(needsFeaturedGeometry(shell) && needsFeaturedGeometry(ball)).toBe(true);
    const g = featuredGeometry(dome); g.computeBoundingBox();
    expect(g.boundingBox!.max.toArray().map(v => Math.round(v * 1000) / 1000)).toEqual([40, 15, 40]);
    const b = featuredGeometry(shell); b.computeBoundingBox();
    expect(b.boundingBox!.max.toArray().map(v => Math.round(v * 1000) / 1000)).toEqual([60, 15, 28]);
  });
});

describe("render finishes", () => {
  it("match whole material names, so polycarbonate and carbon steel are not carbon fibre", () => {
    expect(isCarbonFibre("Carbon fibre plate (3K twill)")).toBe(true);
    expect(isCarbonFibre("Polycarbonate 5 in two-blade propeller (purchased)")).toBe(false);
    expect(isCarbonFibre("Carbon steel")).toBe(false);
  });
  it("keep a thin aluminium plate aluminium and a printed shell its declared colour", () => {
    expect(finishFor({ color: "#C8CDD1", material: "Aluminium 6061", process: "machine", size: [120, 3, 80] }).color).toBe("#A9B3BF");
    expect(finishFor({ color: "#69737F", material: "PA12 nylon, printed", process: "print", size: [120, 30, 56] }).color).toBe("#69737F");
  });
});
