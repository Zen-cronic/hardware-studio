import type { BuildJob, Part, Snapshot } from "./types";
import type { PartChange, ProposedVersion, VersionDiff } from "./versions";

// Recorded study fields the before/after proof reads. Matches the engineering job record.
export interface ProofStudyRecord {
  id: string;
  designId: string;
  revision: number;
  snapshotHash?: string;
  partId?: string;
  type: string;
  status: string;
  createdAt?: string;
  stale?: boolean;
  setup?: any;
  result?: any;
  error?: string;
}

export type ConditionKey = "component" | "material" | "supports" | "loads" | "mesh";
export interface ConditionItem {
  key: ConditionKey;
  label: string;
  original: string;
  proposed: string;
  same: boolean;
}
export interface ConditionCheck {
  state: "same" | "different" | "unknown";
  items: ConditionItem[];
  differences: string[];
}

export type StaleReason = "earlier_revision" | "different_revision" | "source_changed";
export type SideState =
  | "missing" | "queued" | "running" | "failed" | "cancelled" | "no_result"
  | "converged" | "unconverged" | "not_assessed";
export interface ProofSide {
  role: "original" | "proposed";
  label: string;
  revision: number;
  state: SideState;
  stale?: StaleReason;
  staleNote?: string;
  summary: string;
  hasNumbers: boolean;
  study?: {
    id: string;
    revision: number;
    createdAt?: string;
    resultStatus?: string;
    elements?: number;
    displacementChange?: number;
    stressChange?: number;
    error?: string;
    // Recorded study inputs, used to start the other side with the same setup.
    setup?: any;
  };
}

export type Comparability = "confirmed" | "preliminary" | "not_comparable" | "unavailable";
export interface ProofMetric {
  key: "maxDisplacementMm" | "p95VonMisesMPa" | "maxVonMisesMPa";
  label: string;
  unit: string;
  original?: number;
  proposed?: number;
  change?: number;
  percent?: number;
  direction?: "lower" | "higher" | "same";
  inVerdict: boolean;
}

export type VerdictState = "improved" | "worse" | "mixed" | "unchanged" | "preliminary" | "not_comparable" | "incomplete";
export interface ProofVerdict {
  state: VerdictState;
  title: string;
  detail: string;
}

export type ExportState = "not_accepted" | "rejected" | "missing" | "matches" | "preparing" | "failed" | "older" | "newer";
export interface ExportAlignment {
  state: ExportState;
  title: string;
  detail: string;
  acceptedRevision?: number;
  mainRevision: number;
  mainChangedSinceAcceptance: boolean;
  build?: Pick<BuildJob, "id" | "revision" | "status" | "downloadUrl" | "archiveSha256" | "error">;
}

export interface ProofPartChange extends PartChange {
  beforeSize?: Part["size"];
  afterSize?: Part["size"];
}

export interface ProofComponent {
  partId: string;
  name: string;
  originalStudies: number;
  proposedStudies: number;
}

export interface ProofCard {
  versionId: string;
  versionName: string;
  status: ProposedVersion["status"];
  original: { designId: string; revision: number };
  proposed: { designId: string; revision: number };
  components: ProofComponent[];
  partId?: string;
  partName?: string;
  sides: { original: ProofSide; proposed: ProofSide };
  conditions: ConditionCheck;
  comparability: Comparability;
  metrics: ProofMetric[];
  verdict: ProofVerdict;
  otherStudies: { original: number; proposed: number };
  changes: { parts: ProofPartChange[]; parameters: VersionDiff["parameters"]; hasChanges: boolean };
  acceptance: {
    state: ProposedVersion["status"];
    acceptedMainRevision?: number;
    acceptedProposedRevision?: number;
    acceptedBy?: string;
    closedAt?: string;
  };
  export: ExportAlignment;
  scope: string;
}

export const PROOF_SCOPE =
  "Component simulation of one part under the declared load and fixed support. It is not an assembly certification, a joint or fatigue analysis, or a physical test.";

// Changes within this band are reported as "about the same".
export const SAME_BAND_PERCENT = 1;

