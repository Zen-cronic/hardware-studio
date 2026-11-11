import type { Part, Proposal, Snapshot } from "../shared/types";
import { createSelection, resolveSelectionSurface, type SelectionRef } from "../shared/selection";
import { partFeatures, type SurfaceFeature } from "../shared/surface";

// Deterministic follow-ups for a question the studio asked before any assistant call.
// Nothing here reaches the design assistant: answers bind to geometry or ask again.

export interface ClarifyCandidate {
  key: string;
  partId: string;
  featureId?: string;
  /** Plain words for the candidate, e.g. "front left" or "hole 3". */
  label: string;
  /** The request target this candidate stands for. */
  target: SelectionRef;
}
export type ScreenLocator = (candidate: ClarifyCandidate) => { x: number; y: number } | null;
export type ClarifyAnswer =
  | { kind: "resolved"; candidate: ClarifyCandidate; how: "pointer" | "words" | "screen" | "order" }
  | { kind: "cancel" }
  | { kind: "unclear"; message: string };

/** A proposal that only asks: no measured change and at least one question. */
export function isClarification(proposal: Proposal | null | undefined): boolean {
  return !!proposal && !Object.keys(proposal.command.changes || {}).length && !proposal.command.customParts && !!proposal.questions?.length;
}

const FEATURE_NOUNS: Record<string, (feature: SurfaceFeature) => boolean> = {
  hole: f => f.kind === "hole" || f.kind === "bore",
  bore: f => f.kind === "hole" || f.kind === "bore",
  channel: f => f.kind === "channel",
  slot: f => f.kind === "channel",
  end: f => f.kind === "face" && f.short.includes("end"),
  side: f => (f.kind === "face" && f.short.includes("side")) || f.kind === "outer",
};
const ORDINAL: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, one: 1, two: 2, three: 3, four: 4, five: 5, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5 };

/**
 * The feature kind a request names ("this hole", "hole 3"), if any. Hole numbers follow the
 * server's rule (askWhichHole): "hole 4.5 mm" and "hole 8 mm" are sizes, not hole numbers,
 * and a singular "hole" with or without an article names a hole.
 */
