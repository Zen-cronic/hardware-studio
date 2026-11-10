// Sketch canvases are white paper in every theme, so their ink is fixed and dark rather than
// a theme text colour. Each collaborator draws in one of these, all at least 4.5:1 on white.

export const SKETCH_PAPER = "#FFFFFF";
export const SKETCH_INK = "#132344";
export const SKETCH_PALETTE = ["#245BA8", "#8B204B", "#166148"] as const;

const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
/** Contrast of a #RRGGBB colour against the white sketch paper; 1 for anything unreadable. */
export function contrastOnPaper(color: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16), l = 0.2126 * channel(n >> 16 & 255) + 0.7152 * channel(n >> 8 & 255) + 0.0722 * channel(n & 255);
  return 1.05 / (l + 0.05);
}
/** A collaborator's ink, from their name. */
export const inkFor = (actor: string) => SKETCH_PALETTE[Array.from(actor).reduce((sum, c) => sum + c.charCodeAt(0), 0) % SKETCH_PALETTE.length];
/** Strokes saved in a light colour are drawn in the default ink, so nothing on the paper is invisible. */
export const readableInk = (color: string) => contrastOnPaper(color) >= 3 ? color : SKETCH_INK;
