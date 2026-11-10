import type { Part, Snapshot } from "./types";
import type { SemanticEdit } from "./selection";

// Plain words for a measured change to one part, shown on the change card and spoken back:
// "Upper arm link: 4 → 6 mm thick. Nothing else changes."

const mm = (value: number) => String(Math.round(value * 10) / 10);

/** Which everyday word fits a box or round part's dimension along one axis. */
function dimensionWord(part: Part, axis: "x" | "y" | "z"): string {
  const i = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  if (part.shape === "box") {
    const order = [...part.size].map((v, k) => ({ v, k })).sort((a, b) => a.v - b.v).map(e => e.k);
    return order[0] === i ? "thick" : order[2] === i ? "long" : "wide";
  }
  if (i === 1) return part.size[1] >= part.size[0] ? "long" : "thick";
  return "across";
}

function others(affected: number): string {
  if (affected <= 1) return "Nothing else changes.";
  const n = affected - 1;
  return `${n} connected part${n === 1 ? "" : "s"} update${n === 1 ? "s" : ""} to match.`;
}

/**
 * The sentence for one part's edit. `fallback` is used for edits named by a control
 * label (those already read as "Label: before → after unit").
 */
export function plainEditSummary(snapshot: Snapshot, partId: string | undefined, edit: SemanticEdit, affected: number, fallback: string): string {
  const part = partId ? snapshot.derived.parts.find(p => p.id === partId) : undefined;
  if (!part || edit.type === "parameter") return `${fallback.replace(/\.$/, "")}. ${others(affected)}`;
  if (edit.type === "dimension") {
    const i = edit.axis === "x" ? 0 : edit.axis === "y" ? 1 : 2;
    return `${part.name}: ${mm(part.size[i])} → ${mm(edit.value)} mm ${dimensionWord(part, edit.axis)}. ${others(affected)}`;
  }
  if (edit.type === "wallThickness") return `${part.name}: wall ${mm(edit.value)} mm thick. ${others(affected)}`;
  if (edit.holeIndex === "bore") {
    const before = part.holeDiameter;
    return `${part.name}: inner hole, ${before ? mm(before) + " → " : ""}${mm(edit.diameter)} mm across. ${others(affected)}`;
  }
  const before = part.holes?.[edit.holeIndex]?.diameter;
  return `${part.name}: hole ${edit.holeIndex + 1}, ${before ? mm(before) + " → " : ""}${mm(edit.diameter)} mm across. ${others(affected)}`;
}
