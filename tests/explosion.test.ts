import { describe, expect, it } from "vitest";
import { createDesign, deriveDesign } from "../src/shared/engine";
import { explodedParts, explosionProgress, EXPLOSION_DURATION } from "../src/lib/explosion";
import { motionPose } from "../src/lib/motion";
import type { Part } from "../src/shared/types";

describe("reversible assembly explosion", () => {
  it("eases to exact endpoints and reverses from the current position", () => {
    expect(explosionProgress(0, 1, 0)).toBe(0);
    expect(explosionProgress(0, 1, EXPLOSION_DURATION)).toBe(1);
    expect(explosionProgress(0, 1, EXPLOSION_DURATION / 2)).toBeCloseTo(.5);
    const current = explosionProgress(0, 1, .2);
    expect(explosionProgress(current, 0, 0)).toBe(current);
    expect(explosionProgress(current, 0, .1)).toBeLessThan(current);
    expect(explosionProgress(current, 0, EXPLOSION_DURATION)).toBe(0);
    expect(explosionProgress(.4, 1, 0, true)).toBe(1);
    expect(explosionProgress(.4, 0, 0, true)).toBe(0);
  });
  for (const kind of ["turntable", "slider", "conveyor", "lamp", "planter", "holder"] as const) it(`${kind} moves every level continuously without changing source geometry`, () => {
    const parts = deriveDesign(createDesign(kind)).parts, saved = structuredClone(parts);
    const full = explodedParts(parts, 1), halfway = explodedParts(parts, .5);
    expect(explodedParts(parts, 0)).toBe(parts);
    expect(halfway.map(p => p.id)).toEqual(parts.map(p => p.id));
    expect(full.some((p, i) => p.position.some((v, axis) => v !== parts[i].position[axis]))).toBe(true);
    for (let i = 0; i < parts.length; i++) {
      expect(halfway[i].size).toEqual(parts[i].size);
      expect(halfway[i].parentId).toBe(parts[i].parentId);
      for (let axis = 0; axis < 3; axis++) expect(halfway[i].position[axis]).toBeCloseTo((parts[i].position[axis] + full[i].position[axis]) / 2, 8);
    }
    expect(parts).toEqual(saved);
  });
  it("keeps nested moving subparts attached to the interpolated parent frame", () => {
    const root: Part = { id: "root", name: "Driven hub", shape: "cylinder", size: [30, 10, 30], position: [0, 30, 0],
      material: "steel", color: "#245BA8", process: "machine", motion: { type: "rotate", axis: "y", speed: 6 } };
    const child: Part = { ...root, id: "child", name: "Plate", position: [20, 40, 0], parentId: "root", motion: undefined };
    const subpart: Part = { ...child, id: "subpart", name: "Fastener", position: [25, 45, 0], parentId: "child" };
    const source = [root, child, subpart], midpoint = explodedParts(source, .5), full = explodedParts(source, 1);
    for (let i = 0; i < source.length; i++) {
      const restPose = motionPose(source[i], source, 2.5), fullPose = motionPose(full[i], full, 2.5), halfPose = motionPose(midpoint[i], midpoint, 2.5);
      for (let axis = 0; axis < 3; axis++) expect(halfPose.position[axis]).toBeCloseTo((restPose.position[axis] + fullPose.position[axis]) / 2, 8);
      expect(halfPose.rotation).toEqual(restPose.rotation);
    }
  });
});
