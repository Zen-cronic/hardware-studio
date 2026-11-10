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

export interface GroupEdit { partIds: string[]; customParts: Part[]; explanation: string; label: string }

/**
 * "These arms", "all the arms", "both legs": the pointed part and its matching siblings
 * (same kind of part, same shape and size) change thickness together. "Stiffer" without a
 * number is one step: 1.5 times the current thickness, to the nearest half millimetre.
 */
export function localGroupEdit(snapshot: Snapshot, prompt: string, pointed: Pick<ResolvedSurfaceTarget, "partId">): GroupEdit | null {
  if (snapshot.design.kind !== "custom") return null;
  const text = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  const parts = snapshot.design.customParts || [];
  const part = parts.find(p => p.id === pointed.partId);
  if (!part || part.role === "reference" || part.process === "buy" || part.shape !== "box") return null;
  const noun = nounOf(part), many = plural(noun);
  const group = new RegExp(`\\b(?:these|those|all|both|every|each|the)\\s+(?:(?:the|four|three|two|\\d+)\\s+)?(?:${noun}s?\\b(?=.*\\b(?:all|every|each)\\b)|${many}\\b)`);
  if (!noun || !group.test(text) || BLOCKING.test(text)) return null;
  const siblings = parts.filter(p => p.role !== "reference" && p.process !== "buy" && p.shape === part.shape && nounOf(p) === noun &&
    Math.abs(p.size[0] - part.size[0]) < 0.01 && Math.abs(p.size[2] - part.size[2]) < 0.01);
  if (siblings.length < 2) return null;
  const scale = snapshot.design.params.scale || 1;
  const current = part.size[1] * scale;
  // A measurement in millimetres; a count before the noun ("all 4 arms") is not one.
  const values = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:mm\b|millimet\w*)/g)].map(m => Number(m[1]));
  let next: number, stepped = false;
  if (values.length === 1 && THICK.test(text)) next = values[0];
  else if (!values.length && STIFFER.test(text)) { next = Math.round(current * 1.5 * 2) / 2; stepped = true; }
  else return null;
  if (!(next > 0) || next > 200 || Math.abs(next - current) < 1e-9) return null;
  const ids = new Set(siblings.map(p => p.id));
  const customParts = parts.map(p => ids.has(p.id) ? { ...p, size: [p.size[0], next / scale, p.size[2]] as Part["size"] } : p);
  const count = siblings.length, word = count === 2 ? "Both" : `All ${count}`;
  const fmt = (v: number) => String(Number(v.toFixed(2)));
  const explanation = stepped
    ? `${word} ${many} go from ${fmt(current)} mm to ${fmt(next)} mm thick. A thicker ${noun} bends less under the same load. Length, width and holes stay the same. Check it before you apply it.`
    : `${word} ${many} go from ${fmt(current)} mm to ${fmt(next)} mm thick. Length, width and holes stay the same.`;
  return { partIds: siblings.map(p => p.id), customParts, explanation, label: `${count} ${many}` };
}

/**
 * "Make the hole 8 mm" while pointing at a part that has several holes, but not at one:
 * ask which hole before any assistant call. One hole needs no question.
 */
export function askWhichHole(part: Part, prompt: string, pointed: ResolvedSurfaceTarget): { explanation: string; question: string } | null {
  const text = prompt.toLowerCase();
  if (pointed.feature.kind === "hole" || pointed.feature.kind === "bore") return null;
  if (!/\bholes?\b/.test(text) || /\bhole\s*(?:#|no\.?\s*|number\s*)?\d+\b(?!\s*(?:mm|millimet|cm|in\b|inch|\.\d))/.test(text) || /\b(this|that)\s+hole\b/.test(text)) return null;
  if (/\b(add|another|new|remove|delete)\b/.test(text)) return null;
  const count = part.holes?.length || 0;
  if (count < 2) return null;
  return { explanation: `${part.name} has ${count} holes.`, question: "Which hole? Point at it and say this one, or say the left one or the right one." };
}
