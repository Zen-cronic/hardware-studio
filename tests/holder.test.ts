import { it, expect } from "vitest";
import {
  createDesign,
  deriveDesign,
  validateDesign,
  readSetFor,
  validateParts,
} from "../src/shared/engine";
import { productForDesign } from "../src/shared/catalog";
import { motionPose } from "../src/lib/motion";
import { holderPitch } from "../src/shared/holder";
import { Store } from "../server/store";
import { Vector3, Quaternion, Euler } from "three";
it("versions retained holders while preserving legacy edits, forks and odd screw sizes", () => {
  const d = createDesign("holder");
  expect(d.mechanismVersion).toBe(2);
  d.params.screwDiameter = 9;
  expect(() => validateDesign(d)).toThrow("standard coarse");
  delete d.mechanismVersion;
  validateDesign(d);
  expect(
    productForDesign(d).parameters.find((p) => p.key === "screwDiameter")?.step,
  ).toBe(1);
  const derived = deriveDesign(d);
  expect(derived.parts).toHaveLength(8);
  const s = new Store(":memory:");
  try {
    s.insert({ design: d, derived, history: [] });
    const next = s.apply(d.id, {
      id: crypto.randomUUID(),
      baseRevision: 0,
      actor: "Test",
      changes: { opening: 100 },
      readSet: readSetFor(d, { opening: 100 }),
    });
    expect(next.design.mechanismVersion).toBeUndefined();
    expect(s.fork(d.id).snapshot.derived).toEqual(next.derived);
  } finally {
    s.close();
  }
});
it("uses selected bushings, proper thread pitch and retained mechanical features at valid parameter extremes", () => {
  for (const jawWidth of [50, 91.5, 160])
    for (const opening of [10, Math.min(250, jawWidth * 2.5)])
      for (const screwDiameter of [6, 8, 10, 12, 14, 16].filter(
        (v) => v <= jawWidth / 4,
      )) {
        const d = createDesign("holder");
        Object.assign(d.params, {
          jawWidth,
          opening,
          screwDiameter,
          angle: 40,
        });
        const q = deriveDesign(d);
        expect(q.metrics.find((m) => m.label === "Screw pitch")?.value).toBe(
          holderPitch[screwDiameter],
        );
        expect(q.parts.filter((p) => p.id.startsWith("bushing-"))).toHaveLength(
          4,
        );
        expect(q.bom.find((p) => p.id === "screw")?.process).toBe("machine");
        expect(
          q.bom.find((p) => p.id.startsWith("bushing-"))?.sourceUrl,
        ).toContain("GFM-0810-10");
        expect(q.parts.find((p) => p.id === "base")?.holes).toHaveLength(4);
        expect(
          q.parts
            .find((p) => p.id === "screw")
            ?.sections?.reduce((n, s) => n + s.height, 0),
        ).toBe(121);
      }
});
it("keeps the tilted jaw and retained spindle on the guide axis and turns by pitch", () => {
  for (const angle of [-40, 0, 40]) {
    const d = createDesign("holder");
    d.params.angle = angle;
    const parts = deriveDesign(d).parts,
      by = (id: string) => parts.find((p) => p.id === id)!;
    const jaw = by("jaw-moving"),
      screw = by("screw"),
      r = (angle * Math.PI) / 180,
      axis = new Vector3(Math.cos(r), Math.sin(r), 0);
    for (const t of [0, 0.25, 1, 5, 10, 15, 20]) {
      const j = motionPose(jaw, parts, t),
        s = motionPose(screw, parts, t),
        delta = new Vector3(...j.position).sub(new Vector3(...jaw.position)),
        travel = delta.dot(axis);
      expect(delta.clone().cross(axis).length()).toBeLessThan(1e-8);
      expect(travel).toBeLessThanOrEqual(0);
      expect(travel).toBeGreaterThanOrEqual(-40 - 1e-8);
      expect(
        new Vector3(...s.position)
          .sub(new Vector3(...screw.position))
          .distanceTo(delta),
      ).toBeLessThan(1e-8);
      // The threaded portion covers the whole fixed support at both travel extremes.
      const threadedStart = new Vector3(...s.position)
        .addScaledVector(axis, -121 / 2 + 22)
        .dot(axis);
      const threadedEnd = new Vector3(...s.position)
        .addScaledVector(axis, 121 / 2)
        .dot(axis);
      const support = new Vector3(...by("nut").position).dot(axis);
      expect(threadedStart).toBeLessThan(support - 10);
      expect(threadedEnd).toBeGreaterThan(support + 10);
      const original = new Quaternion().setFromEuler(
          new Euler(...screw.rotation!),
        ),
        actual = new Quaternion().setFromEuler(new Euler(...s.rotation));
      const predicted = new Quaternion()
        .setFromAxisAngle(
          axis,
          (travel * 2 * Math.PI) / holderPitch[d.params.screwDiameter],
        )
        .multiply(original);
      expect(Math.abs(actual.dot(predicted))).toBeCloseTo(1);
      for (const id of ["bushing-0--1", "pad-moving", "thrust-front"])
        expect(
          new Vector3(...motionPose(by(id), parts, t).position)
            .sub(new Vector3(...by(id).position))
            .distanceTo(delta),
        ).toBeLessThan(1e-8);
    }
    const bad = structuredClone(parts);
    bad.find((p) => p.id === "jaw-moving")!.motion!.direction = [2, 0, 0];
    expect(() => validateParts(bad)).toThrow("unit vector");
  }
});
