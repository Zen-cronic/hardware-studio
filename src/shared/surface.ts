import type { Part, Vec3 } from "./types";
import type { SemanticEdit } from "./selection";

// Surface targeting resolves a pointer hit on one rendered part to a feature
// that the part model actually declares: a numbered hole, a tube bore, an
// underside channel, a named planar face, a cylindrical outer surface, the
// rounded edges of a rounded box or the curved surface of an ellipsoid.
// Anything else falls back to "face with normal ... near (x, y, z) mm".
// Coordinates are part-local millimetres of the derived (scaled) part, the
// same frame used to render the mesh. Holes run along local Y.

export type SurfaceFeatureKind = "hole" | "bore" | "face" | "outer" | "channel" | "edge" | "surface";
export interface SurfaceTarget {
  partId: string;
  featureId: string;
  point: Vec3;
  normal: Vec3;
}
export interface SurfaceFeature {
  id: string;
  kind: SurfaceFeatureKind;
  /** Short feature name used after the part name, e.g. "Ø6.4 mm hole 1". */
  label: string;
  /** Plain words for status text and binding, e.g. "hole 1". */
  short: string;
  axis?: "x" | "y" | "z";
  side?: 1 | -1;
  holeIndex?: number;
  dimensions: Record<string, number>;
}
export interface ResolvedSurfaceTarget {
  partId: string;
  partName: string;
  feature: SurfaceFeature;
  point: Vec3;
  normal: Vec3;
  label: string;
}

const AXES = ["x", "y", "z"] as const;
const round = (value: number, step: number) => Math.round(value / step) * step;
const clean = (value: number, digits: number) => Number(value.toFixed(digits)) || 0;
export const formatMm = (value: number) => String(Number(value.toFixed(1)));

function tolerance(part: Part) {
  return Math.max(0.2, Math.max(...part.size) * 0.002);
}
function holeMargin(radius: number) {
  return Math.max(1.5, radius * 0.6);
}
function radialTolerance(radius: number, base: number) {
  return Math.max(base * 2, 0.4, radius * 0.01);
}
function dominantAxis(normal: Vec3): 0 | 1 | 2 {
  const a = normal.map(Math.abs);
  return (a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2) as 0 | 1 | 2;
}
function sectionAt(part: Part, y: number) {
  const outer = part.size[0] / 2;
  const bore = part.shape === "tube" && part.holeDiameter ? part.holeDiameter / 2 : 0;
  if (!part.sections?.length) return { outer, bore, index: -1 };
  let offset = -part.size[1] / 2;
  for (const [index, section] of part.sections.entries()) {
    if (y <= offset + section.height + 1e-6 || index === part.sections.length - 1)
      return { outer: section.diameter / 2, bore: section.bore / 2, index };
    offset += section.height;
  }
  return { outer, bore, index: -1 };
}