export function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
}

const minus = (text: string) => text.replace(/^-/, "−");
export const formatValue = (value: number) => minus(Number(value.toPrecision(4)).toString());
export function formatPercent(percent: number) {
  const fixed = Math.abs(percent).toFixed(2);
  if (Number(fixed) === 0) return "0.00%";
  return (percent < 0 ? "−" : "+") + fixed + "%";
}

const signed = (axis: string, side: string) => `${side === "min" ? "−" : "+"}${String(axis).toUpperCase()}`;

function describeMaterial(material: any) {
  if (!material || typeof material !== "object") return "Not recorded";
  const parts = [material.name || "Unnamed material"];
  const values: string[] = [];
  if (Number.isFinite(material.youngModulusMPa)) values.push(`E ${Number(material.youngModulusMPa).toLocaleString("en-US")} MPa`);
  if (Number.isFinite(material.poissonRatio)) values.push(`ν ${material.poissonRatio}`);
  if (Number.isFinite(material.densityKgM3)) values.push(`${Number(material.densityKgM3).toLocaleString("en-US")} kg/m³`);
  if (values.length) parts.push(values.join(", "));
  return parts.join("; ");
}
function describeSupports(supports: any) {
  if (!Array.isArray(supports) || !supports.length) return "Not recorded";
  return supports.map((s: any) => `${signed(s?.axis, s?.side)} end fully fixed`).join("; ");
}
function describeLoad(load: any) {
  const vector: number[] = Array.isArray(load?.forceN) ? load.forceN : [];
  if (vector.length !== 3 || vector.some((v) => !Number.isFinite(v))) return "Force not recorded";
  const magnitude = Math.hypot(...vector);
  const nonzero = vector.map((v, i) => [v, i] as const).filter(([v]) => v !== 0);
  const toward = nonzero.length === 1
    ? `toward local ${nonzero[0][0] < 0 ? "−" : "+"}${"XYZ"[nonzero[0][1]]}`
    : `vector [${vector.map(formatValue).join(", ")}] N`;
  return `${formatValue(magnitude)} N ${toward} on the ${signed(load?.axis, load?.side)} end`;
}
function describeLoads(loads: any) {
  if (!Array.isArray(loads) || !loads.length) return "Not recorded";
  return loads.map(describeLoad).join("; ");
}
function describeMesh(mesh: any) {
  if (!mesh || !Number.isFinite(mesh.maxSizeMm)) return "Not recorded";
  const refinements = Number.isInteger(mesh.refinements) ? mesh.refinements : 0;
  return `Start ${formatValue(mesh.maxSizeMm)} mm, ${refinements} refinement${refinements === 1 ? "" : "s"}`;
}

// Identical-assumption check over the recorded study setups, field by field.
export function compareConditions(original: any, proposed: any, partName: (id?: string) => string = (id) => id || "Not recorded"): ConditionCheck {
  if (!original || !proposed) return { state: "unknown", items: [], differences: [] };
  const rows: [ConditionKey, string, (setup: any) => unknown, (setup: any) => string][] = [
    ["component", "Component", (s) => s.partId ?? s.importId, (s) => partName(s.partId) || "Imported solid"],
    ["material", "Material", (s) => s.material, (s) => describeMaterial(s.material)],
    ["supports", "Fixed support", (s) => s.supports, (s) => describeSupports(s.supports)],
    ["loads", "Load", (s) => s.loads, (s) => describeLoads(s.loads)],
    ["mesh", "Mesh settings", (s) => s.mesh, (s) => describeMesh(s.mesh)],
  ];
  const items = rows.map(([key, label, pick, describe]) => ({
    key, label, original: describe(original), proposed: describe(proposed),
    same: canonical(pick(original)) === canonical(pick(proposed)),
  }));
  const differences = items.filter((item) => !item.same).map((item) => item.label);
  return { state: differences.length ? "different" : "same", items, differences };
}

export function percentChange(before: number, after: number): number | undefined {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === 0) return undefined;
  return ((after - before) / Math.abs(before)) * 100;
}

