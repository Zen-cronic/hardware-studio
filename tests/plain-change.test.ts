import { describe, expect, it } from "vitest";
import { createDesign, deriveDesign } from "../src/shared/engine";
import type { Part, Snapshot } from "../src/shared/types";
import { plainEditSummary } from "../src/shared/plain-change";

const link: Part = { id: "link", name: "Upper arm link", shape: "box", size: [110, 4, 24], position: [0, 2, 0],
  holes: [{ x: -45, z: 0, diameter: 6.4 }], material: "Aluminium 6061", process: "machine", color: "#A2C7FF" };
const post: Part = { id: "post", name: "Post", shape: "cylinder", size: [20, 80, 20], position: [0, 40, 0],
  material: "PETG", process: "print", color: "#A2C7FF" };
const snap = (): Snapshot => {
  const design = createDesign("custom", undefined, [link, post]);
  return { design, derived: deriveDesign(design), history: [], role: "editor" };
};

describe("plain words for a measured change", () => {
  it("names the part, the old and new size and an everyday dimension word", () => {
    expect(plainEditSummary(snap(), "link", { type: "dimension", axis: "y", value: 6 }, 1, "")).toBe("Upper arm link: 4 → 6 mm thick. Nothing else changes.");
    expect(plainEditSummary(snap(), "link", { type: "dimension", axis: "x", value: 120 }, 1, "")).toBe("Upper arm link: 110 → 120 mm long. Nothing else changes.");
    expect(plainEditSummary(snap(), "link", { type: "dimension", axis: "z", value: 30 }, 3, "")).toBe("Upper arm link: 24 → 30 mm wide. 2 connected parts update to match.");
    expect(plainEditSummary(snap(), "post", { type: "dimension", axis: "x", value: 25 }, 2, "")).toBe("Post: 20 → 25 mm across. 1 connected part updates to match.");
  });
  it("says which hole changes, without axis letters or regeneration wording", () => {
    const text = plainEditSummary(snap(), "link", { type: "hole", holeIndex: 0, diameter: 8 }, 1, "");
    expect(text).toBe("Upper arm link: hole 1, 6.4 → 8 mm across. Nothing else changes.");
    expect(text).not.toMatch(/local|dimension|regeneration|geometry/);
  });
  it("keeps a control-named change as written", () => {
    expect(plainEditSummary(snap(), "link", { type: "parameter", key: "scale", value: 2 }, 2, "Overall scale: 1 → 2"))
      .toBe("Overall scale: 1 → 2. 1 connected part updates to match.");
  });
});