function holeFeature(part: Part, index: number): SurfaceFeature {
  const hole = part.holes![index];
  const dimensions: Record<string, number> = { diameter: clean(hole.diameter, 3), centerX: clean(hole.x, 3), centerZ: clean(hole.z, 3), depth: clean(part.size[1], 3) };
  if (hole.counterbore) Object.assign(dimensions, { counterboreDiameter: clean(hole.counterbore.diameter, 3), counterboreDepth: clean(hole.counterbore.depth, 3) });
  return { id: `hole-${index}`, kind: "hole", holeIndex: index, label: `Ø${formatMm(hole.diameter)} mm hole ${index + 1}`, short: `hole ${index + 1}`, dimensions };
}
function boreFeature(part: Part, diameter: number): SurfaceFeature {
  return { id: "bore", kind: "bore", label: part.loopSpan !== undefined ? "inner loop surface" : `Ø${formatMm(diameter)} mm bore`,
    short: part.loopSpan !== undefined ? "inner loop surface" : "bore", dimensions: { diameter: clean(diameter, 3), length: clean(part.size[1], 3) } };
}
function outerFeature(part: Part, diameter: number): SurfaceFeature {
  return { id: "outer", kind: "outer", label: part.loopSpan !== undefined ? "outer loop surface" : `outer surface Ø${formatMm(diameter)} mm`,
    short: part.loopSpan !== undefined ? "outer loop surface" : "outer surface", dimensions: { diameter: clean(diameter, 3), length: clean(part.size[1], 3) } };
}
function edgeFeature(part: Part): SurfaceFeature {
  const r = part.edgeRadius!;
  return { id: "edge", kind: "edge", label: `rounded edge, ${formatMm(r)} mm radius`, short: "rounded edge", dimensions: { radius: clean(r, 3) } };
}
function ellipsoidFeature(part: Part): SurfaceFeature {
  const [d, h] = part.size, ball = Math.abs(d - h) < 1e-6;
  return { id: "outer", kind: "outer", label: ball ? `ball surface Ø${formatMm(d)} mm` : `rounded surface Ø${formatMm(d)} × ${formatMm(h)} mm`,
    short: ball ? "ball surface" : "rounded surface", dimensions: { diameter: clean(d, 3), length: clean(h, 3) } };
}
function channelFeature(part: Part): SurfaceFeature {
  const c = part.channel!;
  return { id: "channel", kind: "channel", label: `underside channel ${formatMm(c.width)} mm wide`, short: "underside channel",
    dimensions: { width: clean(c.width, 3), depth: clean(c.depth, 3), length: clean(part.size[0], 3) } };
}
function faceFeature(part: Part, axisIndex: 0 | 1 | 2, side: 1 | -1): SurfaceFeature {
  const axis = AXES[axisIndex], sign = side > 0 ? "+" : "−";
  const isRound = part.shape !== "box";
  let short: string;
  if (axis === "y") short = isRound ? (side > 0 ? "top end face" : "bottom end face") : (side > 0 ? "top face" : "bottom face");
  else {
    const longest = part.size[axisIndex] >= Math.max(...part.size) - 1e-9;
    short = `${sign}${axis.toUpperCase()} ${longest ? "end" : "side"} face`;
  }
  const others = [0, 1, 2].filter(i => i !== axisIndex);
  return { id: `face${side > 0 ? "+" : "-"}${axis}`, kind: "face", axis, side, label: short, short,
    dimensions: isRound && axis === "y" ? { diameter: clean(part.size[0], 3) } : { [`size${AXES[others[0]].toUpperCase()}`]: clean(part.size[others[0]], 3), [`size${AXES[others[1]].toUpperCase()}`]: clean(part.size[others[1]], 3), offset: clean(part.size[axisIndex] / 2, 3) } };
}
function normalWords(normal: Vec3) {
  const axis = dominantAxis(normal);
  if (Math.abs(normal[axis]) > 0.95) return `${normal[axis] > 0 ? "+" : "−"}${AXES[axis].toUpperCase()}`;
  return `(${normal.map(v => v.toFixed(2)).join(", ")})`;
}
function fallbackFeature(point: Vec3, normal: Vec3): SurfaceFeature {
  const label = `face with normal ${normalWords(normal)} near (${point.map(formatMm).join(", ")}) mm`;
  return { id: "surface", kind: "surface", label, short: label, dimensions: {} };
}