const METRICS: { key: ProofMetric["key"]; label: string; unit: string; inVerdict: boolean }[] = [
  { key: "maxDisplacementMm", label: "Maximum displacement", unit: "mm", inVerdict: true },
  { key: "p95VonMisesMPa", label: "95th-percentile stress", unit: "MPa", inVerdict: true },
  { key: "maxVonMisesMPa", label: "Peak element stress", unit: "MPa", inVerdict: false },
];

export function metricDeltas(original: any, proposed: any): ProofMetric[] {
  return METRICS.map((metric) => {
    const a = original?.[metric.key], b = proposed?.[metric.key];
    const row: ProofMetric = { ...metric };
    if (typeof a === "number" && Number.isFinite(a)) row.original = a;
    if (typeof b === "number" && Number.isFinite(b)) row.proposed = b;
    if (row.original !== undefined && row.proposed !== undefined) {
      row.change = row.proposed - row.original;
      const percent = percentChange(row.original, row.proposed);
      if (percent !== undefined) {
        row.percent = percent;
        row.direction = Math.abs(percent) < SAME_BAND_PERCENT ? "same" : percent < 0 ? "lower" : "higher";
      }
    }
    return row;
  }).filter((row) => row.original !== undefined || row.proposed !== undefined);
}

const hasNumbers = (result: any) =>
  typeof result?.maxDisplacementMm === "number" && Number.isFinite(result.maxDisplacementMm);

export function staleReason(study: ProofStudyRecord, expected: { revision: number; sourceHash?: string }): StaleReason | undefined {
  if (study.revision < expected.revision) return "earlier_revision";
  if (study.revision > expected.revision) return "different_revision";
  if (study.stale === true) return "source_changed";
  if (expected.sourceHash && study.snapshotHash && study.snapshotHash !== expected.sourceHash) return "source_changed";
  return undefined;
}

const RESULT_NAMES: Record<string, string> = {
  needs_inputs: "the study needs more inputs", invalid_geometry: "the geometry needs repair",
  unsupported_physics: "this setup is not supported", mesh_failed: "the mesh could not be created", failed: "the analysis failed",
};

export function describeSide(role: ProofSide["role"], revision: number, study: ProofStudyRecord | undefined, expected: { revision: number; sourceHash?: string }): ProofSide {
  const label = role === "original" ? "Original" : "Proposed";
  if (!study) return { role, label, revision, state: "missing", hasNumbers: false,
    summary: `No strength study on the ${role} r${revision} for this component yet.` };
  const result = study.result, convergence = result?.convergence;
  const levels: any[] = Array.isArray(convergence?.levels) ? convergence.levels : [];
  const elements = levels.at(-1)?.elements ?? result?.mesh?.elementCount;
  const side: ProofSide = { role, label, revision, state: "no_result", hasNumbers: hasNumbers(result), summary: "",
    study: { id: study.id, revision: study.revision, createdAt: study.createdAt, ...(study.setup ? { setup: study.setup } : {}),
      ...(result?.status ? { resultStatus: result.status } : {}),
      ...(Number.isFinite(elements) ? { elements } : {}),
      ...(Number.isFinite(convergence?.displacementRelativeChange) ? { displacementChange: convergence.displacementRelativeChange } : {}),
      ...(Number.isFinite(convergence?.p95StressRelativeChange) ? { stressChange: convergence.p95StressRelativeChange } : {}),
      ...(study.error || result?.error ? { error: study.error || result?.error } : {}) } };
  const stale = staleReason(study, expected);
  if (stale) side.stale = stale;
  if (study.status === "queued" || study.status === "running") {
    side.state = study.status; side.hasNumbers = false;
    side.summary = study.status === "queued" ? "Study is waiting to start." : "Study is running.";
  } else if (study.status === "failed" || study.status === "cancelled") {
    side.state = study.status; side.hasNumbers = false;
    side.summary = study.status === "failed" ? `Study failed${side.study!.error ? ": " + side.study!.error : "."}` : "Study was cancelled before it finished.";
  } else if (!side.hasNumbers) {
    side.state = "no_result";
    side.summary = `No measured result: ${RESULT_NAMES[result?.status] || "the result is unavailable"}.`;
  } else if (convergence?.status === "converged") {
    side.state = "converged"; side.summary = "Mesh convergence passed.";
  } else if (convergence?.status === "unconverged" || result?.status === "unconverged") {
    side.state = "unconverged"; side.summary = "Mesh not converged. Values may still change with a finer mesh.";
  } else {
    side.state = "not_assessed"; side.summary = "Mesh convergence was not checked. Values are preliminary.";
  }
  if (stale) {
    side.staleNote = stale === "earlier_revision"
      ? `The ${role} study is for r${study.revision}, but the ${role} design is r${expected.revision}.`
      : stale === "different_revision"
        ? `The ${role} study is for r${study.revision}, not the ${role} r${expected.revision}.`
        : `The geometry behind the ${role} study changed after it ran.`;
    side.summary += " " + side.staleNote;
  }
  return side;
}

