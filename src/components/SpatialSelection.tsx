import { useEffect, useRef, useState } from "react";
import type { Part } from "../shared/types";
import type { SelectionSource } from "../shared/selection";
import type { ScreenPoint } from "../lib/selection";
import { colors } from "../lib/tokens";
import "./spatial-selection.css";

export function CircleSelectionOverlay({ onCircle, onCancel }: {
  onCircle: (points: ScreenPoint[]) => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null), points = useRef<ScreenPoint[]>([]);
  const [path, setPath] = useState<ScreenPoint[]>([]);
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  useEffect(() => { ref.current?.focus(); }, []);
  const point = (event: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  return <div ref={ref} tabIndex={0} role="group" aria-label="Circle visible parts; press Escape to cancel"
    data-testid="circle-selection-overlay"
    style={{ position: "absolute", inset: 0, zIndex: 4, cursor: "crosshair", touchAction: "none", outlineOffset: -3 }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const rect = event.currentTarget.getBoundingClientRect();
      setBounds({ width: rect.width, height: rect.height });
      points.current = [point(event)]; setPath(points.current);
    }}
    onPointerMove={event => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const next = point(event), last = points.current.at(-1)!;
      if (Math.hypot(next.x - last.x, next.y - last.y) < 3) return;
      points.current = [...points.current, next].slice(-1500); setPath(points.current);
    }}
    onPointerUp={event => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      event.currentTarget.releasePointerCapture(event.pointerId); event.stopPropagation();
      const polygon = [...points.current, point(event)];
      points.current = []; setPath([]); onCircle(polygon);
    }}
    onPointerCancel={() => { points.current = []; setPath([]); onCancel(); }}>
    <svg width="100%" height="100%" viewBox={`0 0 ${bounds.width} ${bounds.height}`} aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <polygon points={path.map(p => `${p.x},${p.y}`).join(" ")} fill={`${colors.action}24`} stroke={colors.action} strokeWidth="2" strokeDasharray="6 4" />
    </svg>
  </div>;
}

export function SpatialSelectionTools({ parts, selectedIds, circleMode, onCircleMode, candidates, checked, onChecked, onFocusPart, onChoose, onDismiss, message, circleAvailable = true }: {
  parts: Part[]; selectedIds: string[]; circleMode: boolean; onCircleMode: (enabled: boolean) => void;
  candidates: string[]; checked: string[]; onChecked: (ids: string[]) => void; onFocusPart: (id: string | null) => void; onChoose: (ids: string[], source: SelectionSource) => void;
  onDismiss: () => void; message?: string; circleAvailable?: boolean;
}) {
  const circleButton = useRef<HTMLButtonElement>(null), previousCircleMode = useRef(circleMode);
  useEffect(() => {
    if (previousCircleMode.current && !circleMode) circleButton.current?.focus();
    previousCircleMode.current = circleMode;
  }, [circleMode]);
  const names = new Map(parts.map(p => [p.id, p.name]));
  return <div className="spatial-selection-tools">
    <div className="spatial-selection-actions">
      <button ref={circleButton} type="button" disabled={!circleAvailable} className={`button${circleMode ? " primary" : ""}`} aria-pressed={circleMode}
        onClick={() => onCircleMode(!circleMode)} aria-label={circleMode ? "Cancel circle selection" : "Circle a part"}>
        {circleMode ? "Cancel circle" : "Circle a part"}
      </button>
      <details className="spatial-selection-list">
        <summary className="button" aria-label="Choose a part from the list">Parts list</summary>
        <div aria-label="Select a part" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", width: 270, maxHeight: 280, overflowY: "auto", background: colors.panel, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 6, boxShadow: `0 8px 24px ${colors.text}20` }}>
          {parts.map(part => <button type="button" key={part.id} className="button" aria-pressed={selectedIds.includes(part.id)}
            style={{ display: "block", width: "100%", textAlign: "left", minHeight: 40, marginBottom: 3 }}
            onClick={event => { onChoose([part.id], "list"); const details = event.currentTarget.closest("details"); if (details) { details.open = false; details.querySelector("summary")?.focus(); } }}>
            {part.name}
          </button>)}
        </div>
      </details>
    </div>
    {candidates.length > 1 && <section aria-label="Choose circled parts" style={{ background: colors.panel, marginTop: 8, padding: 12, border: `1px solid ${colors.border}`, borderRadius: 8, boxShadow: `0 8px 24px ${colors.text}20` }}>
      <strong style={{ fontSize: "var(--s-sm)" }}>Which parts do you mean?</strong>
      <p style={{ fontSize: "var(--s-xs)", color: colors.muted, margin: "5px 0 8px" }}>The circle contains {candidates.length} visible parts. Confirm the ones to edit.</p>
      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        {candidates.map((id, index) => <label key={id} onMouseEnter={() => onFocusPart(id)} onMouseLeave={() => onFocusPart(null)} onFocus={() => onFocusPart(id)} onBlur={() => onFocusPart(null)} style={{ display: "flex", flexDirection: "row", gap: 8, alignItems: "center", minHeight: 36, fontSize: "var(--s-xs)" }}>
          <input type="checkbox" style={{ width: 16, height: 16, flex: "0 0 auto", margin: 0 }} checked={checked.includes(id)} aria-label={names.get(id) || id} onChange={event => onChecked(event.target.checked ? [...checked, id] : checked.filter(value => value !== id))} /><span className="candidate-number" aria-hidden="true">{index + 1}</span>{names.get(id) || id}
        </label>)}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button type="button" className="button primary" disabled={!checked.length} onClick={() => onChoose(checked, "circle")}>Use selected parts</button>
        <button type="button" className="button" onClick={onDismiss}>Cancel</button>
      </div>
    </section>}
    {(circleMode || message) && <p role="status" className="spatial-selection-status">{circleMode ? "Draw around a visible part. Press Escape to cancel." : message}</p>}
  </div>;
}
