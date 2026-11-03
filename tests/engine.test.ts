import { describe, it, expect } from "vitest";
import { CATALOG, defaultParams } from "../src/shared/catalog";
import {
  createDesign,
  deriveDesign,
  validateDesign,
  readSetFor,
  validateParts,
} from "../src/shared/engine";
import type { ProductKind } from "../src/shared/types";
const heldout: Record<string, Record<string, number>[]> = {
  turntable: [{ diameter: 280 }, { height: 200 }],
  slider: [{ travel: 725 }, { speed: 85 }],
  conveyor: [{ length: 750 }, { sensorPosition: 300 }],
  lamp: [{ reach: 400 }, { brightness: 25 }],
  planter: [{ pots: 5 }, { reservoirHeight: 100 }],
  holder: [{ opening: 160 }, { angle: 25 }],
};
describe("canonical hardware engine", () => {
  for (const product of CATALOG) {
    it(
      product.kind +
        " derives two unseen edits, complete assemblies and measurable geometry",
      () => {
        const base = createDesign(product.kind);
        const before = deriveDesign(base);
        expect(before.parts.length).toBeGreaterThan(5);
        expect(before.steps.length).toBeGreaterThan(2);
        validateParts(before.parts);
        for (const edit of heldout[product.kind]) {
          const changed = { ...base, params: { ...base.params, ...edit } };
          const after = deriveDesign(changed);
          validateParts(after.parts);
          expect(after).not.toEqual(before);
          expect(
            after.bom.every((b) =>
              after.parts.some((p) => p.id === b.id && p.role !== "reference"),
            ),
          ).toBe(true);
          expect(
            after.steps.every((s) =>
              s.partIds.every((id) => after.parts.some((p) => p.id === id)),
            ),
          ).toBe(true);
        }
        const key = product.parameters[0];
        expect(() =>
          validateDesign({
            ...base,
            params: { ...base.params, [key.key]: key.max + 1000 },
          }),
        ).toThrow();
      },
    );
  }
  it("legacy shaft edits preserve the original geometry contract", () => {
    const d = createDesign("turntable");
    const a = deriveDesign({
      ...d,
      mechanismVersion: undefined,
      params: { ...d.params, height: 55, shaftDiameter: 12 },
    });
    expect(a.parts.find((p) => p.id === "hub")?.holeDiameter).toBe(12.2);
    expect(a.bom.find((b) => b.id === "hub")?.specification).toContain("12.2");
    expect(a.connections[0].description).toContain("12.2");
  });
  it("rejects unknown/nonfinite params and coupled geometry", () => {
    const d = createDesign("conveyor");
    for (const params of [
      { ...d.params, length: 300, sensorPosition: 250 },
      { ...d.params, speed: Infinity },
      { ...d.params, newThing: 3 },
    ])
      expect(() => validateDesign({ ...d, params })).toThrow();
  });
  it("retains dependency checks while allowing independent speed edits", () => {
    const d = createDesign("conveyor");
    expect(Object.keys(readSetFor(d, { speed: 75 }))).toEqual(["speed"]);
    expect(Object.keys(readSetFor(d, { length: 600 }))).toContain(
      "sensorPosition",
    );
  });
  it("new primitive design is not tied to the six examples", () => {
    const d = createDesign("custom", "Cable guide", [
      {
        id: "ring",
        name: "Cable ring",
        shape: "tube",
        size: [45, 12, 45],
        holeDiameter: 25,
        position: [0, 6, 0],
        color: "#353841",
        material: "PETG",
        process: "print",
      },
    ]);
    const result = deriveDesign({ ...d, params: { scale: 1.5 } });
    expect(result.parts[0].holeDiameter).toBe(37.5);
    expect(result.parts[0].size).toEqual([67.5, 18, 67.5]);
  });
  it("rejects broken topology and invalid bore", () => {
    const p = {
      id: "ring",
      name: "Ring",
      shape: "tube" as const,
      size: [20, 10, 20] as [number, number, number],
      holeDiameter: 25,
      position: [0, 5, 0] as [number, number, number],
      color: "#353841",
      material: "PETG",
      process: "print" as const,
    };
    expect(() => validateParts([p])).toThrow();
    expect(() =>
      validateParts([{ ...p, holeDiameter: 10, parentId: "ring" }]),
    ).toThrow();
  });
  it("rotation, brightness and water schedules affect the visible model", () => {
    const h = createDesign("holder"),
      l = createDesign("lamp"),
      p = createDesign("planter");
    expect(
      deriveDesign({ ...h, params: { ...h.params, angle: 30 } }).parts.find(
        (p) => p.id === "jaw-fixed",
      )?.position,
    ).not.toEqual(
      deriveDesign(h).parts.find((p) => p.id === "jaw-fixed")?.position,
    );
    expect(
      deriveDesign({ ...l, params: { ...l.params, brightness: 0 } }).parts.find(
        (p) => p.id === "led",
      )?.color,
    ).not.toEqual(deriveDesign(l).parts.find((p) => p.id === "led")?.color);
    expect(
      deriveDesign({
        ...p,
        params: { ...p.params, waterMinutes: 10 },
      }).parts.find((p) => p.id === "water")?.motion?.speed,
    ).toBeCloseTo(1 / 6);
  });
});
