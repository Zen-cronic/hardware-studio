import { useState } from "react";
import { AlertCircle, Loader2, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import { checkFreshness, rerunRequest, type CheckFreshness } from "../shared/check-freshness";
import type { Part } from "../shared/types";
import type { VersionOutcomes } from "../shared/versions";

/** Freshness of a version's checks for the revision on screen; null until its outcomes load. */
export function versionCheckFreshness(outcomes: VersionOutcomes | null, versionId: string, revision: number, parts?: readonly Pick<Part, "id">[]): CheckFreshness | null {
  if (!outcomes || outcomes.versionId !== versionId || outcomes.proposedRevision !== revision) return null;
  return checkFreshness(outcomes.studies, revision, parts?.map(p => p.id));
}

const checkName = (job: { type: string; partId?: string; setup?: { partId?: string } }, parts: Part[]) => {
  const part = parts.find(p => p.id === (job.setup?.partId || job.partId));
  return `${job.type} check${part ? " of " + part.name : ""}`;
};

/**
 * Says why Accept is off when the checks shown are out of date, and repeats them on this
 * revision with the same recorded inputs through the ordinary study runner.
 */
export default function StaleChecks({ freshness, proposedDesignId, proposedToken, revision, parts }: {
  freshness: CheckFreshness | null;
  proposedDesignId: string;
  /** Editing access to the proposed design; without it the checks cannot be repeated here. */
  proposedToken?: string;
  revision: number;
  parts: Part[];
}) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  if (!freshness?.blocked) return null;
  async function rerun() {
    if (!proposedToken || !freshness) return;
    setBusy(true); setMessage("");
    try {
      const jobs = await api<any[]>("/designs/" + proposedDesignId + "/studies", proposedToken);
      let started = 0, manual = 0;
      const failed: string[] = [];
      // Each check is started on its own: one refused request does not skip the others.
      for (const stale of freshness.stale) {
        const job = jobs.find(j => j.id === stale.id);
        const body = job && rerunRequest(job, revision, parts.find(p => p.id === (job.setup?.partId || job.partId))?.process);
        if (!body) { manual++; continue; }
        try { await api("/designs/" + proposedDesignId + "/studies", proposedToken, body); started++; }
        catch (e) { failed.push(`${checkName(job, parts)}: ${(e as Error).message}`); }
      }
      setMessage(`${started} ${started === 1 ? "check" : "checks"} started on r${revision}.` + (manual ? ` ${manual} need the study form.` : "") +
        (failed.length ? ` ${failed.length} could not start (${failed.join("; ")}).` : ""));
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="workspace-alert stale-checks" role="status" data-testid="accept-blocked">
    <AlertCircle size={17} aria-hidden="true" />
    <span>{freshness.reason}{message && <> {message}</>}</span>
    {proposedToken && freshness.stale.length > 0 && <button type="button" className="button small" disabled={busy} onClick={() => void rerun()}>
      {busy ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />} Re-run checks on this version
    </button>}
  </div>;
}