/** Resolves a part-local hit to the nearest feature the part model declares. */
export function resolveSurfaceFeature(part: Part, point: Vec3, normal: Vec3): SurfaceFeature {
  const tol = tolerance(part), half = part.size.map(v => v / 2) as Vec3;
  const [x, y, z] = point, ny = Math.abs(normal[1]);
  const onCap = (sign: number, level = half[1]) => Math.abs(y - sign * level) <= tol;
  for (const [index, hole] of (part.holes || []).entries()) {
    const distance = Math.hypot(x - hole.x, z - hole.z), radius = hole.diameter / 2;
    const counterbore = hole.counterbore ? hole.counterbore.diameter / 2 : 0;
    const wall = Math.abs(y) <= half[1] + tol && ny < 0.5 &&
      (Math.abs(distance - radius) <= radialTolerance(radius, tol) || (counterbore > 0 && Math.abs(distance - counterbore) <= radialTolerance(counterbore, tol)));
    const capNear = ny >= 0.5 && distance <= Math.max(radius, counterbore) + holeMargin(radius) &&
      (onCap(1) || onCap(-1) || (hole.counterbore !== undefined && onCap(1, half[1] - hole.counterbore.depth)));
    if (wall || capNear) return holeFeature(part, index);
  }
  if (part.shape === "box") {
    const c = part.channel;
    if (c && Math.abs(z) <= c.width / 2 + tol && y <= -half[1] + c.depth + tol && Math.abs(x) < half[0] - tol && !onCap(-1))
      return channelFeature(part);
    const candidates = ([0, 1, 2] as const).filter(axis => Math.abs(Math.abs(point[axis]) - half[axis]) <= tol);
    const axis = candidates.length ? candidates.reduce((best, a) => Math.abs(normal[a]) > Math.abs(normal[best]) ? a : best) : dominantAxis(normal);
    // A rounded box is flat only inside its fillets; anything else is the rounded edge.
    if (part.edgeRadius) return candidates.includes(axis) && Math.abs(normal[axis]) >= 0.98 ? faceFeature(part, axis, point[axis] >= 0 ? 1 : -1) : edgeFeature(part);
    if (!candidates.length && Math.abs(normal[axis]) < 0.9) return fallbackFeature(point, normal);
    const side: 1 | -1 = candidates.includes(axis) ? (point[axis] >= 0 ? 1 : -1) : (normal[axis] >= 0 ? 1 : -1);
    return faceFeature(part, axis, side);
  }
  if (part.shape === "ellipsoid") return ellipsoidFeature(part);
  if (part.loopSpan !== undefined) {
    const dx = Math.max(0, Math.abs(x) - part.loopSpan / 2), r = Math.hypot(dx, z);
    if (ny >= 0.5 && (onCap(1) || onCap(-1))) return faceFeature(part, 1, y >= 0 ? 1 : -1);
    if (Math.abs(r - part.size[2] / 2) <= radialTolerance(part.size[2] / 2, tol)) return outerFeature(part, part.size[2]);
    if (part.holeDiameter && Math.abs(r - part.holeDiameter / 2) <= radialTolerance(part.holeDiameter / 2, tol)) return boreFeature(part, part.holeDiameter);
    return fallbackFeature(point, normal);
  }
  const radial = Math.hypot(x, z), section = sectionAt(part, y);
  if (ny >= 0.5 && (onCap(1) || onCap(-1))) return faceFeature(part, 1, y >= 0 ? 1 : -1);
  if (section.bore > 0 && ny < 0.5 && Math.abs(radial - section.bore) <= radialTolerance(section.bore, tol))
    return boreFeature(part, section.bore * 2);
  if (ny < 0.5 && Math.abs(radial - section.outer) <= radialTolerance(section.outer, tol)) return outerFeature(part, section.outer * 2);
  return fallbackFeature(point, normal);
}

export function roundSurfacePoint(point: Vec3): Vec3 {
  return point.map(v => clean(round(v, 0.01), 2)) as Vec3;
}
export function roundSurfaceNormal(normal: Vec3): Vec3 {
  const length = Math.hypot(...normal) || 1;
  return normal.map(v => clean(v / length, 3)) as Vec3;
}

/** Builds a serializable target from a raw hit; resolution uses the rounded values the server will see. */
export function surfaceTargetFromHit(part: Part, point: Vec3, normal: Vec3): SurfaceTarget {
  const p = roundSurfacePoint(point), n = roundSurfaceNormal(normal);
  return { partId: part.id, featureId: resolveSurfaceFeature(part, p, n).id, point: p, normal: n };
}