export function namedFeature(prompt: string): { noun: string; holeNumbers: number[] } | null {
  const text = prompt.toLowerCase();
  const holeNumbers = [...text.matchAll(/\bhole\s*(?:#|no\.?\s*|number\s*)?(\d+)\b(?!\s*(?:mm|millimet|cm|in\b|inch|\.\d))/g)].map(m => Number(m[1]));
  for (const m of text.matchAll(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s+hole\b/g)) holeNumbers.push(ORDINAL[m[1]]);
  if (holeNumbers.length) return { noun: "hole", holeNumbers };
  const noun = text.match(/\b(?:this|that|the|a)\s+(hole|bore|channel|slot|end|side)\b/)?.[1] ?? (/\bhole\b/.test(text) ? "hole" : undefined);
  return noun ? { noun, holeNumbers: [] } : null;
}

function featureCandidates(snapshot: Snapshot, part: Part, prompt: string, pointedFeatureId?: string): ClarifyCandidate[] {
  const named = namedFeature(prompt);
  if (!named) return [];
  const matches = FEATURE_NOUNS[named.noun];
  return partFeatures(part)
    .filter(({ feature }) => named.holeNumbers.length
      ? feature.kind === "hole" && (named.holeNumbers.includes(feature.holeIndex! + 1) || feature.id === pointedFeatureId)
      : matches(feature))
    .map(({ feature, target }) => ({ key: `${part.id}:${feature.id}`, partId: part.id, featureId: feature.id, label: feature.short,
      target: createSelection(snapshot, [part.id], "hover", target) }));
}

const STOP = new Set(["make", "the", "this", "that", "these", "those", "and", "with", "into", "from", "more", "less", "bit", "please", "can", "you", "its", "thick", "thicker", "thin", "thinner", "wide", "wider", "long", "longer", "short", "shorter", "tall", "taller", "stiffer", "stronger", "one", "part"]);
const singular = (word: string) => word.replace(/(ies)$/, "y").replace(/(?<=[^s])s$/, "");
const head = (name: string) => name.split(",")[0].trim().toLowerCase();
const qualifier = (name: string) => (name.split(",").slice(1).join(",").trim() || name).toLowerCase();

/**
 * For a spoken request with nothing pointed at: when it names one kind of part that the
 * design has several of ("the arm" on a quadcopter), the parts to choose between.
 */
export function partCandidates(snapshot: Snapshot, prompt: string): { noun: string; candidates: ClarifyCandidate[] } | null {
  // Only a measured or stiffness request asks "which one"; free-form wishes go to the assistant.
  if (!/\d/.test(prompt) && !/\b(thick|thicker|thinner|thickness|wide|wider|narrower|width|long|longer|shorter|length|tall|taller|stiffer|stronger)\b/i.test(prompt)) return null;
  const words = prompt.toLowerCase().match(/[a-z]+/g) || [];
  if (words.some(w => ["all", "every", "each", "both"].includes(w))) return null;
  const parts = snapshot.derived.parts.filter(p => p.role !== "reference");
  for (const raw of words) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    // A plural ("arms") is a request for several parts, not a choice.
    if (raw !== singular(raw)) continue;
    // The noun of a part's name is its last word before the comma: "Camera mount" is a mount, not a camera.
    const matches = parts.filter(p => head(p.name).split(/\s+/).at(-1) === raw);
    if (matches.length < 2) continue;
    const pick = facePick(prompt);
    return { noun: raw, candidates: matches.map(part => {
      const face = pick ? partFeatures(part).find(entry => entry.feature.id === pick) : undefined;
      return { key: part.id, partId: part.id, featureId: face?.feature.id, label: qualifier(part.name),
        target: createSelection(snapshot, [part.id], "hover", face?.target) };
    }) };
  }
  return null;
}
/** The face a measured part request is about, so the chosen part can be edited without the assistant. */
function facePick(prompt: string) {
  const text = prompt.toLowerCase();
  if (/\b(thick|thicker|thinner|thickness)\b/.test(text)) return "face+y";
  if (/\b(long|longer|shorter|length)\b/.test(text)) return "face+x";
  if (/\b(wide|wider|narrower|width)\b/.test(text)) return "face+z";
  return undefined;
}

/** Candidates for an open question: the named features of the pointed part, or the parts it names. */
export function clarifyCandidates(snapshot: Snapshot, proposal: Proposal, prompt: string): ClarifyCandidate[] {
  const target = proposal.target;
  if (!target?.partIds.length) return partCandidates(snapshot, prompt)?.candidates || [];
  if (target.partIds.length > 1) {
    const listed = partCandidates(snapshot, prompt)?.candidates.filter(c => target.partIds.includes(c.partId));
    if (listed?.length) return listed;
    return target.partIds.flatMap(id => {
      const part = snapshot.derived.parts.find(p => p.id === id);
      return part ? [{ key: id, partId: id, label: qualifier(part.name), target: createSelection(snapshot, [id], "hover") }] : [];
    });
  }
  const part = snapshot.derived.parts.find(p => p.id === target.partIds[0]);
  return part ? featureCandidates(snapshot, part, prompt, target.featureId) : [];
}

/** The studio's own question when a spoken request names one of several parts. */
export function askWhichPart(snapshot: Snapshot, prompt: string, actor: string, id: string): Proposal | null {
  const found = partCandidates(snapshot, prompt);
  if (!found) return null;
  const { noun, candidates } = found;
  const names = candidates.map(c => c.label);
  const list = names.length > 2 ? names.slice(0, -1).join(", ") + " or " + names.at(-1) : names.join(" or ");
  return {
    source: "local",
    explanation: `This design has ${candidates.length} ${noun}s.`,
    questions: [`Which ${noun}: ${list}? Point at one and say this one, or say its name.`],
    target: { partIds: candidates.map(c => c.partId), label: `${candidates.length} ${noun}s` },
    command: { id, baseRevision: snapshot.design.revision, actor, changes: {}, readSet: { ...snapshot.design.params }, summary: prompt.slice(0, 180) },
  };
}

/** Words that point at something: "this", "that one", "these", "it". */
export function pointsAtSomething(prompt: string): boolean {
  return /\b(this|that|these|those|here|there|it)\b/i.test(prompt);
}

/**
 * The studio's own question for a spoken request with nothing pointed at or selected: which of
 * several parts of one kind, or, when the words point ("make this thicker"), which part at all.
 * Null when the words are about the whole design.
 */
export function askForTarget(snapshot: Snapshot, prompt: string, actor: string, id: string): Proposal | null {
  const which = askWhichPart(snapshot, prompt, actor, id);
  if (which || !pointsAtSomething(prompt)) return which;
  return {
    source: "local",
    explanation: "Nothing was pointed at or selected.",
    questions: ["Which part do you mean? Point at it and say this one, or say its name."],
    command: { id, baseRevision: snapshot.design.revision, actor, changes: {}, readSet: { ...snapshot.design.params }, summary: prompt.slice(0, 180) },
  };
}

const POINTING = /\b(this|that|here|there|it)\b/;
const CANCEL = /\b(never ?mind|cancel|forget it|stop)\b/;
/**
 * Binds a short spoken answer to one candidate: what the pointer was on at speech onset,
 * the candidate's own name, its place on screen (left, right, top, bottom) or its order.
 */
export function resolveAnswer(snapshot: Snapshot, answer: string, candidates: ClarifyCandidate[], pointed: SelectionRef | null, locate?: ScreenLocator): ClarifyAnswer {
  const text = answer.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (CANCEL.test(text)) return { kind: "cancel" };
  const again = "Point at the one you mean and say this one, or say its name.";
  if (!candidates.length && !pointed) return { kind: "unclear", message: again };
  // The pointer at speech onset wins for "this one", when it is on a candidate (or a feature of the named kind).
  if (pointed && (POINTING.test(text) || !text)) {
    // A part candidate takes any surface of that part; a feature candidate needs that feature.
    const exact = candidates.find(c => c.partId === pointed.partIds[0] && (c.key === c.partId || c.featureId === pointed.surface?.featureId));
    if (exact) return { kind: "resolved", candidate: { ...exact, target: exact.key === exact.partId ? exact.target : pointed }, how: "pointer" };
    const kinds = new Set(candidates.flatMap(c => c.featureId ? [c.featureId.replace(/-\d+$/, "")] : []));
    try {
      const surface = resolveSelectionSurface(snapshot, pointed);
      if (surface && kinds.has(surface.feature.id.replace(/-\d+$/, "")))
        return { kind: "resolved", candidate: { key: `${surface.partId}:${surface.feature.id}`, partId: surface.partId, featureId: surface.feature.id, label: surface.feature.short, target: pointed }, how: "pointer" };
    } catch { /* A changed surface cannot answer. */ }
    if (!candidates.length) return { kind: "unclear", message: again };
  }
  // Words that appear in exactly one candidate's own name ("front left", "hole 3").
  const words = text.split(" ").filter(w => !["the", "one", "a", "please", "that", "this"].includes(w));
  const named = candidates.filter(c => { const label = c.label.toLowerCase(); return words.length > 0 && words.every(w => ORDINAL[w] !== undefined || /^\d+$/.test(w) || label.split(/[\s,]+/).includes(w)); });
  const byName = named.length === 1 ? named : candidates.filter(c => c.label.toLowerCase() === words.join(" "));
  if (byName.length === 1) return { kind: "resolved", candidate: byName[0], how: "words" };
  // Hole numbers and ordinals.
  const number = words.map(w => ORDINAL[w] ?? (/^\d+$/.test(w) ? Number(w) : undefined)).find(n => n !== undefined);
  if (number !== undefined) {
    const hole = candidates.find(c => c.featureId === `hole-${number - 1}`);
    if (hole) return { kind: "resolved", candidate: hole, how: "order" };
    if (!candidates.some(c => c.featureId?.startsWith("hole-")) && candidates[number - 1]) return { kind: "resolved", candidate: candidates[number - 1], how: "order" };
  }
  // Left, right, top, bottom: where the candidates are on screen now.
  const direction = (["left", "right", "top", "bottom", "upper", "lower", "higher"] as const).find(w => words.includes(w));
  if (direction && locate) {
    const placed = candidates.flatMap(c => { const p = locate(c); return p ? [{ c, p }] : []; });
    if (placed.length) {
      const score = (p: { x: number; y: number }) => direction === "left" ? p.x : direction === "right" ? -p.x : direction === "top" || direction === "upper" || direction === "higher" ? p.y : -p.y;
      placed.sort((a, b) => score(a.p) - score(b.p));
      return { kind: "resolved", candidate: placed[0].c, how: "screen" };
    }
  }
  return { kind: "unclear", message: again };
}
