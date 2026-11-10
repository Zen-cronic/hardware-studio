// Whether the checks shown for a proposed version still describe the revision being accepted.
// Shared by the review screen (disables Accept) and the accept route (refuses unless overridden).

export interface CheckRecord {
  id: string;
  type: string;
  partId?: string;
  status: string;
  revision: number;
  stale?: boolean;
}
export interface CheckFreshness {
  /** Accepting now would rely on checks that do not describe this revision. */
  blocked: boolean;
  /** Latest check per component and kind, recorded on an earlier revision or source. */
  stale: CheckRecord[];
  /** Latest check per component and kind, still queued or running. */
  running: CheckRecord[];
  reason: string;
}

const plural = (n: number, one: string, many: string) => n === 1 ? one : many;

/** Studies are newest first, as the study list returns them; the first per component and kind counts. */
export function checkFreshness(studies: CheckRecord[], revision: number): CheckFreshness {
  const latest = new Map<string, CheckRecord>();
  for (const study of studies) {
    const key = `${study.type}:${study.partId ?? study.id}`;
    if (!latest.has(key)) latest.set(key, study);
  }
  const running: CheckRecord[] = [], stale: CheckRecord[] = [];
  for (const study of latest.values()) {
    if (study.status === "queued" || study.status === "running") running.push(study);
    else if (study.stale || study.revision !== revision) stale.push(study);
  }
  const parts: string[] = [];
  const older = stale.filter(s => s.revision !== revision), changed = stale.filter(s => s.revision === revision);
  if (older.length) {
    const revisions = [...new Set(older.map(s => s.revision))].sort((a, b) => a - b).map(r => "r" + r).join(", ");
    parts.push(`${older.length} ${plural(older.length, "check shown is", "checks shown are")} from ${revisions}; this version is r${revision}. Re-run ${plural(older.length, "it", "them")} on this version before accepting.`);
  }
  if (changed.length)
    parts.push(`${changed.length} ${plural(changed.length, "check", "checks")} on r${revision} ${plural(changed.length, "predates", "predate")} a source change. Re-run ${plural(changed.length, "it", "them")} before accepting.`);
  if (running.length) parts.push(`${running.length} ${plural(running.length, "check is", "checks are")} still running on r${revision}. Accept when ${plural(running.length, "it finishes", "they finish")}.`);
  return { blocked: stale.length + running.length > 0, stale, running, reason: parts.join(" ") };
}

/** The request that repeats a recorded check on the current revision, or null when it needs the study form. */
export function rerunRequest(job: { type: string; partId?: string; setup?: any }, revision: number, process?: string): Record<string, unknown> | null {
  const setup = job.setup || {};
  if (setup.importId) return null;
  if (job.type === "strength") {
    if (!setup.partId || !setup.material || !setup.supports || !setup.loads) return null;
    return { type: "strength", revision, partId: setup.partId, material: setup.material, supports: setup.supports, loads: setup.loads, ...(setup.mesh ? { mesh: setup.mesh } : {}) };
  }
  if (job.type === "manufacturing") {
    const partId = setup.partId || job.partId;
    if (!partId) return null;
    return { type: "manufacturing", revision, partId, profile: setup.profile || (process === "print" ? "fdm" : "cnc"), ...(setup.processProfile ? { processProfile: setup.processProfile } : {}) };
  }
  if (job.type === "mechanism" && setup.mechanism) return { type: "mechanism", revision, mechanism: setup.mechanism };
  return null;
}
