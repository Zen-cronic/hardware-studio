import { it, expect } from "vitest";
import {
  createDesign,
  deriveDesign,
  validateParts,
} from "../src/shared/engine";
import { featuredGeometry } from "../src/lib/partGeometry";
import type { Part } from "../src/shared/types";

const belt: Part = {
  id: "belt",
  name: "Continuous belt clearance envelope",
  shape: "tube",
  size: [701.59, 6, 21.59],
  loopSpan: 680,
  holeDiameter: 18.59,
  position: [0, 55.5, 0],
  color: "#353841",
  material: "Rubber",
  process: "buy",
};
function inspect(part: Part) {
  const geometry = featuredGeometry(part);
  const pos = geometry.getAttribute("position");
  let volume = 0;
  const edges = new Map<string, number>();
  const point = (i: number) => [pos.getX(i), pos.getY(i), pos.getZ(i)];
  const key = (i: number) =>
    point(i)
      .map((n) => Math.round(n * 10000))
      .join(",");
  for (let i = 0; i < pos.count; i += 3) {
    const [a, b, c] = [point(i), point(i + 1), point(i + 2)];
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    for (const [u, v] of [
      [i, i + 1],
      [i + 1, i + 2],
      [i + 2, i],
    ]) {
      const edge = [key(u), key(v)].sort().join("|");
      edges.set(edge, (edges.get(edge) || 0) + 1);
    }
  }
  geometry.computeBoundingBox();
  const b = geometry.boundingBox!;
  const size = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
  geometry.dispose();
  return { volume, size, closed: [...edges.values()].every((n) => n === 2) };
}
it("renders a closed, outward-facing continuous loop with independent bounds and volume", () => {
  for (const span of [0.5, 100, 680, 2000]) {
    const p = {
      ...belt,
      loopSpan: span,
      size: [span + 21.59, 6, 21.59] as Part["size"],
    };
    validateParts([p]);
    const mesh = inspect(p);
    const area = span * 3 + (Math.PI * (21.59 ** 2 - 18.59 ** 2)) / 4;
    expect(mesh.volume / (area * 6)).toBeCloseTo(1, 3);
    expect(mesh.closed).toBe(true);
    mesh.size.forEach((n, i) => expect(n).toBeCloseTo(p.size[i], 3));
  }
});
it("scales, saves and describes every loop dimension consistently without changing ordinary tubes", () => {
  const d = createDesign("custom", "Belt drive study", [belt]);
  d.params.scale = 1.5;
  const derived = deriveDesign(JSON.parse(JSON.stringify(d)));
  const p = derived.parts[0];
  expect(p.loopSpan).toBe(1020);
  expect(p.holeDiameter).toBeCloseTo(27.885);
  expect(inspect(p).volume / inspect(belt).volume).toBeCloseTo(1.5 ** 3, 3);
  expect(derived.bom[0].specification).toContain("loop centres 1020 mm");
  expect(derived.bom[0].specification).toContain("teeth omitted");
  const ordinary = { ...belt, size: [21.59, 6, 21.59] as Part["size"] };
  delete ordinary.loopSpan;
  validateParts([ordinary]);
  expect(
    inspect(ordinary).volume / ((Math.PI * (21.59 ** 2 - 18.59 ** 2) * 6) / 4),
  ).toBeCloseTo((80 * Math.sin((2 * Math.PI) / 80)) / (2 * Math.PI), 5);
});
it("rejects mismatched spans, broken walls, non-finite inputs and unimplemented mixed features", () => {
  const bad = [
    { loopSpan: 0 },
    { loopSpan: null },
    { loopSpan: NaN },
    { loopSpan: Infinity },
    { loopSpan: 679 },
    { shape: "box" },
    { shape: "cylinder" },
    { holeDiameter: 21.59 },
    { holeDiameter: 21.1 },
    { holeDiameter: 0 },
    { sections: [] },
    { holes: [] },
    { channel: { width: 2, depth: 2 } },
  ];
  for (const change of bad)
    expect(() => validateParts([{ ...belt, ...change } as Part])).toThrow();
});