function representative(part: Part, feature: SurfaceFeature): SurfaceTarget | null {
  const half = part.size.map(v => v / 2) as Vec3;
  const tries: { point: Vec3; normal: Vec3 }[] = [];
  if (feature.kind === "hole") {
    const hole = part.holes![feature.holeIndex!];
    tries.push({ point: [hole.x + hole.diameter / 2, 0, hole.z], normal: [-1, 0, 0] });
  } else if (feature.kind === "bore") {
    const r = feature.dimensions.diameter / 2;
    tries.push(part.loopSpan !== undefined ? { point: [0, 0, r], normal: [0, 0, -1] } : { point: [r, 0, 0], normal: [-1, 0, 0] });
  } else if (feature.kind === "outer") {
    const r = feature.dimensions.diameter / 2;
    tries.push(part.loopSpan !== undefined ? { point: [0, 0, r], normal: [0, 0, 1] } : { point: [r, 0, 0], normal: [1, 0, 0] });
  } else if (feature.kind === "channel") {
    tries.push({ point: [0, -half[1] + part.channel!.depth, 0], normal: [0, -1, 0] });
  } else if (feature.kind === "edge") {
    const r = part.edgeRadius!, c = Math.SQRT1_2;
    tries.push({ point: [half[0] - r + r * c, half[1] - r + r * c, 0], normal: [c, c, 0] });
  } else if (feature.kind === "face") {
    const a = AXES.indexOf(feature.axis!), others = [0, 1, 2].filter(i => i !== a);
    for (const u of [0, 0.35, -0.35, 0.7, -0.7]) for (const v of [0, 0.35, -0.35, 0.7, -0.7]) {
      const point = [0, 0, 0] as Vec3, normal = [0, 0, 0] as Vec3;
      point[a] = feature.side! * half[a]; normal[a] = feature.side!;
      point[others[0]] = u * half[others[0]]; point[others[1]] = v * half[others[1]];
      if (part.shape !== "box" && a === 1 && Math.hypot(point[0], point[2]) > half[0] * 0.95) continue;
      tries.push({ point, normal });
    }
  }
  for (const attempt of tries) {
    const target = surfaceTargetFromHit(part, attempt.point, attempt.normal);
    if (target.featureId === feature.id) return target;
  }
  return null;
}

/** Features a keyboard user can cycle through, each with a target that resolves back to itself. */
export function partFeatures(part: Part): { feature: SurfaceFeature; target: SurfaceTarget }[] {
  const list: SurfaceFeature[] = [];
  part.holes?.forEach((_, index) => list.push(holeFeature(part, index)));
  if (part.shape === "box") {
    const order: [0 | 1 | 2, 1 | -1][] = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
    for (const [axis, side] of order) list.push(faceFeature(part, axis, side));
    if (part.channel) list.push(channelFeature(part));
    if (part.edgeRadius) list.push(edgeFeature(part));
  } else if (part.shape === "ellipsoid") {
    list.push(ellipsoidFeature(part));
  } else {
    const middle = sectionAt(part, 0);
    if (part.shape === "tube" && (middle.bore > 0 || part.loopSpan !== undefined))
      list.push(boreFeature(part, part.loopSpan !== undefined ? part.holeDiameter! : middle.bore * 2));
    list.push(outerFeature(part, part.loopSpan !== undefined ? part.size[2] : middle.outer * 2));
    list.push(faceFeature(part, 1, 1), faceFeature(part, 1, -1));
  }
  return list.flatMap(feature => {
    const target = representative(part, feature);
    return target ? [{ feature, target }] : [];
  });
}

export function featureById(part: Part, featureId: string, target?: SurfaceTarget): SurfaceFeature | null {
  if (target && target.partId === part.id) {
    const resolved = resolveSurfaceFeature(part, target.point, target.normal);
    if (resolved.id === featureId) return resolved;
  }
  return partFeatures(part).find(entry => entry.feature.id === featureId)?.feature || null;
}

