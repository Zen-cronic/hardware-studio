import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { acceptCheckedVersion, CHANGED_WHILE_CHECKING, discardCheckedVersion, prepareCheckedVersion } from "../lib/check-version";
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
  /** The proposal this check ran for, and the revisions it saw; Apply sends exactly these. */
  proposalId: string; expectedMainRevision: number; expectedProposedRevision: number; reviewedSnapshotHash: string;
  versionId: string; preset: CheckPreset; partName: string; sentence: string;
  /** False when the finest mesh had not settled: the numbers are shown as preliminary. */
  settled: boolean;
  verdict?: { state: string; title: string; detail?: string };
  before: Study; after: Study;
}

// Polls the study's summary (status and headline numbers), not the full job with its mesh.
async function waitFor(id: string, token: string, alive: () => boolean) {
  for (;;) {
    const job = await api<Study>("/studies/" + id + "/summary", token);
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
  // Effect-scoped: StrictMode runs the effect twice, and the second run must leave the component live.
  const mounted = useRef(false);
  // Each check gets a run number; a newer run, a new proposal or unmounting makes older results void.
  const run = useRef(0);
  // Proposed versions this component created and did not apply; discarded when it goes away.
  const unapplied = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    const versions = unapplied.current;
    return () => {
      mounted.current = false; run.current++;
      for (const versionId of versions) void discardCheckedVersion(versionId, token);
      versions.clear();
    };
  }, [token]);
  useEffect(() => {
    // A new proposal voids a running check and discards versions checked for the old one.
    run.current++; setResult(null); setStep(""); setBusy(false);
    for (const versionId of unapplied.current) void discardCheckedVersion(versionId, token);
    unapplied.current.clear();
  }, [proposal.command.id]);
  const resultRef = useRef(result); resultRef.current = result;
  const proposalRef = useRef(proposal); proposalRef.current = proposal;
  useImperativeHandle(ref, () => ({
    accept: () => {
      const checked = resultRef.current;
      // Only the version checked for the proposal on screen can be accepted.
      if (!checked || checked.proposalId !== proposalRef.current.command.id) return null;
      return (async () => {
        try {
          await acceptCheckedVersion(checked, token, actor);
          unapplied.current.delete(checked.versionId);
          return true;
        } catch (e) {
          // A design that moved during the check needs a fresh check: the card offers one again.
          if (mounted.current && (e as Error).message === CHANGED_WHILE_CHECKING) setResult(null);
          onError((e as Error).message); return false;
        }
      })();
    },
  }), [token, actor, onError]);
  if (!preset || !target) return null;
  const partName = snapshot.derived.parts.find(p => p.id === target)?.name || "This part";
  async function check() {
    if (!preset) return;
    const mine = ++run.current, live = () => mounted.current && run.current === mine;
    setBusy(true); setResult(null);
    try {
      const design = snapshot.design, proposalId = proposal.command.id;
      setStep("Preparing the proposed version…");
      const checkedVersion = await prepareCheckedVersion(snapshot, proposal, token, actor, versionId => {
        unapplied.current.add(versionId);
        // A check abandoned before its version existed discards it at once.
        if (!mounted.current) { unapplied.current.delete(versionId); void discardCheckedVersion(versionId, token); }
      });
      if (!live()) return;
      const { versionId, proposedDesignId: proposedId, proposedToken, applied } = checkedVersion;
      setStep(`Testing both versions under the same ${preset.load}…`);
      // Reuse a finished study of the current part with exactly these inputs; otherwise run one.
      const existing = (await api<Study[]>("/designs/" + design.id + "/studies", token)).find(job => !job.stale && job.revision === design.revision &&
        job.status === "ready" && job.result?.status === "solved" && JSON.stringify(job.setup?.loads) === JSON.stringify(preset.study.loads) &&
        JSON.stringify(job.setup?.material) === JSON.stringify(preset.study.material) && job.setup?.partId === preset.partId && JSON.stringify(job.setup?.mesh) === JSON.stringify(preset.study.mesh));
      if (!live()) return;
      const beforeJob = existing || await api<Study>("/designs/" + design.id + "/studies", token, { ...preset.study, revision: design.revision });
      const afterJob = await api<Study>("/designs/" + proposedId + "/studies", proposedToken, { ...preset.study, revision: applied.design.revision });
      const before = await waitFor(beforeJob.id, token, live), after = await waitFor(afterJob.id, proposedToken, live);
      if (!live()) return;
      const proof = await api<any>("/proposed-versions/" + versionId + "/proof?part=" + encodeURIComponent(preset.partId), token);
      if (!live()) return;
      const numbers = (job: Study) => typeof job.result?.maxDisplacementMm === "number" && typeof job.result?.p95VonMisesMPa === "number";
      const settled = before.result?.status === "solved" && after.result?.status === "solved";
      // Unsettled meshes still give comparable numbers; the sentence says they are preliminary.
      const sentence = numbers(before) && numbers(after)
        ? checkSentence(partName, preset.load, before.result, after.result) + (settled ? "" : " This is preliminary: the finest mesh had not fully settled.")
        : `The check could not finish for ${partName}: ${after.result?.message || after.error || before.result?.message || before.error || "no result"}.`;
      const checked: CheckResult = { proposalId, expectedMainRevision: checkedVersion.expectedMainRevision,
        expectedProposedRevision: checkedVersion.expectedProposedRevision, reviewedSnapshotHash: checkedVersion.reviewedSnapshotHash,
        versionId, preset, partName, sentence, settled, verdict: proof.verdict, before, after };
      setResult(checked); setStep("");
      onSay?.([sentence]);
    } catch (e) { if (live()) { onError((e as Error).message); setStep(""); } }
    finally { if (live()) setBusy(false); }
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
        {(() => {
          // One big number first, the same treatment as the home page card.
          const b = (result.before.result as { maxDisplacementMm?: number } | undefined)?.maxDisplacementMm;
          const a = (result.after.result as { maxDisplacementMm?: number } | undefined)?.maxDisplacementMm;
          if (typeof b !== "number" || typeof a !== "number" || b <= 0) return null;
          const pct = Math.round((1 - a / b) * 100);
          // An unsettled mesh gives comparable numbers but not a headline: show them as preliminary.
          return <div className="check-lead" data-preliminary={result.settled ? undefined : "true"}>
            {result.settled
              ? <p className="check-big"><strong>{Math.abs(pct)}%</strong> {pct >= 0 ? "less bending" : "more bending"}</p>
              : <p className="check-big"><strong>Preliminary result</strong></p>}
            <div className="check-bars">
              <div><span>Before</span><i style={{ width: "100%" }} /><b>{b.toFixed(2)} mm</b></div>
              <div><span>After</span><i className="is-after" style={{ width: `${Math.max(4, Math.min(100, (a / b) * 100))}%` }} /><b>{a.toFixed(2)} mm</b></div>
            </div>
          </div>;
        })()}
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
