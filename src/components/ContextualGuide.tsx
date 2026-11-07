import { useEffect, useMemo, useState } from "react";
import type { Snapshot } from "../shared/types";
import {
  applySemanticEdit, assertCurrentSelection, getSelectionControls, selectionSuggestions,
  type SelectionRef, type SemanticEdit, type SemanticEditPreview,
} from "../shared/selection";
import { colors } from "../lib/tokens";
import { X } from "lucide-react";

type Props = {
  snapshot: Snapshot;
  selection?: SelectionRef | null;
  onPrompt: (prompt: string) => void;
  onPreview?: (result: SemanticEditPreview) => void;
  disabled?: boolean;
  onClearSelection?: () => void;
};
export default function ContextualGuide({ snapshot, selection, onPrompt, onPreview, disabled, onClearSelection }: Props) {
  const [advanced, setAdvanced] = useState(() => {
    try { return localStorage.getItem("hardware-studio-guidance") === "advanced"; } catch { return false; }
  });
  const [controlId, setControlId] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const context = useMemo(() => {
    try {
      const parts = selection ? assertCurrentSelection(snapshot, selection) : [];
      return { parts, controls: selection ? getSelectionControls(snapshot, selection) : [],
        suggestions: selectionSuggestions(snapshot, selection || undefined), stale: false };
    } catch {
      return { parts: [], controls: [], suggestions: [], stale: true };
    }
  }, [snapshot, selection]);
  const control = context.controls.find(item => item.id === controlId) || context.controls[0];
  useEffect(() => { setControlId(context.controls[0]?.id || ""); setError(""); }, [selection, snapshot.design.revision]);
  useEffect(() => { setValue(control ? String(control.value) : ""); setError(""); }, [control?.id, control?.value]);
  const unavailable = !!disabled || context.stale || snapshot.role === "viewer";
  return <section className="contextual-guide" aria-label="Design guidance" style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: 14, background: colors.panel }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <strong className="text-edit" style={{ fontSize: "var(--s-sm)" }}>{context.parts.length === 1 ? context.parts[0].name : context.parts.length ? "Selected parts" : "Where to start"}</strong>
      <button type="button" className="button" aria-pressed={advanced} onClick={() => {
        setAdvanced(!advanced);
        try { localStorage.setItem("hardware-studio-guidance", !advanced ? "advanced" : "guided"); } catch { /* Browser storage is optional. */ }
      }}>{advanced ? "Advanced" : "Guided"}</button>
      {onClearSelection && <button type="button" className="button icon-only mobile-clear-selection" aria-label="Clear selected part" onClick={onClearSelection}><X size={14}/></button>}
    </div>
    {context.parts.length === 1 && <p className="mobile-selection-detail">{context.parts[0].material} / {context.parts[0].size.map(v => Math.round(v)).join(" × ")} mm</p>}
    {context.stale ? <p role="status" style={{ color: colors.warning, fontSize: "var(--s-sm)" }}>The design changed. Select the part again to keep your request attached to the right revision.</p> : <>
      {!advanced && <p style={{ fontSize: "var(--s-xs)", color: colors.muted, lineHeight: 1.5, margin: "8px 0 12px" }}>
        {context.parts.length ? "Preview your change before accepting it." : "Click or circle a part, describe what you want it to do, and review the proposed change before accepting."}
      </p>}
      {!!context.controls.length && onPreview && <form aria-label="Preview a selected-part edit" style={{ borderTop: `1px solid ${colors.surface}`, marginTop: 12, paddingTop: 12 }} onSubmit={event => {
        event.preventDefault();
        if (!control || !selection || unavailable) return;
        const number = Number(value);
        if (!value.trim() || !Number.isFinite(number)) { setError("Enter a number before previewing."); return; }
        if (number < control.min || number > control.max) { setError(`Use a value between ${control.min} and ${control.max} ${control.unit}.`); return; }
        try {
          const intent: SemanticEdit = control.intent.type === "hole" ? { ...control.intent, diameter: number } : { ...control.intent, value: number };
          const result = applySemanticEdit(snapshot, selection, intent);
          setError(""); onPreview(result);
        } catch (issue) { setError(issue instanceof Error ? issue.message : "That edit could not be validated."); }
      }}>
        <label style={{ display: "grid", gap: 6, fontSize: "var(--s-xs)" }}>Dimension or behavior
          <select aria-label="Selected part control" value={control?.id || ""} disabled={unavailable} onChange={event => setControlId(event.target.value)}>
            {context.controls.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        {control && <>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--s-xs)", margin: "10px 0" }}>
            <span style={{ flex: 1 }}>New value ({control.unit})</span>
            <input aria-label={`New ${control.label.toLowerCase()}`} type="number" min={control.min} max={control.max} step="any" value={value} disabled={unavailable}
              style={{ width: 100 }} onChange={event => setValue(event.target.value)} />
          </label>
          <button type="submit" className="button primary" disabled={unavailable || !value.trim()}>Preview change</button>
          {!advanced && <p style={{ fontSize: "var(--s-xs)", color: colors.muted, lineHeight: 1.5, margin: "8px 0" }}>{control.description}</p>}
        </>}
      </form>}
      <details className="suggested-requests"><summary>Suggested requests</summary><div style={{ display: "grid", gap: 6, marginTop: 8 }}>
        {context.suggestions.map(prompt => <button key={prompt} type="button" className="button" disabled={unavailable}
          style={{ whiteSpace: "normal", textAlign: "left", justifyContent: "flex-start", fontSize: "var(--s-xs)", lineHeight: 1.45, padding: "8px 10px" }}
          onClick={() => onPrompt(prompt)}>{prompt}</button>)}
      </div></details>
      {!!selection && !context.controls.length && <p style={{ fontSize: "var(--s-xs)", color: colors.muted, lineHeight: 1.5 }}>Select one fabricated part to change a local dimension. Reference and purchased components keep their measured dimensions.</p>}
      {!advanced && <details style={{ fontSize: "var(--s-xs)", color: colors.muted, marginTop: 12 }}>
        <summary style={{ cursor: "pointer", color: colors.action }}>What do these terms mean?</summary>
        <dl style={{ display: "grid", gap: 5, lineHeight: 1.5 }}>
          <dt><strong>Local axes</strong></dt><dd style={{ margin: 0 }}>Directions attached to a part, even when it is rotated in the assembly.</dd>
          <dt><strong>Clearance</strong></dt><dd style={{ margin: 0 }}>The space between parts so they can fit or move.</dd>
          <dt><strong>Proposed version</strong></dt><dd style={{ margin: 0 }}>A place to try changes and compare them before updating your main design.</dd>
          <dt><strong>Load and support</strong></dt><dd style={{ margin: 0 }}>A force acting on the product and the places that hold it in position.</dd>
        </dl>
      </details>}
    </>}
    {error && <p role="alert" style={{ color: colors.danger, fontSize: "var(--s-xs)", lineHeight: 1.5 }}>{error}</p>}
  </section>;
}
