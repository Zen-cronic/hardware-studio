import { it, expect } from "vitest";
import {
  createDesign,
  deriveDesign,
  validateParts,
} from "../src/shared/engine";
import { featuredGeometry } from "../src/lib/partGeometry";
import type { Part } from "../src/shared/types";
const block: Part = {
  id: "guide",
  name: "Guide block envelope",
  shape: "box",
  size: [45.4, 10, 27],
  position: [0, 8, 0],
  channel: { width: 12.2, depth: 5.2 },
  holes: [-10, 10].flatMap((x) =>
    [-10, 10].map((z) => ({ x, z, diameter: 3 })),
  ),
  color: "#C8CDD1",
  material: "Steel",
  process: "buy",
};
const rail: Part = {
  id: "rail",
  name: "Rail envelope",
  shape: "box",
  size: [1120, 8, 12],
  position: [0, 4, 0],
  holes: Array.from({ length: 45 }, (_, i) => ({
    x: -550 + i * 25,
    z: 0,
    diameter: 3.5,
    counterbore: { diameter: 6, depth: 4.5 },
  })),
  color: "#C8CDD1",
  material: "Steel",
  process: "buy",
};
function volume(part: Part) {
  const geometry = featuredGeometry(part);
  const pos = geometry.getAttribute("position");
  let n = 0;
  for (let i = 0; i < pos.count; i += 3) {
    const a = [pos.getX(i), pos.getY(i), pos.getZ(i)],
      b = [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)],
      c = [pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)];
    n +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  geometry.dispose();
  return Math.abs(n);
}
it("renders guide relief and recessed rail fasteners at matching nominal volumes", () => {
  validateParts([block, rail]);
  const b = 45.4 * 10 * 27 - 45.4 * 12.2 * 5.2 - 4 * Math.PI * 1.5 ** 2 * 10;
  const r =
    1120 * 8 * 12 - 45 * Math.PI * (1.75 ** 2 * 8 + (3 ** 2 - 1.75 ** 2) * 4.5);
  expect(volume(block) / b).toBeCloseTo(1, 3);
  expect(volume(rail) / r).toBeCloseTo(1, 3);
  const d = createDesign("custom", "Guide", [block, rail]);
  d.params.scale = 1.5;
  const derived = deriveDesign(d);
  expect(derived.parts[0].channel?.width).toBeCloseTo(18.3);
  expect(derived.parts[0].channel?.depth).toBeCloseTo(7.8);
  expect(derived.parts[1].holes![0].counterbore).toEqual({
    diameter: 9,
    depth: 6.75,
  });
  expect(volume(derived.parts[0]) / volume(block)).toBeCloseTo(1.5 ** 3, 4);
  expect(derived.bom[0].specification).toContain("underside channel");
  expect(derived.bom[1].specification).toContain("counterbore Ø9 × 6.75");
});
it("rejects disconnected channels, broken counterbores, overlapping recesses and holes into a channel", () => {
  const bad: Part[] = [
    { ...block, channel: { width: 27, depth: 5 } },
    { ...block, channel: { width: 12, depth: 10 } },
    { ...block, holes: [{ x: 0, z: 7, diameter: 3 }] },
    {
      ...rail,
      holes: [
        { x: 0, z: 0, diameter: 3.5, counterbore: { diameter: 13, depth: 4 } },
      ],
    },
    {
      ...rail,
      holes: [
        { x: 0, z: 0, diameter: 3.5, counterbore: { diameter: 6, depth: 8 } },
      ],
    },
    {
      ...rail,
      holes: [
        { x: 0, z: 0, diameter: 3.5, counterbore: { diameter: 3, depth: 4 } },
      ],
    },
    {
      ...rail,
      holes: [0, 5].map((x) => ({
        x,
        z: 0,
        diameter: 3,
        counterbore: { diameter: 6, depth: 4 },
      })),
    },
    { ...block, channel: null as any },
    { ...rail, holes: [{ x: 0, z: 0, diameter: 3, counterbore: null as any }] },
  ];
  for (const p of bad) expect(() => validateParts([p])).toThrow();
});
it("combines deep counterbores with a channel without losing the roof or scaling", () => {
  const p: Part = {
    ...block,
    holes: block.holes!.map((h) => ({
      ...h,
      counterbore: { diameter: 4, depth: 8 },
    })),
  };
  validateParts([p]);
  const expected =
    45.4 * 10 * 27 -
    45.4 * 12.2 * 5.2 -
    4 * Math.PI * (1.5 ** 2 * 10 + (2 ** 2 - 1.5 ** 2) * 8);
  expect(volume(p) / expected).toBeCloseTo(1, 3);
});

it("renders one closed boundary without duplicate interior caps", () => {
  const geometry = featuredGeometry({
    ...block,
    holes: block.holes!.map((h) => ({
      ...h,
      counterbore: { diameter: 4, depth: 8 },
    })),
  });
  const positions = geometry.getAttribute("position");
  const counts = new Map<string, number>();
  const point = (i: number) =>
    [positions.getX(i), positions.getY(i), positions.getZ(i)]
      .map((n) => Math.round(n * 10000))
      .join(",");
  for (let i = 0; i < positions.count; i += 3)
    for (const [a, b] of [
      [i, i + 1],
      [i + 1, i + 2],
      [i + 2, i],
    ]) {
      const key = [point(a), point(b)].sort().join("|");
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  expect([...counts.values()].every((n) => n === 2)).toBe(true);
  geometry.dispose();
});