/** Where to draw a target on possibly changed geometry: the hit itself, or the feature's own anchor. */
export function displayTarget(part: Part, target: SurfaceTarget): { target: SurfaceTarget; feature: SurfaceFeature } | null {
  const feature = resolveSurfaceFeature(part, target.point, target.normal);
  if (feature.id === target.featureId) return { target, feature };
  const entry = partFeatures(part).find(item => item.feature.id === target.featureId);
  return entry ? { target: entry.target, feature: entry.feature } : null;
}

export function surfaceLabel(partName: string, feature: SurfaceFeature) {
  return `${partName}, ${feature.label}`;
}

export class SurfaceTargetError extends Error {
  constructor(message: string, readonly code = "STALE_SELECTION") { super(message); }
}

function finiteVec(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(v => typeof v === "number" && Number.isFinite(v));
}

/** Validates an untrusted target against current geometry and returns the server-resolved feature. */
export function resolveSurfaceTarget(parts: Part[], partIds: string[], surface: unknown): ResolvedSurfaceTarget {
  const target = surface as SurfaceTarget;
  if (!target || typeof target !== "object" || typeof target.partId !== "string" || typeof target.featureId !== "string" ||
      target.featureId.length > 40 || !finiteVec(target.point) || !finiteVec(target.normal))
    throw new SurfaceTargetError("The pointed surface is not valid. Point at the part again.", "INVALID_SELECTION");
  if (partIds.length !== 1 || partIds[0] !== target.partId)
    throw new SurfaceTargetError("A pointed surface must belong to the one targeted part.", "INVALID_SELECTION");
  const part = parts.find(p => p.id === target.partId);
  if (!part) throw new SurfaceTargetError("A selected part is no longer in this design.");
  const length = Math.hypot(...target.normal), half = part.size.map(v => v / 2 + 1);
  if (length < 0.5 || length > 1.5 || target.point.some((v, i) => Math.abs(v) > half[i]))
    throw new SurfaceTargetError("The pointed surface is outside this part. Point at it again.", "INVALID_SELECTION");
  const point = roundSurfacePoint(target.point), normal = roundSurfaceNormal(target.normal);
  const feature = resolveSurfaceFeature(part, point, normal);
  if (feature.id !== target.featureId)
    throw new SurfaceTargetError("The pointed surface changed. Point at it again before sending this request.");
  return { partId: part.id, partName: part.name, feature, point, normal, label: surfaceLabel(part.name, feature) };
}

