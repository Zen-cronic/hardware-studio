import type { Command, Part, Snapshot } from "../src/shared/types";
import type { AgentCredential, AgentEvent, AgentRole, RecordedAgentOperation, RecordedPartChange, VersionDiff, VersionOutcomes } from "../src/shared/versions";
import type { EngineeringJob } from "./engineering-jobs";

// Stable equality for stored optional fields, including nested counterbores.
function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
}
const holeFields = (part: Part) => ({ shape: part.shape, holes: part.holes, holeDiameter: part.holeDiameter,
  sections: part.sections, loopSpan: part.loopSpan, edgeRadius: part.edgeRadius, wall: part.wall });
export interface RecordedOperationRow { command_id: string; command: string; before_snapshot: string; result: string }
export function projectAgentOutcomes(input: {
  versionId: string; proposedDesignId: string; proposedRevision: number; status: VersionOutcomes["status"];
  currentParts?: Part[]; credentials: AgentCredential[]; events: AgentEvent[]; operations: RecordedOperationRow[]; studies: EngineeringJob[];
}, compare: (before: Snapshot, after: Snapshot) => VersionDiff): VersionOutcomes {
  const credentials = new Map(input.credentials.map(c => [`Agent ${c.role}:${c.id}`, c]));
  const stamps = new Set(input.events.filter(e => e.versionId === input.versionId && ["edit", "undo"].includes(e.action))
    .map(e => `${e.agentId}:${e.role}:${e.action}:${e.revision}`));
  const roles: AgentRole[] = ["designer", "engineer"];
  if (input.credentials.some(c => c.role === "external")) roles.push("external");
  const contributions = roles.map(role => ({ role, operations: [] as RecordedAgentOperation[] }));
  const snapshots = new Map<number, Part[]>([[input.proposedRevision, input.currentParts || []]]);
  const seen = new Set<string>();
  for (const row of input.operations) {
    if (seen.has(row.command_id)) continue;
    seen.add(row.command_id);
    const command: Command = JSON.parse(row.command), credential = credentials.get(command.actor);
    const before: Snapshot = JSON.parse(row.before_snapshot), after: Snapshot = JSON.parse(row.result);
    if (before.design.id === input.proposedDesignId) snapshots.set(before.design.revision, before.derived.parts);
    if (after.design.id === input.proposedDesignId) snapshots.set(after.design.revision, after.derived.parts);
    if (!credential || credential.versionId !== input.versionId || command.id !== row.command_id) continue;
    const action = command.undoOf ? "undo" : "edit";
    if (before.design.id !== input.proposedDesignId || after.design.id !== input.proposedDesignId ||
      !stamps.has(`${credential.id}:${credential.role}:${action}:${after.design.revision}`)) continue;
    const diff = compare(before, after);
    const parts: RecordedPartChange[] = diff.parts.map(change => {
      const old = before.derived.parts.find(p => p.id === change.partId), next = after.derived.parts.find(p => p.id === change.partId);
      const holesUnchanged = old && next && old.holes?.length && canonical(holeFields(old)) === canonical(holeFields(next))
        ? { count: old.holes.length, diameters: old.holes.map(h => h.diameter) } : undefined;
      return { ...change, ...(old ? { beforeSize: old.size } : {}), ...(next ? { afterSize: next.size } : {}),
        ...(holesUnchanged ? { holesUnchanged } : {}) };
    });
    contributions.find(c => c.role === credential.role)!.operations.push({ operationId: row.command_id, agentId: credential.id,
      label: credential.label, action, fromRevision: before.design.revision, toRevision: after.design.revision,
      hasChanges: diff.hasChanges, parameters: diff.parameters, parts });
  }
  for (const contribution of contributions) contribution.operations.sort((a, b) => a.toRevision - b.toRevision || a.operationId.localeCompare(b.operationId));
  return { versionId: input.versionId, proposedRevision: input.proposedRevision, status: input.status, contributions, studyLimit: 30,
    // Study records have no persisted agent/run link. Do not infer one from time.
    studies: input.studies.filter(job => job.designId === input.proposedDesignId).map(job => {
      const result = job.status === "ready" ? job.result : undefined;
      const stale = job.stale === true || job.revision !== input.proposedRevision;
      const staleReason = stale ? job.revision < input.proposedRevision ? "earlier_revision" : job.revision > input.proposedRevision ? "different_revision" : "source_changed" : undefined;
      const partName = snapshots.get(job.revision)?.find(part => part.id === job.partId)?.name;
      const profile: NonNullable<VersionOutcomes["studies"][number]["profile"]> = {};
      if (typeof result?.profile?.name === "string") profile.name = result.profile.name;
      for (const key of ["minWallMm", "minHoleMm", "maxHoleAspect", "toolDiameterMm", "toolReachMm"] as const)
        if (typeof result?.profile?.[key] === "number" && Number.isFinite(result.profile[key])) profile[key] = result.profile[key];
      if (Array.isArray(result?.profile?.buildEnvelopeMm) && result.profile.buildEnvelopeMm.length === 3 && result.profile.buildEnvelopeMm.every((value: unknown) => typeof value === "number" && Number.isFinite(value))) profile.buildEnvelopeMm = result.profile.buildEnvelopeMm;
      const strings = (value: unknown): string[] | undefined => Array.isArray(value) && value.every(item => typeof item === "string") ? value : undefined;
      return { id: job.id, revision: job.revision, ...(job.partId ? { partId: job.partId } : {}), ...(partName ? { partName } : {}),
        type: job.type, status: job.status, stale, ...(staleReason ? { staleReason } : {}),
        ...(typeof result?.status === "string" ? { resultStatus: result.status } : {}),
        ...(Array.isArray(result?.findings) ? { findingCount: result.findings.length } : {}),
        ...(strings(result?.checksPerformed) ? { checksPerformed: strings(result.checksPerformed) } : {}),
        ...(Object.keys(profile).length ? { profile } : {}),
        ...(strings(result?.assumptions) ? { assumptions: strings(result.assumptions) } : {}),
        ...(strings(result?.unassessed) ? { unassessed: strings(result.unassessed) } : {}) };
    }) };
}
