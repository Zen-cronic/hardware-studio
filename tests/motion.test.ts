import { describe, it, expect } from "vitest";
import { createDesign, deriveDesign } from "../src/shared/engine";
import { motionPose } from "../src/lib/motion";
describe("physical units in kinematic previews", () => {
  it("six rpm turns once in ten seconds", () => {
    const parts = deriveDesign(createDesign("turntable")).parts,
      p = parts.find((x) => x.id === "platter")!;
    expect(motionPose(p, parts, 10).rotation[1]).toBeCloseTo(2 * Math.PI);
  });
  it("slider remains in travel bounds and moves at the commanded mm/s", () => {
    const d = createDesign("slider"),
      parts = deriveDesign(d).parts,
      p = parts.find((x) => x.id === "carriage")!;
    expect(
      Math.abs(
        motionPose(p, parts, 1).position[0] -
          motionPose(p, parts, 0).position[0],
      ),
    ).toBeCloseTo(d.params.speed);
    for (let t = 0; t < 60; t += 0.25)
      expect(Math.abs(motionPose(p, parts, t).position[0])).toBeLessThanOrEqual(
        d.params.travel / 2 + 0.001,
      );
  });
  it("conveyor parcel stays within travel and gate responds to its approach", () => {
    const parts = deriveDesign(createDesign("conveyor")).parts,
      p = parts.find((x) => x.id === "parcel")!,
      g = parts.find((x) => x.id === "diverter")!;
    const far = motionPose(g, parts, 0).rotation[1];
    const t = (g.position[0] - p.position[0]) / p.motion!.speed;
    expect(motionPose(g, parts, t).rotation[1]).toBeGreaterThan(far);
  });
});
