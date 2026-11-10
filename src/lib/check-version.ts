import { api, ApiError, uid } from "./api";
import type { Proposal, Snapshot } from "../shared/types";
import type { VersionView } from "../shared/versions";

// The proposed version a "Check it" run studies, and the exact revisions that check saw.
// Apply accepts with these values, so a design that moved after the check is refused by the
// accept route's version guard instead of being overwritten.

export interface CheckedVersion {
  /** The proposal this version was made from; Apply only accepts it for that proposal. */
  proposalId: string;
  versionId: string;
  proposedDesignId: string;
  proposedToken: string;
  /** The proposed design after the proposal's change. */
  applied: Snapshot;
  expectedMainRevision: number;
  expectedProposedRevision: number;
  reviewedSnapshotHash: string;
}

export const PROPOSAL_OUT_OF_DATE = "The design changed after this proposal was made. Ask again to get a proposal for the current design.";
export const CHANGED_WHILE_CHECKING = "The design changed while checking. Check again.";

/**
 * Makes the proposed version for a check. The proposal must have been made on the revision
 * being forked: an older proposal carries an older part list and would erase newer edits.
 * `onCreated` receives the version id as soon as it exists, so an abandoned check can be discarded.
 */
export async function prepareCheckedVersion(snapshot: Snapshot, proposal: Proposal, token: string, actor: string,
  onCreated?: (versionId: string) => void): Promise<CheckedVersion> {
  const design = snapshot.design, command = proposal.command;
  if (command.baseRevision !== design.revision) throw new Error(PROPOSAL_OUT_OF_DATE);
  const created = await api<VersionView>("/designs/" + design.id + "/proposed-versions", token,
    { actor, expectedRevision: design.revision, name: ("Check: " + (command.summary || "proposed change")).slice(0, 100) });
  onCreated?.(created.version.id);
  const proposedDesignId = created.version.proposedDesignId, proposedToken = created.access?.editorToken;
  if (!proposedToken) throw new Error("Only the owner of this design can check a proposed change.");
  const applied = await api<Snapshot>("/designs/" + proposedDesignId + "/commands", proposedToken, { id: uid(), actor,
    baseRevision: created.proposed.design.revision, changes: command.changes || {}, readSet: command.readSet || {},
    ...(command.customParts ? { customParts: command.customParts } : {}), summary: command.summary });
  const view = await api<VersionView>("/proposed-versions/" + created.version.id, token);
  if (view.proposed.design.revision !== applied.design.revision) throw new Error(CHANGED_WHILE_CHECKING);
  return { proposalId: command.id, versionId: created.version.id, proposedDesignId, proposedToken, applied,
    expectedMainRevision: created.version.baseRevision, expectedProposedRevision: applied.design.revision,
    reviewedSnapshotHash: view.proposedSnapshotHash };
}

/** Accepts the checked version with the revisions the check saw; a moved design is a conflict, never an overwrite. */
export async function acceptCheckedVersion(checked: Pick<CheckedVersion, "versionId" | "expectedMainRevision" | "expectedProposedRevision" | "reviewedSnapshotHash">, token: string, actor: string) {
  try {
    return await api("/proposed-versions/" + checked.versionId + "/accept", token, { operationId: uid(), actor,
      expectedMainRevision: checked.expectedMainRevision, expectedProposedRevision: checked.expectedProposedRevision,
      reviewedSnapshotHash: checked.reviewedSnapshotHash });
  } catch (error) {
    if (error instanceof ApiError && error.code === "VERSION_CONFLICT") throw new ApiError(CHANGED_WHILE_CHECKING, error.status, [], error.code);
    throw error;
  }
}

/** Discards a check's proposed version that was not applied, so it does not stay open in the version list. */
export function discardCheckedVersion(versionId: string, token: string) {
  return api("/proposed-versions/" + versionId + "/reject", token, {}).catch(() => undefined);
}
