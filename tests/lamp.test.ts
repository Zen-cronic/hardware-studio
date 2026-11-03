import { it, expect } from "vitest";
import { Euler, Vector3 } from "three";
import {
  createDesign,
  deriveDesign,
  readSetFor,
  validateDesign,
} from "../src/shared/engine";
import { Store } from "../server/store";
it("creates retained lamps while preserving legacy saved edits and forks", () => {
  const d = createDesign("lamp");
  expect(d.mechanismVersion).toBe(2);
  expect(deriveDesign(d).parts).toHaveLength(36);
  delete d.mechanismVersion;
  const old = deriveDesign(d);
  expect(old.parts).toHaveLength(7);
  expect(old.parts.find((p) => p.id === "shade")?.shape).toBe("cylinder");
  const store = new Store(":memory:");
  try {
    store.insert({ design: d, derived: old, history: [] });
    const next = store.apply(d.id, {
      id: crypto.randomUUID(),
      baseRevision: 0,
      actor: "Test",
      changes: { reach: 350 },
      readSet: readSetFor(d, { reach: 350 }),
    });
    expect(next.design.mechanismVersion).toBeUndefined();
    expect(next.derived.parts).toHaveLength(7);
    expect(store.fork(d.id).snapshot.derived).toEqual(next.derived);
  } finally {
    store.close();
  }
});
it("keeps joint centres and local drilling axes aligned across reach and pose changes", () => {
  for (const reach of [150, 300, 421.5, 550])
    for (const angle of [15, 30, 45, 60, 80]) {
      const d = createDesign("lamp");
      Object.assign(d.params, { reach, angle, baseDiameter: 250 });
      const q = deriveDesign(d),
        by = (id: string) => q.parts.find((p) => p.id === id)!;
      for (const [id, targets] of [
        ["lower-arm", ["base-joint-screw", "elbow-joint-screw"]],
        ["upper-arm", ["elbow-joint-screw", "head-joint-screw"]],
      ] as const) {
        const p = by(id);
        const axis = new Vector3(0, 1, 0).applyEuler(new Euler(...p.rotation!));
        expect(axis.distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-9);
        for (const [i, h] of p.holes!.entries()) {
          const centre = new Vector3(h.x, 0, h.z)
            .applyEuler(new Euler(...p.rotation!))
            .add(new Vector3(...p.position));
          const bolt = by(targets[i]);
          expect(centre.x).toBeCloseTo(bolt.position[0], 8);
          expect(centre.y).toBeCloseTo(bolt.position[1], 8);
        }
      }
      expect(by("shade").holeDiameter).toBe(64);
      expect(by("thermal-pad").size[1]).toBe(0.25);
      expect(
        q.steps.every((s) =>
          s.partIds.every((id) => q.parts.some((p) => p.id === id)),
        ),
      ).toBe(true);
    }
});
it("changes white-light appearance without changing bought module dimensions and keeps custom thickness limits", () => {
  const d = createDesign("lamp"),
    before = deriveDesign(d);
  d.params.brightness = 0;
  const after = deriveDesign(d);
  expect(after.parts.find((p) => p.id === "led")?.color).not.toBe(
    before.parts.find((p) => p.id === "led")?.color,
  );
  expect(after.bom).toEqual(before.bom);
  const custom = createDesign("custom");
  custom.customParts = [before.parts.find((p) => p.id === "thermal-pad")!];
  expect(() => validateDesign(custom)).toThrow("0.5");
  expect(before.bom.find((p) => p.id === "led")?.sourceUrl).toBe(
    "https://www.adafruit.com/product/2855",
  );
});