function verdictFor(sides: { original: ProofSide; proposed: ProofSide }, conditions: ConditionCheck, metrics: ProofMetric[], partName: string): { verdict: ProofVerdict; comparability: Comparability } {
  const both = [sides.original, sides.proposed];
  const waiting = both.find((s) => ["missing", "queued", "running"].includes(s.state));
  if (waiting) return { comparability: "unavailable", verdict: { state: "incomplete",
    title: waiting.state === "missing" ? `Needs a ${waiting.role} study` : `Waiting for the ${waiting.role} study`,
    detail: waiting.summary } };
  const broken = both.find((s) => !s.hasNumbers);
  if (broken) return { comparability: "unavailable", verdict: { state: "incomplete",
    title: `No measured result for the ${broken.role} revision`, detail: broken.summary } };
  const stale = both.find((s) => s.stale);
  if (stale) return { comparability: "not_comparable", verdict: { state: "not_comparable",
    title: "Not comparable: a study is out of date", detail: `${stale.staleNote} Run it again on the current revision.` } };
  if (conditions.state !== "same") return { comparability: "not_comparable", verdict: { state: "not_comparable",
    title: "Not comparable: test conditions differ",
    detail: `Different ${conditions.differences.join(", ").toLowerCase()}. Rerun one side with matching conditions.` } };
  const deciding = metrics.filter((m) => m.inVerdict && m.direction);
  const summary = deciding.map((m) => `${m.label.toLowerCase()} ${formatPercent(m.percent!)}`).join(" and ");
  const unconverged = both.filter((s) => s.state !== "converged");
  if (unconverged.length) return { comparability: "preliminary", verdict: { state: "preliminary",
    title: "Preliminary: mesh not converged",
    detail: `${unconverged.map((s) => s.label).join(" and ")} result${unconverged.length > 1 ? "s" : ""} may still change. Same conditions; ${summary || "no change measured"} for ${partName} so far.` } };
  const lower = deciding.filter((m) => m.direction === "lower").length, higher = deciding.filter((m) => m.direction === "higher").length;
  const state: VerdictState = !deciding.length ? "incomplete" : lower && !higher ? "improved" : higher && !lower ? "worse" : lower && higher ? "mixed" : "unchanged";
  const titles: Record<VerdictState, string> = {
    improved: "Improved under the same conditions", worse: "Worse under the same conditions",
    mixed: "Mixed result under the same conditions", unchanged: "About the same under the same conditions",
    incomplete: "No comparable measure", preliminary: "", not_comparable: "",
  };
  return { comparability: "confirmed", verdict: { state, title: titles[state],
    detail: deciding.length ? `${partName}: ${summary}, both meshes converged.` : "The recorded results have no shared measure." } };
}

