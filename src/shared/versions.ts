import type { Access, Command, Part, Snapshot } from "./types";

export type AgentRole = "designer" | "engineer" | "external";
export interface ProposedVersion {
  id: string;
  parentDesignId: string;
  proposedDesignId: string;
  baseRevision: number;
  baseSnapshotHash: string;
  status: "open" | "accepted" | "rejected";
  name: string;
  createdAt: string;
  createdBy: string;
  closedAt?: string;
  acceptedBy?: string;
  acceptedMainRevision?: number;
  acceptedProposedRevision?: number;
}
export interface PartChange {
  partId: string;
  name: string;
  type: "added" | "removed" | "changed";
  fields: string[];
}
export interface VersionDiff {
  parameters: { key: string; before?: number; after?: number }[];
  parts: PartChange[];
  metrics: { label: string; before?: string | number; after?: string | number; unit?: string }[];
  hasChanges: boolean;
}
export interface VersionView {
  version: ProposedVersion;
  base: Snapshot;
  main: Snapshot;
  proposed: Snapshot;
  mainChangedSinceBase: boolean;
  proposedSnapshotHash: string;
  diff: VersionDiff;
  canAccept: boolean;
  access?: Access;
}
export interface AcceptVersionInput {
  operationId: string;
  expectedMainRevision: number;
  expectedProposedRevision: number;
  reviewedSnapshotHash: string;
  actor: string;
}
export interface AcceptedVersion {
  version: ProposedVersion;
  snapshot: Snapshot;
}
export interface AgentCredential {
  id: string;
  versionId: string;
  role: AgentRole;
  label: string;
  createdAt: string;
  revokedAt?: string;
}
export interface AgentEvent {
  id: string;
  versionId: string;
  agentId: string;
  role: AgentRole;
  label: string;
  at: string;
  action: "read" | "preview" | "edit" | "analyze" | "conflict" | "question" | "error" | "undo";
  revision: number;
  detail: string;
}
export interface AgentRun {
  id: string;
  versionId: string;
  goal: string;
  status: "queued" | "running" | "completed" | "needs_input" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  activeRole?: AgentRole;
  completedRoles: AgentRole[];
  questions: string[];
  error?: string;
  modelBacked: boolean;
}
export interface AgentCommandInput extends Omit<Command, "actor"> { actor?: string }
export interface AgentPreview {
  revision: number;
  snapshotHash: string;
  diff: VersionDiff;
  parts: Part[];
  warnings: string[];
}

export interface RecordedPartChange extends PartChange {
  beforeSize?: Part["size"];
  afterSize?: Part["size"];
  holesUnchanged?: { count: number; diameters: number[] };
}
export interface RecordedAgentOperation {
  operationId: string;
  agentId: string;
  label: string;
  action: "edit" | "undo";
  fromRevision: number;
  toRevision: number;
  hasChanges: boolean;
  parameters: VersionDiff["parameters"];
  parts: RecordedPartChange[];
}
export interface RecordedStudyOutcome {
  id: string;
  revision: number;
  partId?: string;
  /** For a study of no single part: its recorded inputs, which identify it across re-runs. */
  inputKey?: string;
  type: "strength" | "manufacturing" | "mechanism";
  status: "queued" | "running" | "ready" | "failed" | "cancelled";
  stale: boolean;
  staleReason?: "earlier_revision" | "different_revision" | "source_changed";
  partName?: string;
  profile?: { name?: string; minWallMm?: number; minHoleMm?: number; maxHoleAspect?: number; toolDiameterMm?: number; toolReachMm?: number; buildEnvelopeMm?: number[] };
  assumptions?: string[];
  unassessed?: string[];
  resultStatus?: string;
  findingCount?: number;
  checksPerformed?: string[];
}
export interface VersionOutcomes {
  versionId: string;
  proposedRevision: number;
  status: ProposedVersion["status"];
  contributions: { role: AgentRole; operations: RecordedAgentOperation[] }[];
  studies: RecordedStudyOutcome[];
  studyLimit: number;
}
