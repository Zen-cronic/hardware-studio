import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { api, uid } from "../lib/api";
import { checkPreset, checkSentence, type CheckPreset } from "../shared/check-presets";
import type { Proposal, Snapshot } from "../shared/types";
import "./proposal-check.css";

// "Check it" before applying: the proposal becomes a proposed version, the same strength study
// runs on the current part and on the proposed part, and the before/after card is read in plain
// words. Applying a checked proposal accepts that version, so the evidence stays with the design.

export interface ProposalCheckHandle {
  /** Accepts the checked version; null when nothing was checked, so the caller applies directly. */
  accept: () => Promise<boolean> | null;
}
type Study = { id: string; status: string; error?: string; result?: any; setup?: any; revision: number; partId?: string; stale?: boolean };
export interface CheckResult {
  versionId: string; preset: CheckPreset; partName: string; sentence: string;
  verdict?: { state: string; title: string; detail?: string };
  before: Study; after: Study;
}

async function waitFor(id: string, token: string, alive: () => boolean) {
  for (;;) {
    const job = await api<Study>("/studies/" + id, token);
    if (!["queued", "running"].includes(job.status) || !alive()) return job;
    await new Promise(r => setTimeout(r, 1200));
  }
}

const ProposalCheck = forwardRef<ProposalCheckHandle, {
  snapshot: Snapshot; proposal: Proposal; token: string; actor: string;
  /** The part the check studies; defaults to the proposal's first target part. */
  partId?: string;
  disabled?: boolean;
  onSay?: (lines: string[]) => void;
  onError: (message: string) => void;
}>(function ProposalCheck({ snapshot, proposal, token, actor, partId, disabled = false, onSay, onError }, ref) {
  const target = partId || proposal.target?.partIds[0];
  const preset = target ? checkPreset(snapshot, target) : null;
  const [busy, setBusy] = useState(false), [step, setStep] = useState(""), [result, setResult] = useState<CheckResult | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { setResult(null); setStep(""); }, [proposal.command.id]);
  const resultRef = useRef(result); resultRef.current = result;
  useImperativeHandle(ref, () => ({
    accept: () => {
      const checked = resultRef.current;
      if (!checked) return null;
      return (async () => {
        try {
          const view = await api<any>("/proposed-versions/" + checked.versionId, token);
          await api("/proposed-versions/" + checked.versionId + "/accept", token, { operationId: uid(), actor,
            expectedMainRevision: view.main.design.revision, expectedProposedRevision: view.proposed.design.revision, reviewedSnapshotHash: view.proposedSnapshotHash });
          return true;
        } catch (e) { onError((e as Error).message); return false; }
      })();
    },
  }), [token, actor, onError]);
  if (!preset || !target) return null;
  const partName = snapshot.derived.parts.find(p => p.id === target)?.name || "This part";
  async function check() {
    if (!preset) return;
    setBusy(true); setResult(null);
    try {
      const design = snapshot.design, command = proposal.command;
      setStep("Preparing the proposed version…");
      const version = await api<any>("/designs/" + design.id + "/proposed-versions", token,
        { actor, expectedRevision: design.revision, name: ("Check: " + (command.summary || "proposed change")).slice(0, 100) });
      const proposedId = version.version.proposedDesignId, proposedToken = version.access?.editorToken;
      if (!proposedToken) throw new Error("Only the owner of this design can check a proposed change.");
      const applied = await api<Snapshot>("/designs/" + proposedId + "/commands", proposedToken, { id: uid(), actor, baseRevision: 0,
        changes: command.changes || {}, readSet: command.readSet || {}, ...(command.customParts ? { customParts: command.customParts } : {}), summary: command.summary });
      setStep(`Testing both versions under the same ${preset.load}…`);
      // Reuse a finished study of the current part with exactly these inputs; otherwise run one.
      const existing = (await api<Study[]>("/designs/" + design.id + "/studies", token)).find(job => !job.stale && job.revision === design.revision &&
        job.status === "ready" && job.result?.status === "solved" && JSON.stringify(job.setup?.loads) === JSON.stringify(preset.study.loads) &&
        JSON.stringify(job.setup?.material) === JSON.stringify(preset.study.material) && job.setup?.partId === preset.partId && JSON.stringify(job.setup?.mesh) === JSON.stringify(preset.study.mesh));
      const beforeJob = existing || await api<Study>("/designs/" + design.id + "/studies", token, { ...preset.study, revision: design.revision });
      const afterJob = await api<Study>("/designs/" + proposedId + "/studies", proposedToken, { ...preset.study, revision: applied.design.revision });
      const before = await waitFor(beforeJob.id, token, () => alive.current), after = await waitFor(afterJob.id, proposedToken, () => alive.current);
      if (!alive.current) return;
      const proof = await api<any>("/proposed-versions/" + version.version.id + "/proof?part=" + encodeURIComponent(preset.partId), token);
      const numbers = (job: Study) => typeof job.result?.maxDisplacementMm === "number" && typeof job.result?.p95VonMisesMPa === "number";
      const settled = before.result?.status === "solved" && after.result?.status === "solved";
      // Unsettled meshes still give comparable numbers; the sentence says they are preliminary.
      const sentence = numbers(before) && numbers(after)
        ? checkSentence(partName, preset.load, before.result, after.result) + (settled ? "" : " This is preliminary: the finest mesh had not fully settled.")
        : `The check could not finish for ${partName}: ${after.result?.message || after.error || before.result?.message || before.error || "no result"}.`;
      const checked: CheckResult = { versionId: version.version.id, preset, partName, sentence, verdict: proof.verdict, before, after };
      setResult(checked); setStep("");
      onSay?.([sentence]);
    } catch (e) { onError((e as Error).message); setStep(""); }
    finally { if (alive.current) setBusy(false); }
  }
  const m = (job: Study, key: string, unit: string) => typeof job.result?.[key] === "number" ? `${job.result[key].toPrecision(3)} ${unit}` : "—";
  return (
    <div className="proposal-check" data-testid="proposal-check">
      {!result && <button type="button" className="button wide" data-testid="check-proposal" disabled={busy || disabled} onClick={() => void check()}>
        {busy ? <Loader2 className="spin" size={16} /> : <FlaskConical size={16} />} {busy ? "Checking…" : "Check it before applying"}
      </button>}
      {busy && step && <p className="subtle" role="status">{step}</p>}
      {!busy && !result && <p className="subtle">Tests {partName} now and as proposed, under the same {preset.load}.</p>}
      {result && <section className="check-result" aria-label="Check result" data-testid="check-result" data-verdict={result.verdict?.state || "unknown"}>
        <p className="check-sentence">{result.sentence}</p>
        {result.verdict && <p className="check-verdict"><strong>{result.verdict.title}</strong></p>}
        <details><summary>How we checked</summary>
          <p>{partName}, fixed at its inner end. Load: {result.preset.load}, {result.preset.forceN.toFixed(3)} N. Material: {result.preset.study.material.name}.</p>
          <dl className="check-numbers">
            <div><dt>Bend at the loaded end</dt><dd>{m(result.before, "maxDisplacementMm", "mm")} → {m(result.after, "maxDisplacementMm", "mm")}</dd></div>
            <div><dt>Typical stress (95th percentile)</dt><dd>{m(result.before, "p95VonMisesMPa", "MPa")} → {m(result.after, "p95VonMisesMPa", "MPa")}</dd></div>
          </dl>
          <p className="subtle">Linear static study of this one part with declared values. It is a comparison, not a rating of the assembly.</p>
        </details>
      </section>}
    </div>
  );
});
export default ProposalCheck;