// Selects the original and proposed study to compare for one component.
export function selectPair(original: ProofStudyRecord[], proposed: ProofStudyRecord[], expected: { original: { revision: number; sourceHash?: string }; proposed: { revision: number; sourceHash?: string } }) {
  const newest = (list: ProofStudyRecord[]) => [...list].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const a = newest(original), b = newest(proposed);
  const current = (s: ProofStudyRecord, side: "original" | "proposed") => !staleReason(s, expected[side]);
  const same = (x: ProofStudyRecord, y: ProofStudyRecord) => compareConditions(x.setup, y.setup).state === "same";
  const finished = (s: ProofStudyRecord) => s.status === "ready" && hasNumbers(s.result);
  // Prefer finished current studies with identical conditions, then any current matched pair,
  // then the newest current study on each side so a mismatch stays visible.
  const tiers: [(x: ProofStudyRecord) => boolean, (y: ProofStudyRecord) => boolean][] = [
    [(x) => current(x, "original") && finished(x), (y) => current(y, "proposed") && finished(y)],
    [(x) => current(x, "original"), (y) => current(y, "proposed")],
  ];
  for (const [okA, okB] of tiers)
    for (const y of b.filter(okB)) for (const x of a.filter(okA)) if (same(x, y)) return { original: x, proposed: y };
  return {
    original: a.find((s) => current(s, "original")) || a[0],
    proposed: b.find((s) => current(s, "proposed")) || b[0],
  };
}

export function exportAlignment(version: ProposedVersion, mainRevision: number, build: BuildJob | null): ExportAlignment {
  const summary = build ? { id: build.id, revision: build.revision, status: build.status,
    ...(build.downloadUrl ? { downloadUrl: build.downloadUrl } : {}), ...(build.archiveSha256 ? { archiveSha256: build.archiveSha256 } : {}),
    ...(build.error ? { error: build.error } : {}) } : undefined;
  const base = { mainRevision, mainChangedSinceAcceptance: false, ...(summary ? { build: summary } : {}) };
  if (version.status === "rejected") return { ...base, state: "rejected", title: "Rejected",
    detail: "Nothing was accepted, so the main design and its downloads are unchanged." };
  if (version.status !== "accepted" || version.acceptedMainRevision === undefined) return { ...base, state: "not_accepted", title: "Not accepted yet",
    detail: `After acceptance this checks that the CAD and parts list package is built from the accepted revision.${build ? ` The current package is for main r${build.revision}.` : ""}` };
  const accepted = version.acceptedMainRevision;
  const result = { ...base, acceptedRevision: accepted, mainChangedSinceAcceptance: mainRevision !== accepted };
  const changedNote = result.mainChangedSinceAcceptance ? ` The main design has changed since acceptance and is now r${mainRevision}.` : "";
  if (!build) return { ...result, state: "missing", title: "No package yet",
    detail: `No CAD and parts list package exists for accepted r${accepted}. Prepare one from the Build tab.${changedNote}` };
  if (build.revision < accepted) return { ...result, state: "older", title: "Export is for an older revision",
    detail: `The latest package is for r${build.revision}, before the accepted r${accepted}. Prepare a new package before you download.${changedNote}` };
  if (build.revision > accepted) return { ...result, state: "newer", title: "Export is for a later revision",
    detail: `The latest package is for r${build.revision}, made after main changed beyond the accepted r${accepted}.${changedNote}` };
  if (build.status === "ready") return { ...result, state: "matches", title: `Download matches accepted r${accepted}`,
    detail: `The latest package was built from the accepted revision.${changedNote}` };
  if (build.status === "failed") return { ...result, state: "failed", title: `Package for r${accepted} failed`,
    detail: (build.error || "The build could not finish.") + changedNote };
  return { ...result, state: "preparing", title: `Preparing package for r${accepted}`, detail: "The package is still being built." + changedNote };
}

export interface ProofInput {
  version: ProposedVersion;
  base: Snapshot;
  proposed: Snapshot;
  main: Snapshot;
  diff: VersionDiff;
  originalStudies: ProofStudyRecord[];
  proposedStudies: ProofStudyRecord[];
  originalSourceHash?: string;
  proposedSourceHash?: string;
  latestBuild: BuildJob | null;
  partId?: string;
}

const strengthStudy = (s: ProofStudyRecord) => s.type === "strength" && typeof s.partId === "string" && !s.setup?.importId;

