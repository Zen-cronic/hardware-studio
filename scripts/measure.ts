import { writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import {
  createDesign,
  deriveDesign,
  validateDesign,
} from "../src/shared/engine";
import type { ProductKind, DerivedDesign } from "../src/shared/types";
type Case = {
  kind: ProductKind;
  change: Record<string, number>;
  check: (d: DerivedDesign) => boolean;
  reason: string;
};
const part = (d: DerivedDesign, id: string) =>
  d.parts.find((p) => p.id === id)!;
const metric = (d: DerivedDesign, label: string) =>
  d.metrics.find((m) => m.label === label)?.value;
const cases: Case[] = [
  {
    kind: "turntable",
    change: { diameter: 280 },
    check: (d) => part(d, "platter").size[0] === 280,
    reason: "Platter follows requested diameter",
  },
  {
    kind: "turntable",
    change: { shaftDiameter: 12 },
    check: (d) => Math.abs(part(d, "hub").holeDiameter! - 12.2) < 0.001,
    reason: "Hub clearance follows new shaft",
  },
  {
    kind: "slider",
    change: { travel: 750 },
    check: (d) =>
      part(d, "rail-front").size[0] >= 750 &&
      part(d, "carriage").motion!.range === 750,
    reason: "Rails and motion accommodate travel",
  },
  {
    kind: "slider",
    change: { railSpacing: 130 },
    check: (d) =>
      Math.abs(
        part(d, "rail-front").position[2] - part(d, "rail-rear").position[2],
      ) === 130,
    reason: "Both rail datums change together",
  },
  {
    kind: "conveyor",
    change: { length: 650 },
    check: (d) =>
      part(d, "frame-front").size[0] === 650 && part(d, "belt").size[0] < 650,
    reason: "Frame and belt remain related",
  },
  {
    kind: "conveyor",
    change: { sensorPosition: 300 },
    check: (d) =>
      part(d, "sensor").position[0] === 50 &&
      d.connections.some((c) => c.from === "sensor"),
    reason: "Sensor position changes the control connection",
  },
  {
    kind: "lamp",
    change: { reach: 350 },
    check: (d) =>
      part(d, "lower-arm").size[1] === 175 &&
      part(d, "upper-arm").size[1] === 175,
    reason: "Both lamp links follow reach",
  },
  {
    kind: "lamp",
    change: { brightness: 40 },
    check: (d) => metric(d, "Light setting") === 40,
    reason: "Light control follows accepted value",
  },
  {
    kind: "planter",
    change: { pots: 4 },
    check: (d) =>
      d.parts.filter((p) => p.id.startsWith("pot-")).length === 4 &&
      d.connections.length === 4,
    reason: "Each pot receives an outlet",
  },
  {
    kind: "planter",
    change: { potDiameter: 110 },
    check: (d) =>
      part(d, "pot-0").size[0] === 110 &&
      part(d, "pot-1").position[0] !== part(d, "pot-0").position[0],
    reason: "Pot size preserves separated placement",
  },
  {
    kind: "holder",
    change: { opening: 120 },
    check: (d) =>
      part(d, "jaw-moving").position[0] -
        part(d, "jaw-fixed").position[0] -
        18 ===
      120,
    reason: "Opening matches clear jaw distance",
  },
  {
    kind: "holder",
    change: { screwDiameter: 12 },
    check: (d) =>
      part(d, "screw").size[0] === 12 && part(d, "nut").holeDiameter! > 12,
    reason: "Screw and nut dimensions follow together",
  },
];
const results = cases.map((c) => {
  const d = createDesign(c.kind);
  Object.assign(d.params, c.change);
  const derived = deriveDesign(d);
  assert(c.check(derived), c.reason);
  return { kind: c.kind, changes: c.change, check: c.reason, passed: true };
});
const invalid: [ProductKind, Record<string, number>][] = [
  ["turntable", { diameter: 0 }],
  ["slider", { cameraWidth: 150, railSpacing: 60 }],
  ["conveyor", { length: 250, sensorPosition: 300 }],
  ["lamp", { reach: 550, baseDiameter: 100 }],
  ["planter", { pots: 2.5 }],
  ["holder", { jawWidth: 50, opening: 250 }],
];
for (const [kind, change] of invalid) {
  const d = createDesign(kind);
  Object.assign(d.params, change);
  assert.throws(() => validateDesign(d), kind + " rejects invalid design");
}
const custom = createDesign("custom", "Phone stand", [
  {
    id: "foot",
    name: "Foot",
    shape: "box",
    size: [90, 8, 100],
    position: [0, 4, 0],
    color: "#353841",
    material: "PETG",
    process: "print",
  },
  {
    id: "back",
    name: "Back",
    shape: "box",
    size: [90, 120, 8],
    position: [0, 65, -40],
    rotation: [-0.2, 0, 0],
    color: "#353841",
    material: "PETG",
    process: "print",
  },
]);
assert.equal(deriveDesign(custom).parts.length, 2);
const baseline = deriveDesign(createDesign("turntable"));
assert.equal(part(baseline, "hub").holeDiameter, 8.2);
const disconnected = structuredClone(baseline);
part(disconnected, "hub").holeDiameter = 8.2;
assert(
  !cases[1].check(disconnected),
  "Negative control must detect disconnected hub after requested 12 mm shaft",
);
const report = {
  generatedAt: new Date().toISOString(),
  validCases: results.length,
  invalidCasesRejected: invalid.length,
  customAssemblies: 1,
  negativeControlDetected: true,
  results,
  scope:
    "Deterministic fixture coverage, not real-world manufacturing or user-outcome proof.",
};
mkdirSync(".artifacts", { recursive: true });
writeFileSync(
  ".artifacts/measurement.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  `${results.length}/${results.length} propagation checks; ${invalid.length}/${invalid.length} invalid designs rejected; custom assembly and negative control passed.`,
);
