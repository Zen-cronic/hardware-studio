import { describe, it, expect } from "vitest";
import {
  createDesign,
  deriveDesign,
  validateDesign,
  validateParts,
  readSetFor,
} from "../src/shared/engine";
import { productForDesign } from "../src/shared/catalog";
import { Store } from "../server/store";
import { motionPose } from "../src/lib/motion";
import type { Part } from "../src/shared/types";

describe("supported turntable", () => {
  it("fixes the spindle and rejects incompatible height without changing a saved revision", () => {
    const store = new Store(":memory:");
    try {
      const { snapshot } = store.create("turntable");
      expect(snapshot.design.mechanismVersion).toBe(2);
      for (const changes of [{ shaftDiameter: 12 }, { height: 55 }] as Record<
        string,
        number
      >[]) {
        expect(() =>
          store.apply(snapshot.design.id, {
            id: crypto.randomUUID(),
            baseRevision: 0,
            actor: "Test",
            changes,
            readSet: readSetFor(snapshot.design, changes),
          }),
        ).toThrow();
        expect(store.get(snapshot.design.id)).toEqual({
          ...snapshot,
          role: undefined,
        });
      }
    } finally {
      store.close();
    }
  });
  it("opens, edits and forks an unversioned design without silently replacing its mechanism", () => {
    const store = new Store(":memory:");
    try {
      const design = createDesign("turntable");
      delete design.mechanismVersion;
      design.params.height = 55;
      const derived = deriveDesign(design),
        saved = { design, derived, history: [] };
      store.insert(saved);
      expect(store.get(design.id)).toEqual(saved);
      expect(
        productForDesign(design).parameters.find((p) => p.key === "height")
          ?.min,
      ).toBe(35);
      const next = store.apply(design.id, {
        id: crypto.randomUUID(),
        baseRevision: 0,
        actor: "Test",
        changes: { shaftDiameter: 12 },
        readSet: readSetFor(design, { shaftDiameter: 12 }),
      });
      expect(next.design.mechanismVersion).toBeUndefined();
      expect(next.derived.parts.find((p) => p.id === "hub")?.holeDiameter).toBe(
        12.2,
      );
      expect(store.fork(design.id).snapshot.derived).toEqual(next.derived);
    } finally {
      store.close();
    }
  });
  it("keeps attached platter bolts on their bolt circle throughout rotation", () => {
    const parts = deriveDesign(createDesign("turntable")).parts;
    const bolt = parts.find((p) => p.id === "platter-screw-0")!;
    const original = bolt.position;
    const pose = motionPose(bolt, parts, 2.5); // 6 rpm, quarter revolution
    expect(pose.position[0]).toBeCloseTo(original[2]);
    expect(pose.position[2]).toBeCloseTo(-original[0]);
    expect(pose.position[1]).toBe(original[1]);
  });
  it("validates feature topology and scales it with custom geometry", () => {
    const part: Part = {
      id: "flange",
      name: "Flange",
      shape: "cylinder",
      size: [40, 20, 40],
      position: [0, 10, 0],
      sections: [
        { height: 10, diameter: 8, bore: 0 },
        { height: 10, diameter: 40, bore: 0 },
      ],
      holes: [{ x: 15, z: 0, diameter: 3.4 }],
      color: "#888888",
      material: "Steel",
      process: "machine",
    };
    validateParts([part]);
    for (const bad of [
      { sections: [{ height: 19, diameter: 40, bore: 0 }] },
      { holes: [{ x: 19, z: 0, diameter: 4 }] },
      {
        holes: [
          { x: 12, z: 0, diameter: 4 },
          { x: 12, z: 0, diameter: 4 },
        ],
      },
    ])
      expect(() => validateParts([{ ...part, ...bad }])).toThrow();
    const d = createDesign("custom", "Flange", [part]);
    d.params.scale = 2;
    const scaled = deriveDesign(d).parts[0];
    expect(scaled.sections?.[0]).toEqual({ height: 20, diameter: 16, bore: 0 });
    expect(scaled.holes?.[0]).toEqual({ x: 30, z: 0, diameter: 6.8 });
    const unknown = createDesign("turntable");
    (unknown as any).mechanismVersion = 3;
    expect(() => validateDesign(unknown)).toThrow(/version/);
  });
});