export function buildProofCard(input: ProofInput): ProofCard {
  const { version, base, proposed, main } = input;
  const expected = {
    original: { revision: version.baseRevision, sourceHash: input.originalSourceHash },
    proposed: { revision: proposed.design.revision, sourceHash: input.proposedSourceHash },
  };
  const names = new Map<string, string>();
  for (const part of [...base.derived.parts, ...proposed.derived.parts]) names.set(part.id, part.name);
  const partName = (id?: string) => (id && names.get(id)) || "Recorded component";
  // A saved study's stale flag is relative to the current main revision. The original side is
  // judged against the base revision and its source fingerprint instead.
  const original = input.originalStudies.filter(strengthStudy).map((s) => ({ ...s, stale: undefined }));
  const next = input.proposedStudies.filter(strengthStudy);
  const ids = [...new Set([...next.map((s) => s.partId!), ...original.map((s) => s.partId!)])];
  const components: ProofComponent[] = ids.map((partId) => ({ partId, name: partName(partId),
    originalStudies: original.filter((s) => s.partId === partId).length, proposedStudies: next.filter((s) => s.partId === partId).length }));
  const paired = (id: string) => { const p = selectPair(original.filter((s) => s.partId === id), next.filter((s) => s.partId === id), expected);
    return p.original && p.proposed && compareConditions(p.original.setup, p.proposed.setup).state === "same"; };
  const partId = input.partId && ids.includes(input.partId) ? input.partId
    : ids.find((id) => components.find((c) => c.partId === id)!.proposedStudies > 0 && paired(id)) || ids[0];
  const pair: { original?: ProofStudyRecord; proposed?: ProofStudyRecord } = partId ? selectPair(original.filter((s) => s.partId === partId), next.filter((s) => s.partId === partId), expected) : {};
  const sides = {
    original: describeSide("original", version.baseRevision, pair.original, expected.original),
    proposed: describeSide("proposed", proposed.design.revision, pair.proposed, expected.proposed),
  };
  const conditions = compareConditions(pair.original?.setup, pair.proposed?.setup, partName);
  const metrics = metricDeltas(sides.original.hasNumbers ? pair.original?.result : undefined, sides.proposed.hasNumbers ? pair.proposed?.result : undefined);
  const { verdict, comparability } = verdictFor(sides, conditions, metrics, partName(partId));
  const oldParts = new Map(base.derived.parts.map((p) => [p.id, p])), newParts = new Map(proposed.derived.parts.map((p) => [p.id, p]));
  const parts: ProofPartChange[] = input.diff.parts.map((change) => {
    const before = oldParts.get(change.partId), after = newParts.get(change.partId);
    return { ...change, ...(change.fields.includes("size") && before && after ? { beforeSize: before.size, afterSize: after.size } : {}) };
  });
  return {
    versionId: version.id, versionName: version.name, status: version.status,
    original: { designId: base.design.id, revision: version.baseRevision },
    proposed: { designId: proposed.design.id, revision: proposed.design.revision },
    components, ...(partId ? { partId, partName: partName(partId) } : {}),
    sides, conditions, comparability, metrics, verdict,
    otherStudies: {
      original: Math.max(0, original.filter((s) => s.partId === partId).length - (pair.original ? 1 : 0)),
      proposed: Math.max(0, next.filter((s) => s.partId === partId).length - (pair.proposed ? 1 : 0)),
    },
    changes: { parts, parameters: input.diff.parameters, hasChanges: input.diff.hasChanges },
    acceptance: { state: version.status,
      ...(version.acceptedMainRevision !== undefined ? { acceptedMainRevision: version.acceptedMainRevision } : {}),
      ...(version.acceptedProposedRevision !== undefined ? { acceptedProposedRevision: version.acceptedProposedRevision } : {}),
      ...(version.acceptedBy ? { acceptedBy: version.acceptedBy } : {}), ...(version.closedAt ? { closedAt: version.closedAt } : {}) },
    export: exportAlignment(version, main.design.revision, input.latestBuild),
    scope: PROOF_SCOPE,
  };
}
