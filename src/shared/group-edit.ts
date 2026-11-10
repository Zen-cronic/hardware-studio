import type { Part, Snapshot } from "./types";
import type { ResolvedSurfaceTarget } from "./surface";

// Deterministic edits and questions for pointed requests the design assistant is not needed for.
// They read only the request words and the declared geometry; nothing is guessed.

const head = (name: string) => name.split(",")[0].trim().toLowerCase();
const nounOf = (part: Part) => head(part.name).split(/\s+/).at(-1) || "";
const plural = (noun: string) => noun.endsWith("s") ? noun + "es" : noun.endsWith("y") ? noun.slice(0, -1) + "ies" : noun + "s";
const BLOCKING = /\b(move|shift|rotate|angle|add|remove|delete|copy|hole|holes|slot|chamfer|fillet|thread|longer|shorter|length|wider|narrower|width|position)\b/;
const STIFFER = /\b(stiffer|stiffen|stronger|strengthen|sturdier|more rigid|less flex\w*|bend less|flex less)\b/;
const THICK = /\b(thick|thicker|thickness|thinner)\b/;
const RELATIVE = /\b(thicker|thinner)\b/;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface GroupEdit { partIds: string[]; customParts: Part[]; explanation: string; label: string }

/**
 * The axis a box part's thickness is measured along: its thinnest side. When two sides are
 * equally thin, the pointed face's normal picks between them.
 */
export function thicknessAxis(part: Pick<Part, "size">, pointed?: Partial<Pick<ResolvedSurfaceTarget, "feature">>): 0 | 1 | 2 {
  const size = part.size, thinnest = Math.min(...size);
  const face = pointed?.feature?.kind === "face" && pointed.feature.axis ? "xyz".indexOf(pointed.feature.axis) as 0 | 1 | 2 : undefined;
  if (face !== undefined && Math.abs(size[face] - thinnest) < 1e-6) return face;
  return size.indexOf(thinnest) as 0 | 1 | 2;
}

/**
 * "These arms", "all the arms", "every arm", "both legs": the pointed part and its matching siblings
 * (same kind of part, same shape and size) change thickness together. "Stiffer" without a
 * number is one step: 1.5 times the current thickness, to the nearest half millimetre.
 * "2 mm thicker" or "thinner by 1 mm" changes the current thickness by that amount.
 */
export function localGroupEdit(snapshot: Snapshot, prompt: string, pointed: Pick<ResolvedSurfaceTarget, "partId"> & Partial<Pick<ResolvedSurfaceTarget, "feature">>): GroupEdit | null {
  if (snapshot.design.kind !== "custom") return null;
  const text = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  const parts = snapshot.design.customParts || [];
  const part = parts.find(p => p.id === pointed.partId);
  if (!part || part.role === "reference" || part.process === "buy" || part.shape !== "box") return null;
  const noun = nounOf(part);
  if (!noun) return null;
  const one = escape(noun), many = escape(plural(noun));
  const group = new RegExp(`\\b(?:(?:these|those|all|both|every|each|the)\\s+(?:(?:the|four|three|two|\\d+)\\s+)?(?:${one}s?\\b(?=.*\\b(?:all|every|each)\\b)|${many}\\b)|(?:every|each)\\s+(?:single\\s+)?${one}\\b)`);
  if (!group.test(text) || BLOCKING.test(text)) return null;
  const axis = thicknessAxis(part, pointed), others = ([0, 1, 2] as const).filter(a => a !== axis);
  const siblings = parts.filter(p => p.role !== "reference" && p.process !== "buy" && p.shape === part.shape && nounOf(p) === noun &&
    others.every(a => Math.abs(p.size[a] - part.size[a]) < 0.01));
  if (siblings.length < 2) return null;
  const scale = snapshot.design.params.scale || 1;
  const current = part.size[axis] * scale;
  // A measurement in millimetres; a count before the noun ("all 4 arms") is not one.
  const values = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:mm\b|millimet\w*)/g)].map(m => Number(m[1]));
  // "2 mm thicker", "thicker by 2 mm", "1 mm thinner": a change from the current thickness. "Thicker, to 6 mm" is a target.
  const relative = text.match(RELATIVE)?.[1] && !/\bto\s+\d/.test(text) ? (text.match(RELATIVE)![1] === "thinner" ? -1 : 1) : 0;
  let next: number, stepped = false;
  if (values.length === 1 && THICK.test(text)) next = relative ? current + relative * values[0] : values[0];
  else if (!values.length && STIFFER.test(text)) { next = Math.round(current * 1.5 * 2) / 2; stepped = true; }
  else return null;
  if (!(next > 0) || next > 200 || Math.abs(next - current) < 1e-9) return null;
  const ids = new Set(siblings.map(p => p.id));
  const resize = (p: Part) => { const size = [...p.size] as Part["size"]; size[axis] = next / scale; return { ...p, size }; };
  const customParts = parts.map(p => ids.has(p.id) ? resize(p) : p);
  const count = siblings.length, word = count === 2 ? "Both" : `All ${count}`, label = plural(noun);
  const fmt = (v: number) => String(Number(v.toFixed(2)));
  const explanation = stepped
    ? `${word} ${label} go from ${fmt(current)} mm to ${fmt(next)} mm thick. A thicker ${noun} bends less under the same load. Length, width and holes stay the same. Check it before you apply it.`
    : `${word} ${label} go from ${fmt(current)} mm to ${fmt(next)} mm thick. Length, width and holes stay the same.`;
  return { partIds: siblings.map(p => p.id), customParts, explanation, label: `${count} ${label}` };
}

/**
 * "Make the hole 8 mm" while pointing at a part that has several holes, but not at one:
 * ask which hole before any assistant call. One hole needs no question. Several holes
 * ("all the holes", "both holes") are not a choice: they go to the assistant. The studio
 * offers the same holes as answers (src/lib/clarify.ts namedFeature), so the question
 * always has choices.
 */
export function askWhichHole(part: Part, prompt: string, pointed: ResolvedSurfaceTarget): { explanation: string; question: string } | null {
  const text = prompt.toLowerCase();
  if (pointed.feature.kind === "hole" || pointed.feature.kind === "bore") return null;
  if (!/\bhole\b/.test(text) || /\bholes\b/.test(text) || /\b(all|both|every|each|these|those)\b/.test(text)) return null;
  if (/\bhole\s*(?:#|no\.?\s*|number\s*)?\d+\b(?!\s*(?:mm|millimet|cm|in\b|inch|\.\d))/.test(text) || /\b(this|that)\s+hole\b/.test(text)) return null;
  if (/\b(add|another|new|remove|delete)\b/.test(text)) return null;
  const count = part.holes?.length || 0;
  if (count < 2) return null;
  return { explanation: `${part.name} has ${count} holes.`, question: "Which hole? Point at it and say this one, or say the left one or the right one." };
}
