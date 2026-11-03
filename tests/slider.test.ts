import { it, expect } from "vitest";
import {
  createDesign,
  deriveDesign,
  validateParts,
  readSetFor,
} from "../src/shared/engine";
import { motionPose } from "../src/lib/motion";
import { Store } from "../server/store";
import type { Part } from "../src/shared/types";

it("versions new sliders and preserves saved legacy geometry through edits and forks", () => {
  const d = createDesign("slider");
  expect(d.mechanismVersion).toBe(2);
  const fresh = deriveDesign(d);
  expect(fresh.parts.find((p) => p.id === "belt")?.loopSpan).toBe(760);
  delete d.mechanismVersion;
  const old = deriveDesign(d);
  expect(old.parts).toHaveLength(8);
  expect(old.parts.find((p) => p.id === "rail-front")?.size).toEqual([
    620, 12, 12,
  ]);
  const store = new Store(":memory:");
  try {
    store.insert({ design: d, derived: old, history: [] });
    const next = store.apply(d.id, {
      id: crypto.randomUUID(),
      baseRevision: 0,
      actor: "Test",
      changes: { travel: 750 },
      readSet: readSetFor(d, { travel: 750 }),
    });
    expect(next.design.mechanismVersion).toBeUndefined();
    expect(next.derived.parts.find((p) => p.id === "rail-front")?.size).toEqual(
      [870, 12, 12],
    );
    expect(store.fork(d.id).snapshot.derived).toEqual(next.derived);
  } finally {
    store.close();
  }
});
it("retains guide, fastener and drive interfaces across valid parameter corners", () => {
  for (const travel of [150, 500, 725, 1000])
    for (const railSpacing of [60, 100, 180]) {
      const d = createDesign("slider");
      Object.assign(d.params, {
        travel,
        railSpacing,
        cameraWidth: Math.min(150, railSpacing - 10),
      });
      const q = deriveDesign(d);
      validateParts(q.parts);
      const by = (id: string) => q.parts.find((p) => p.id === id)!;
      const rail = by("rail-front");
      expect(rail.size[0]).toBeGreaterThanOrEqual(travel + 120);
      expect(rail.holes![0].x + rail.size[0] / 2).toBe(10);
      expect(rail.holes!.at(-1)!.x).toBe(rail.size[0] / 2 - 10);
      expect(rail.holes![1].x - rail.holes![0].x).toBe(25);
      expect(by("rail-rear").position[2] - rail.position[2]).toBe(railSpacing);
      expect(by("carriage").motion?.range).toBe(travel);
      expect(q.parts.length).toBeLessThanOrEqual(256);
      expect(
        q.bom.some(
          (b) =>
            b.id === "camera" ||
            b.id === "drive-shaft" ||
            b.id === "idler-bearing-lower",
        ),
      ).toBe(false);
      expect(q.bom.find((b) => b.id === "drive")?.sourceUrl).toBe(
        "https://www.pololu.com/product/2267",
      );
      expect(q.bom.find((b) => b.id === "idler")?.specification).toContain(
        "includes two 675ZZ",
      );
      expect(
        q.steps.every((s) =>
          s.partIds.every((id) => q.parts.some((p) => p.id === id)),
        ),
      ).toBe(true);
    }
});
it("keeps moving hardware together and reverses pulleys at 60 mm travel per revolution", () => {
  const d = createDesign("slider");
  d.params.speed = 30;
  const parts = deriveDesign(d).parts,
    carriage = parts.find((p) => p.id === "carriage")!;
  for (const t of [0, 1, 2, 8.333333333, 10, 16.666666667, 25]) {
    const x = motionPose(carriage, parts, t).position[0];
    expect(Math.abs(x)).toBeLessThanOrEqual(250.000001);
    for (const p of parts.filter((p) => p.parentId === "carriage")) {
      const pose = motionPose(p, parts, t);
      expect(pose.position[0] - p.position[0]).toBeCloseTo(x, 6);
      expect(pose.position[1]).toBeCloseTo(p.position[1]);
      expect(pose.position[2]).toBeCloseTo(p.position[2]);
    }
    for (const id of ["drive-shaft", "drive-pulley", "idler"])
      expect(
        motionPose(
          parts.find((p) => p.id === id)!,
          parts,
          t,
        ).rotation[1],
      ).toBeCloseTo((-x * 2 * Math.PI) / 60, 6);
  }
  expect(
    motionPose(
      parts.find((p) => p.id === "drive-pulley")!,
      parts,
      2,
    ).rotation[1],
  ).toBeCloseTo(-2 * Math.PI);
});
it("rejects invalid driven-motion relationships and keeps custom input bounded", () => {
  const source: Part = {
    id: "source",
    name: "Moving block",
    shape: "box",
    size: [20, 10, 10],
    position: [0, 0, 0],
    color: "#C8CDD1",
    material: "Steel",
    process: "machine",
    motion: { type: "slide", axis: "x", speed: 5, range: 100 },
  };
  const wheel: Part = {
    ...source,
    id: "wheel",
    name: "Wheel",
    shape: "cylinder",
    size: [20, 5, 20],
    motion: {
      type: "rotate",
      axis: "y",
      speed: 0,
      drivenBy: "source",
      travelPerTurn: 60,
    },
  };
  validateParts([source, wheel]);
  for (const m of [
    { ...wheel.motion!, drivenBy: "missing" },
    { ...wheel.motion!, drivenBy: "wheel" },
    { ...wheel.motion!, travelPerTurn: 0 },
    { ...wheel.motion!, travelPerTurn: Infinity },
  ])
    expect(() => validateParts([source, { ...wheel, motion: m }])).toThrow();
  expect(() =>
    createDesign(
      "custom",
      "Too many parts",
      Array.from({ length: 101 }, (_, i) => ({ ...source, id: `part-${i}` })),
    ),
  ).toThrow();
  const d = createDesign("custom", "Driven scaled assembly", [source, wheel]);
  d.params.scale = 2;
  expect(deriveDesign(d).parts[1].motion?.travelPerTurn).toBe(120);
});
