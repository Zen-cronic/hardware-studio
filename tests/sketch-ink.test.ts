import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { contrastOnPaper, inkFor, readableInk, SKETCH_INK, SKETCH_PALETTE } from "../src/lib/sketch-ink";

describe("sketch ink on white paper", () => {
  it("draws every collaborator, and the reference sketch, in dark ink", () => {
    expect(contrastOnPaper(SKETCH_INK)).toBeGreaterThanOrEqual(4.5);
    for (const color of SKETCH_PALETTE) expect(contrastOnPaper(color)).toBeGreaterThanOrEqual(4.5);
    for (const name of ["Alex", "Sam", "Maker 1a2b", "Maker ffff", "Maker 0000", ""]) expect(contrastOnPaper(inkFor(name))).toBeGreaterThanOrEqual(4.5);
  });

  it("draws strokes saved in a light colour in the default ink", () => {
    expect(readableInk("#FFFFFF")).toBe(SKETCH_INK);
    expect(readableInk("#EEF4FF")).toBe(SKETCH_INK);
    expect(readableInk("#78D6A6")).toBe(SKETCH_INK);
    expect(readableInk("#245BA8")).toBe("#245BA8");
  });

  it("keeps theme text colours off the sketch canvases", () => {
    for (const file of ["src/components/ReferenceInput.tsx", "src/components/SharedNotes.tsx"])
      expect(readFileSync(file, "utf8")).not.toMatch(/colors\.(text|focus|success|action)/);
  });
});