// Request binding. These deterministic rules never guess: a request that names
// a different feature than the pointed one becomes a clarification.

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5 };
const UNIT_AFTER = /^\s*(?:mm|millimet|cm|centimet|in\b|inch|"|\.\d|,\d)/i;

function namedHoles(text: string): { numbers: number[]; spans: [number, number][] } {
  const numbers: number[] = [], spans: [number, number][] = [];
  for (const match of text.matchAll(/\bhole\s*(?:#|no\.?\s*|number\s*)?(\d+)\b/gi)) {
    const end = match.index! + match[0].length;
    if (UNIT_AFTER.test(text.slice(end))) continue;
    numbers.push(Number(match[1])); spans.push([match.index!, end]);
  }
  for (const match of text.matchAll(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s+hole\b/gi)) {
    numbers.push(ORDINALS[match[1].toLowerCase()]); spans.push([match.index!, match.index! + match[0].length]);
  }
  return { numbers, spans };
}

const NOUN_KINDS: Record<string, (feature: SurfaceFeature) => boolean> = {
  hole: f => f.kind === "hole" || f.kind === "bore",
  bore: f => f.kind === "hole" || f.kind === "bore",
  channel: f => f.kind === "channel",
  slot: f => f.kind === "channel",
  end: f => f.kind === "face" && (f.short.includes("end")),
  top: f => f.kind === "face" && f.axis === "y" && f.side === 1,
  bottom: f => f.kind === "face" && f.axis === "y" && f.side === -1,
  side: f => (f.kind === "face" && f.short.includes("side")) || f.kind === "outer",
  edge: f => f.kind === "edge",
};

/** Returns a clarification when the request names a feature other than the pointed one. */
export function surfaceConflict(prompt: string, target: ResolvedSurfaceTarget): string | null {
  const text = prompt.toLowerCase(), feature = target.feature;
  const { numbers } = namedHoles(text);
  for (const n of numbers) if (feature.kind !== "hole" || n !== feature.holeIndex! + 1)
    return `You pointed at ${target.label}, but the request names hole ${n}. Point at the hole you mean, or clear the pointer and name it.`;
  for (const match of text.matchAll(/\b(this|that)\s+(hole|bore|channel|slot|end|top|bottom|side|edge)\b/g)) {
    if (!NOUN_KINDS[match[2]](feature))
      return `You pointed at ${target.label}, but the request says “${match[0]}”. Point at the feature you mean, or clear the pointer and describe it.`;
  }
  return null;
}

const BLOCKING_WORDS = /\b(deep|depth|move|moved|shift|position|rotate|angle|counterbore|countersink|chamfer|fillet|thread|tap|slot|add|remove|delete|copy|another|second|both|all)\b/;
/**
 * Deterministic binding for a fully specified measured edit of the pointed
 * feature. Returns null when the wording needs the design assistant.
 */
export function localSurfaceEdit(prompt: string, target: ResolvedSurfaceTarget, part: Part): SemanticEdit | null {
  const holes = namedHoles(prompt.toLowerCase());
  let text = prompt.toLowerCase();
  for (const [start, end] of [...holes.spans].reverse()) text = text.slice(0, start) + " " + text.slice(end);
  if (/\d\s*(?:cm|centimet|in\b|inch|")/.test(text) || /\b(?:inch|inches|centimet\w*)\b/.test(text) || BLOCKING_WORDS.test(text)) return null;
  const numbers = [...text.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\d.])/g)].map(m => Number(m[1]));
  if (numbers.length !== 1 || !(numbers[0] > 0)) return null;
  const value = numbers[0], feature = target.feature;
  if (feature.kind === "hole")
    return /\b(thick|thickness|long|length|tall|height)\b/.test(text) ? null : { type: "hole", holeIndex: feature.holeIndex!, diameter: value };
  if (feature.kind === "bore")
    return part.loopSpan !== undefined || /\b(thick|thickness|long|length|tall|height|wall)\b/.test(text) ? null : { type: "hole", holeIndex: "bore", diameter: value };
  if (feature.kind === "outer")
    return part.loopSpan === undefined && /\b(diameter|wide|wider|width|narrower|outside)\b/.test(text) ? { type: "dimension", axis: "x", value } : null;
  if (feature.kind !== "face") return null;
  const isEnd = feature.short.includes("end") && feature.axis !== "y";
  const words = feature.axis === "y" ? /\b(thick|thicker|thinner|thickness|tall|taller|height|high)\b/
    : isEnd ? /\b(long|longer|shorter|length|extend)\b/ : /\b(wide|wider|narrower|width)\b/;
  if (!words.test(text)) return null;
  if (part.shape !== "box" && feature.axis !== "y") return null;
  return { type: "dimension", axis: feature.axis!, value };
}

/** Plain description of the target for the design assistant contract. */
export function targetContext(target: ResolvedSurfaceTarget) {
  return {
    partId: target.partId, partName: target.partName,
    feature: { id: target.feature.id, kind: target.feature.kind, name: target.feature.short, ...(target.feature.holeIndex !== undefined ? { holeIndex: target.feature.holeIndex } : {}),
      ...(target.feature.axis ? { axis: target.feature.axis, side: target.feature.side } : {}), dimensionsMm: target.feature.dimensions },
    hitPointMm: target.point, surfaceNormal: target.normal, frame: "part-local millimetres, holes run along local Y",
  };
}
