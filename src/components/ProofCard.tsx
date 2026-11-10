import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Download, Loader2, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { formatPercent, formatValue, type ProofCard as Proof, type ProofMetric, type ProofSide } from "../shared/proof";

const SHORT_LABEL: Record<ProofMetric["key"], string> = {
  maxDisplacementMm: "Max displacement",
  p95VonMisesMPa: "95th-percentile stress",
  maxVonMisesMPa: "Peak element stress",
};
const SIDE_STATE: Record<ProofSide["state"], string> = {
  missing: "No study", queued: "Waiting", running: "Running", failed: "Failed", cancelled: "Cancelled",
  no_result: "No result", converged: "Converged", unconverged: "Not converged", not_assessed: "Not checked",
};
const tone = (state: string) =>
  ["improved", "same", "matches", "converged"].includes(state) ? "ok"
    : ["worse", "different", "not_comparable", "preliminary", "older", "newer", "missing", "failed", "unconverged", "not_assessed", "no_result", "cancelled", "mixed"].includes(state) ? "warn"
      : "neutral";
const size = (value?: number[]) => value?.join(" × ");

function ToneIcon({ state }: { state: string }) {
  const t = tone(state);
  if (["queued", "running", "preparing"].includes(state)) return <Loader2 className="spin" size={18} aria-hidden="true" />;
  if (t === "ok") return <CheckCircle2 size={18} aria-hidden="true" />;
  if (["failed", "worse"].includes(state)) return <XCircle size={18} aria-hidden="true" />;
  if (t === "warn") return <AlertTriangle size={18} aria-hidden="true" />;
  return <CircleDashed size={18} aria-hidden="true" />;
}

function ChangeCell({ metric, comparability }: { metric: ProofMetric; comparability: Proof["comparability"] }) {
  if (comparability === "unavailable" || metric.percent === undefined) return <td>—</td>;
  if (comparability === "not_comparable") return <td className="proof-not-comparable">Not comparable</td>;
  return <td data-direction={metric.direction}>{formatPercent(metric.percent)}{comparability === "preliminary" && <small>preliminary</small>}</td>;
}

function SideCell({ side }: { side: ProofSide }) {
  return <td data-state={side.state}>
    <span className="proof-side-state">{SIDE_STATE[side.state]}</span>
    {side.stale && <small className="proof-stale">Out of date{side.study ? `, r${side.study.revision}` : ""}</small>}
  </td>;
}

