import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createDesign, deriveDesign } from "../src/shared/engine";
import { canonicalClipSource, evaluateClipFrame, makeClipProject } from "../src/lib/clip-timeline";
import type { ProductKind, Snapshot } from "../src/shared/types";
const snapshot = (kind: ProductKind): Snapshot => {
  const design = createDesign(kind, "My product", kind === "custom" ? [{ id: "plate", name: "Plate", shape: "box", size: [80, 8, 60], position: [0, 4, 0], material: "Aluminium", process: "machine", color: "#90bcea", holes: [{ x: 20, z: 0, diameter: 6 }] }] : undefined);
  return { design, derived: deriveDesign(design), history: [], role: "editor" };
};
describe("deterministic product film", () => {
  for (const kind of ["turntable", "slider", "conveyor", "lamp", "planter", "holder", "custom"] as const) it(`evaluates all 600 ${kind} frames without changing source geometry`, () => {
    const source = snapshot(kind), before = structuredClone(source), project = makeClipProject(source, "hash");
    const first = Array.from({ length: 600 }, (_, frame) => evaluateClipFrame(project, frame));
    expect(project.format).toEqual({ durationSeconds: 20, fps: 30, width: 1920, height: 1080 });
    expect(first).toEqual(Array.from({ length: 600 }, (_, frame) => evaluateClipFrame(project, frame)));
    expect(new Set(first.map(frame => frame.shot))).toEqual(new Set([0, 1, 2, 3]));
    expect(first[0].explosion).toBe(0); expect(first[225].explosion).toBe(1); expect(first[300].explosion).toBe(0);
    expect(first[300].mechanismSeconds).toBe(0); expect(first[599].mechanismSeconds).toBeGreaterThan(9.9);
    expect(first[599].seconds).toBe(599 / 30); expect(first[599].captionOpacity).toBe(1);
    for (const state of first) {
      expect([...state.camera.position, ...state.camera.target, state.explosion, state.mechanismSeconds].every(Number.isFinite)).toBe(true);
      expect(state.camera.viewportHeight).toBe(.74);
      expect(state.captionOpacity).toBeGreaterThanOrEqual(0); expect(state.captionOpacity).toBeLessThanOrEqual(1);
    }
    expect(source).toEqual(before);
    expect(() => evaluateClipFrame(project, -1)).toThrow(); expect(() => evaluateClipFrame(project, 600)).toThrow(); expect(() => evaluateClipFrame(project, .5)).toThrow();
  });
  it("freezes the exact revision, excludes capabilities/history and hashes stable object order", () => {
    const source = snapshot("turntable"), original = canonicalClipSource(source), project = makeClipProject(source, createHash("sha256").update(original).digest("hex"));
    source.design.name = "Edited later"; source.derived.parts[0].size[0] += 20;
    expect(project.snapshot.design.name).toBe("My product"); expect(canonicalClipSource(project.snapshot)).toBe(original);
    expect(project.snapshot.role).toBeUndefined(); expect(project.snapshot.history).toEqual([]);
    const reordered = JSON.parse(JSON.stringify(project.snapshot)); reordered.design = Object.fromEntries(Object.entries(reordered.design).reverse());
    expect(canonicalClipSource(reordered)).toBe(original);
  });
  it("preserves the framing and final fade of an existing saved timeline", () => {
    const old = makeClipProject(snapshot("turntable"), "hash"); delete old.renderSettings;
    expect(evaluateClipFrame(old, 225).camera.viewportHeight).toBe(1);
    expect(evaluateClipFrame(old, 599).captionOpacity).toBeCloseTo(.018176);
  });
  it("uses continuous explosion and camera transforms across shot boundaries", () => {
    const project = makeClipProject(snapshot("lamp"), "hash");
    for (const frame of [150, 300, 450]) {
      const before = evaluateClipFrame(project, frame - 1), after = evaluateClipFrame(project, frame);
      expect(Math.abs(after.explosion - before.explosion)).toBeLessThan(.01);
      const distance = Math.hypot(...after.camera.position.map((n, i) => n - before.camera.position[i]));
      expect(distance).toBeLessThan(project.framing.explodedRadius * .1);
    }
    expect(() => makeClipProject(snapshot("lamp"), "hash", { width: 1921, height: 1080, fps: 30, durationSeconds: 20 })).toThrow();
  });
});
