import type { Part, Snapshot, Vec3 } from "./types";

// The stated load for a quick before/after check of one part. Every value here is a declared
// input shown with the result, not a rating or certification of the part.

export interface CheckMaterial { name: string; youngModulusMPa: number; poissonRatio: number; densityKgM3: number; yieldStrengthMPa: number }
export interface CheckPreset {
  partId: string;
  /** Plain words for the load, quoted with the result. */
  load: string;
  forceN: number;
  study: {
    type: "strength"; partId: string; material: CheckMaterial;
    supports: { axis: "x"; side: "min" }[];
    loads: { axis: "x"; side: "max"; forceN: Vec3 }[];
    mesh: { maxSizeMm: number; refinements: number };
  };
}

export const GRAVITY = 9.80665;
const MATERIALS: [RegExp, CheckMaterial][] = [
  // Whole material names: "Polycarbonate" and "Carbon steel" are not carbon fibre.
  [/\bcarbon fib(re|er)\b/i, { name: "Carbon fibre plate, typical quasi-isotropic values", youngModulusMPa: 50000, poissonRatio: 0.3, densityKgM3: 1550, yieldStrengthMPa: 400 }],
  [/alumin/i, { name: "Aluminum 6061-T6, typical elastic properties", youngModulusMPa: 70000, poissonRatio: 0.33, densityKgM3: 2700, yieldStrengthMPa: 240 }],
  [/steel/i, { name: "Steel, typical elastic properties", youngModulusMPa: 200000, poissonRatio: 0.29, densityKgM3: 7850, yieldStrengthMPa: 250 }],
  [/petg/i, { name: "PETG print, typical values", youngModulusMPa: 2000, poissonRatio: 0.38, densityKgM3: 1270, yieldStrengthMPa: 45 }],
  [/\bpa12\b|\bnylon\b/i, { name: "PA12 nylon print, typical values", youngModulusMPa: 1700, poissonRatio: 0.4, densityKgM3: 1010, yieldStrengthMPa: 48 }],
  [/polycarbonate/i, { name: "Polycarbonate, typical values", youngModulusMPa: 2300, poissonRatio: 0.37, densityKgM3: 1200, yieldStrengthMPa: 62 }],
  [/tpu/i, { name: "TPU 95A print, typical values", youngModulusMPa: 26, poissonRatio: 0.45, densityKgM3: 1210, yieldStrengthMPa: 8 }],
  [/./, { name: "PLA print, typical values", youngModulusMPa: 3500, poissonRatio: 0.36, densityKgM3: 1240, yieldStrengthMPa: 50 }],
];
const material = (part: Part) => structuredClone(MATERIALS.find(([match]) => match.test(part.material))![1]);
const mesh = { maxSizeMm: 4, refinements: 2 };

/**
 * A matched strength check for a long box part, fixed at its local −X end and loaded at the +X end.
 * A drone arm carries one motor's declared peak thrust upward; the camera arm links carry the
 * declared 0.5 kg payload; any other long box part carries a declared 1 kg test load.
 */
export function checkPreset(snapshot: Snapshot, partId: string): CheckPreset | null {
  const part = snapshot.derived.parts.find(p => p.id === partId);
  // Plain beams only: a rounded or hollow shell is not a cantilevered bar.
  if (!part || part.shape !== "box" || part.edgeRadius !== undefined || part.role === "reference" || part.process === "buy") return null;
  if (part.size[0] < Math.max(part.size[1], part.size[2])) return null;
  const ids = new Set(snapshot.derived.parts.map(p => p.id));
  const droneArm = /^arm-/.test(part.id) && [...ids].some(id => /^motor-(front|rear)/.test(id));
  const cameraArm = /^(upper|lower)-arm$/.test(part.id) && ids.has("test-payload");
  const [load, forceN, sign] = droneArm ? ["1 kgf (9.8 N) peak motor thrust, upward at the motor end", GRAVITY, 1]
    : cameraArm ? ["0.5 kg camera payload (4.9 N), downward at the free end", 0.5 * GRAVITY, -1]
    : ["1 kg test load (9.8 N), downward at the free end", GRAVITY, -1];
  return { partId, load, forceN, study: { type: "strength", partId, material: material(part),
    supports: [{ axis: "x", side: "min" }], loads: [{ axis: "x", side: "max", forceN: [0, sign * forceN, 0] }], mesh: { ...mesh } } };
}

/** One plain sentence from matched before/after results under the same load. */
export function checkSentence(partName: string, load: string, before: { maxDisplacementMm: number; p95VonMisesMPa: number }, after: { maxDisplacementMm: number; p95VonMisesMPa: number }) {
  const pct = (a: number, b: number) => Math.round(Math.abs(1 - b / a) * 100);
  const mm = (v: number) => v < 0.1 ? v.toFixed(3) : v.toFixed(2);
  const bend = after.maxDisplacementMm <= before.maxDisplacementMm ? "less" : "more";
  const stress = after.p95VonMisesMPa <= before.p95VonMisesMPa ? "drops" : "rises";
  return `Under the same ${load}, ${partName} bends ${pct(before.maxDisplacementMm, after.maxDisplacementMm)}% ${bend} (${mm(before.maxDisplacementMm)} mm to ${mm(after.maxDisplacementMm)} mm) and its typical stress ${stress} ${pct(before.p95VonMisesMPa, after.p95VonMisesMPa)}%.`;
}