export default function ProofCard({ versionId, token, refreshKey, onTestProposed, onTestOriginal }: {
  versionId: string; token: string; refreshKey: string;
  onTestProposed?: (partId?: string) => void; onTestOriginal?: (partId?: string) => void;
}) {
  const [card, setCard] = useState<Proof | null>(null), [part, setPart] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const next = await api<Proof>(`/proposed-versions/${versionId}/proof${part ? "?part=" + encodeURIComponent(part) : ""}`, token);
        if (!stop) { setCard(next); setError(""); }
      } catch (e) { if (!stop) setError((e as Error).message); }
    };
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => { stop = true; clearInterval(timer); };
  }, [versionId, token, part, refreshKey]);
  if (!card || card.versionId !== versionId) return <section className="proof-card" aria-label="Before and after proof">
    <p role={error ? "alert" : "status"}>{error || "Loading the before and after proof…"}</p>
  </section>;
  const { sides, conditions, verdict, metrics, comparability } = card;
  const build = card.export.build;
  const download = card.export.state === "matches" && build?.downloadUrl;
  const needsProposed = !["converged"].includes(sides.proposed.state) || !!sides.proposed.stale || conditions.state === "different";
  const needsOriginal = sides.original.state === "missing";
  // One plain number first: how much less (or more) the part bends.
  const bend = metrics.find((m) => m.key === "maxDisplacementMm");
  const lead = verdict.state === "improved" && comparability !== "not_comparable" && bend?.percent !== undefined
    ? { value: `${Math.round(Math.abs(bend.percent))}%`, words: bend.percent < 0 ? "less bending" : "more bending" } : null;
  return <section className="proof-card" aria-label="Before and after proof" data-verdict={verdict.state}>
    <div className="proof-heading">
      <h3>Before and after</h3>
      <span className="outcome-revision">r{card.original.revision} → r{card.proposed.revision}</span>
    </div>
    {lead && <p className="proof-lead"><strong>{lead.value}</strong><span>{lead.words}</span></p>}
    <p className="outcome-secondary">The same strength test, before and after this change, under the same load.</p>
    {card.components.length > 1 && <label className="study-field">Component compared
      <select value={card.partId || ""} onChange={(e) => setPart(e.target.value)}>
        {card.components.map((c) => <option key={c.partId} value={c.partId}>{c.name}</option>)}
      </select></label>}
    <div className="proof-verdict" data-tone={tone(verdict.state)} role="status">
      <ToneIcon state={verdict.state} />
      <div><strong>{verdict.title}</strong><p>{verdict.detail}</p></div>
    </div>
    {(needsOriginal && onTestOriginal) || (needsProposed && onTestProposed) ? <div className="study-actions">
      {needsOriginal && onTestOriginal && <button className="button small" onClick={() => onTestOriginal(card.partId)}>Test the original</button>}
      {needsProposed && onTestProposed && <button className="button small" onClick={() => onTestProposed(card.partId)}>Test the proposed design</button>}
    </div> : null}
    <details className="proof-how" open={conditions.state === "different" || undefined}>
    <summary>How we checked</summary>
    <ul className="proof-checks">
      <li data-tone={tone(conditions.state)}>
        <ToneIcon state={conditions.state} />
        <div>{conditions.state === "same" ? <><strong>Same conditions</strong><p>Material, fixed support, load and mesh settings are identical on both sides.</p></>
          : conditions.state === "different" ? <><strong>Conditions differ</strong><p>Different: {conditions.differences.join(", ")}. The changes below are not comparable.</p></>
            : <><strong>Conditions not checked yet</strong><p>Both revisions need a strength study on {card.partName || "the same component"}.</p></>}
        </div>
      </li>
      <li data-tone={tone(card.export.state)} data-export={card.export.state}>
        <ToneIcon state={card.export.state} />
        <div><strong>{card.export.title}</strong><p>{card.export.detail}</p>
          {build?.archiveSha256 && card.export.state === "matches" && <p className="proof-hash">Package SHA-256, recorded when the file was built: <code>{build.archiveSha256}</code></p>}
          {card.export.state === "matches" && !build?.archiveSha256 && <p className="proof-hash">This package was built before file hashes were recorded.</p>}
          {download && <a className="button small" href={build!.downloadUrl + (build!.downloadUrl!.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token)} download><Download size={15} />Download r{build!.revision} package</a>}
        </div>
      </li>
    </ul>
    <div className="proof-table-wrap">
      <table className="proof-table">
        <caption>Measured results{card.partName ? ` for ${card.partName}` : ""}</caption>
        <thead><tr><th scope="col">Measure</th><th scope="col">Original r{card.original.revision}</th><th scope="col">Proposed r{card.proposed.revision}</th><th scope="col">Change</th></tr></thead>
        <tbody>
          <tr><th scope="row">Mesh check</th><SideCell side={sides.original} /><SideCell side={sides.proposed} /><td /></tr>
          {metrics.map((m) => <tr key={m.key} data-verdict-measure={m.inVerdict ? "yes" : "no"}>
            <th scope="row">{SHORT_LABEL[m.key]} <small>{m.unit}</small></th>
            <td>{m.original !== undefined ? formatValue(m.original) : "—"}</td>
            <td>{m.proposed !== undefined ? formatValue(m.proposed) : "—"}</td>
            <ChangeCell metric={m} comparability={comparability} />
          </tr>)}
        </tbody>
      </table>
    </div>
    {metrics.some((m) => !m.inVerdict) && <p className="outcome-secondary">Peak element stress can spike at sharp corners and fixed edges, so the verdict uses displacement and 95th-percentile stress.</p>}
    <details open={conditions.state === "different"}>
      <summary>Test conditions</summary>
      {conditions.items.length ? <dl className="proof-conditions">{conditions.items.map((item) => <div key={item.key} data-same={item.same ? "yes" : "no"}>
        <dt>{item.label}{!item.same && <span className="outcome-badge">Differs</span>}</dt>
        {item.same ? <dd>{item.original}</dd> : <><dd>Original: {item.original}</dd><dd>Proposed: {item.proposed}</dd></>}
      </div>)}</dl> : <p>No pair of recorded setups to compare yet.</p>}
      <p className="outcome-secondary">Run each study with the same component, material, fixed end, force and mesh. Results stay tied to the revision that produced them.</p>
    </details>
    <details>
      <summary>Changed parts ({card.changes.parts.length + card.changes.parameters.length})</summary>
      {!card.changes.hasChanges && <p>No geometry changes from the original.</p>}
      {card.changes.parts.map((p) => <p key={p.partId}><strong>{p.name}</strong>: {p.beforeSize && p.afterSize ? <span className="outcome-measure">{size(p.beforeSize)} → {size(p.afterSize)} mm</span> : `${p.type}${p.fields.length ? " (" + p.fields.join(", ") + ")" : ""}`}
        {p.beforeSize && p.fields.some((f) => f !== "size") ? `; also ${p.fields.filter((f) => f !== "size").join(", ")}` : ""}</p>)}
      {card.changes.parameters.map((p) => <p key={p.key}><strong>{p.key}</strong>: {p.before ?? "—"} → {p.after ?? "—"}</p>)}
    </details>
    <details>
      <summary>Study records</summary>
      {[sides.original, sides.proposed].map((side) => <article key={side.role} className="study-finding" aria-label={`${side.label} study record`}>
        <strong>{side.label} r{side.revision}: {SIDE_STATE[side.state]}</strong>
        <p>{side.summary}</p>
        {side.study && <p className="outcome-secondary">Study {side.study.id.slice(0, 8)} on r{side.study.revision}{side.study.createdAt ? `, ${new Date(side.study.createdAt).toLocaleString()}` : ""}{side.study.elements ? `, ${side.study.elements.toLocaleString("en-US")} final elements` : ""}{side.study.displacementChange !== undefined ? `, last displacement change ${(100 * side.study.displacementChange).toFixed(2)}%` : ""}{side.study.stressChange !== undefined ? `, last stress change ${(100 * side.study.stressChange).toFixed(2)}%` : ""}.</p>}
      </article>)}
      {(card.otherStudies.original > 0 || card.otherStudies.proposed > 0) && <p className="outcome-secondary">Other studies on this component: {card.otherStudies.original} original, {card.otherStudies.proposed} proposed. Each is listed in its design's study history.</p>}
    </details>
    <p className="proof-scope">{card.scope}</p>
    </details>
  </section>;
}
