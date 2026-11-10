// Whether the checks shown for a proposed version still describe the revision being accepted.
// Shared by the review screen (disables Accept) and the accept route (refuses unless overridden).

export interface CheckRecord {
  id: string;
  type: string;
  partId?: string;
  status: string;
  revision: number;
  stale?: boolean;
  /** The recorded study inputs; a study of no single part is identified by them. */
  setup?: unknown;
  /** The same identity, precomputed where the inputs are not sent (study outcomes). */
  inputKey?: string;
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

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
};
/** The inputs that identify a study of no single part (a rigid-body mechanism, an imported body). */
export const studyInputKey = (setup: unknown) => canonical(setup ?? {});

/** What a check is about: one part and kind, or for a study of no single part, its kind and inputs. */
export function checkKey(study: CheckRecord): string {
  if (study.partId) return `${study.type}:part:${study.partId}`;
  return `${study.type}:inputs:${study.inputKey ?? (study.setup !== undefined ? studyInputKey(study.setup) : study.id)}`;
}

/**
 * Studies are newest first, as the study list returns them; the first per component and kind counts.
 * With `partIds` (the parts at this revision), checks of a part the version removed no longer apply.
 */
export function checkFreshness(studies: CheckRecord[], revision: number, partIds?: readonly string[]): CheckFreshness {
  const present = partIds ? new Set(partIds) : null;
  const latest = new Map<string, CheckRecord>();
  for (const study of studies) {
    if (present && study.partId && !present.has(study.partId)) continue;
    const key = checkKey(study);
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
  if (job.type === "mechanism" && setup.mechanism) {
    // A part-bound mechanism study (desk-arm load and reach) needs its part, material and profile again.
    const partId = setup.partId || job.partId;
    return { type: "mechanism", revision, mechanism: setup.mechanism, ...(partId ? { partId } : {}),
      ...(setup.material ? { material: setup.material } : {}), ...(setup.profile ? { profile: setup.profile } : {}) };
  }
  return null;
}
