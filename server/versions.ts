import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { deriveDesign, readDependencies, validateDesign } from "../src/shared/engine";
import type { Access, Command, Snapshot } from "../src/shared/types";
import type {
  AcceptedVersion, AcceptVersionInput, AgentCommandInput, AgentCredential, AgentEvent,
  AgentPreview, AgentRole, ProposedVersion, VersionDiff, VersionView,
} from "../src/shared/versions";
import { HttpError, Store, validateCommand } from "./store";
import { projectAgentOutcomes, type RecordedOperationRow } from "./agent-outcomes";
import { studySourceHash, type EngineeringJob } from "./engineering-jobs";
import { buildProofCard, type ProofCard } from "../src/shared/proof";
import type { BuildJob } from "../src/shared/types";
import { AgentService, registerAgentRoutes, type AnalysisTool } from "./agents";

function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
}
export const snapshotHash = (snapshot: Snapshot) =>
  createHash("sha256").update(canonical(snapshot.design)).digest("hex");
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
function shortText(value: unknown, label: string, max = 80): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new HttpError(422, `Provide a ${label} of at most ${max} characters.`);
  return value.trim();
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function compareSnapshots(before: Snapshot, after: Snapshot): VersionDiff {
  const parameters = [...new Set([...Object.keys(before.design.params), ...Object.keys(after.design.params)])]
    .filter((key) => before.design.params[key] !== after.design.params[key])
    .map((key) => ({ key, before: before.design.params[key], after: after.design.params[key] }));
  const oldParts = new Map(before.derived.parts.map((p) => [p.id, p]));
  const newParts = new Map(after.derived.parts.map((p) => [p.id, p]));
  const parts: VersionDiff["parts"] = [];
  for (const id of new Set([...oldParts.keys(), ...newParts.keys()])) {
    const a = oldParts.get(id), b = newParts.get(id);
    if (!a || !b) parts.push({ partId: id, name: (b || a)!.name, type: b ? "added" : "removed", fields: [] });
    else {
      const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])]
        .filter((key) => canonical(a[key as keyof typeof a]) !== canonical(b[key as keyof typeof b]));
      if (fields.length) parts.push({ partId: id, name: b.name, type: "changed", fields });
    }
  }
  const oldMetrics = new Map(before.derived.metrics.map((m) => [m.label, m]));
  const newMetrics = new Map(after.derived.metrics.map((m) => [m.label, m]));
  const metrics = [...new Set([...oldMetrics.keys(), ...newMetrics.keys()])]
    .filter((label) => canonical(oldMetrics.get(label)) !== canonical(newMetrics.get(label)))
    .map((label) => ({ label, before: oldMetrics.get(label)?.value, after: newMetrics.get(label)?.value,
      unit: newMetrics.get(label)?.unit || oldMetrics.get(label)?.unit }));
  return { parameters, parts, metrics, hasChanges: parameters.length > 0 || parts.length > 0 };
}
interface VersionRow { record: string; base_snapshot: string }
interface CredentialRow {
  id: string; version_id: string; role: AgentRole; label: string; created_at: string; revoked_at: string | null;
}
const credentialFrom = (row: CredentialRow): AgentCredential => ({
  id: row.id, versionId: row.version_id, role: row.role, label: row.label,
  createdAt: row.created_at, ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
});
export const agentActor = (credential: AgentCredential) => `Agent ${credential.role}:${credential.id}`;
export class VersionService {
  constructor(public store: Store, private broadcast: (id: string, snapshot: Snapshot) => void = () => {}) {}
  private row(id: string): VersionRow {
    const row = this.store.db.prepare("SELECT record,base_snapshot FROM proposed_versions WHERE id=?").get(id) as VersionRow | undefined;
    if (!row) throw new HttpError(404, "This proposed version was not found.", "VERSION_NOT_FOUND");
    return row;
  }
  record(id: string): ProposedVersion { return JSON.parse(this.row(id).record); }
  private save(record: ProposedVersion) {
    this.store.db.prepare("UPDATE proposed_versions SET record=? WHERE id=?").run(JSON.stringify(record), record.id);
  }
  requireOpen(id: string) {
    const version = this.record(id);
    if (version.status !== "open") throw new HttpError(409, "This proposed version is closed.", "VERSION_CLOSED");
    return version;
  }
  owner(id: string, token: string, write = true) {
    const version = this.record(id);
    this.store.authorize(version.parentDesignId, token, write);
    return version;
  }
  private humanRole(id: string, token: string): "editor" | "viewer" | undefined {
    try { return this.store.role(id, token); } catch (error) {
      if (error instanceof HttpError && error.status === 403) return undefined;
      throw error;
    }
  }
  authorize(id: string, token: string, write = false): { owner: boolean; editor: boolean; agent?: AgentCredential } {
    const version = this.record(id);
    const parentRole = this.humanRole(version.parentDesignId, token);
    const proposalRole = parentRole ? undefined : this.humanRole(version.proposedDesignId, token);
    if (parentRole || proposalRole) {
      const editor = (parentRole || proposalRole) === "editor";
      if (write && !editor) throw new HttpError(403, "This link permits viewing only.", "READ_ONLY");
      if (write) this.requireOpen(id);
      return { owner: parentRole === "editor", editor };
    }
    return { owner: false, editor: true, agent: this.agent(id, token) };
  }
  create(parentDesignId: string, token: string, body: { name?: string; actor: string; expectedRevision: number }): VersionView {
    this.store.authorize(parentDesignId, token, true);
    const actor = shortText(body?.actor, "name");
    const name = body?.name === undefined ? "Proposed version" : shortText(body.name, "version name", 100);
    const id = this.store.db.transaction(() => {
      const base = this.store.get(parentDesignId);
      if (!integer(body.expectedRevision) || body.expectedRevision !== base.design.revision)
        throw new HttpError(409, "The design changed. Refresh before creating a proposed version.", "CONFLICT");
      if (this.store.db.prepare("SELECT id FROM proposed_versions WHERE proposed_design_id=?").get(parentDesignId))
        throw new HttpError(422, "Create proposed versions from the main design.");
      const now = new Date().toISOString(), id = randomUUID();
      const design = { ...base.design, id: randomUUID(), name, revision: 0, createdAt: now, updatedAt: now };
      this.store.insert({ design, derived: deriveDesign(design), history: [] });
      const version: ProposedVersion = {
        id, parentDesignId, proposedDesignId: design.id, baseRevision: base.design.revision,
        baseSnapshotHash: snapshotHash(base), status: "open", name, createdAt: now, createdBy: actor,
      };
      this.store.db.prepare("INSERT INTO proposed_versions VALUES(?,?,?,?,?)")
        .run(id, parentDesignId, design.id, JSON.stringify(base), JSON.stringify(version));
      return id;
    }).immediate();
    return this.view(id, token);
  }
  list(parentDesignId: string, token: string): ProposedVersion[] {
    this.store.authorize(parentDesignId, token);
    return (this.store.db.prepare("SELECT record FROM proposed_versions WHERE parent_design_id=? ORDER BY rowid DESC")
      .all(parentDesignId) as { record: string }[]).map((row) => JSON.parse(row.record));
  }
  view(id: string, token: string): VersionView {
    const authority = this.authorize(id, token);
    const row = this.row(id), version: ProposedVersion = JSON.parse(row.record);
    const base: Snapshot = JSON.parse(row.base_snapshot), main = this.store.get(version.parentDesignId), proposed = this.store.get(version.proposedDesignId);
    let access: Access | undefined;
    if (authority.owner && version.status === "open") {
      const tokens = this.store.db.prepare("SELECT editor_token,viewer_token FROM designs WHERE id=?").get(version.proposedDesignId) as { editor_token: string; viewer_token: string };
      access = { editorToken: tokens.editor_token, viewerToken: tokens.viewer_token };
    }
    return {
      version, base: { ...base, role: "viewer" }, main: { ...main, role: authority.owner ? "editor" : "viewer" },
      proposed: { ...proposed, role: authority.editor && version.status === "open" ? "editor" : "viewer" },
      mainChangedSinceBase: main.design.revision !== version.baseRevision,
      proposedSnapshotHash: snapshotHash(proposed), diff: compareSnapshots(version.status === "open" ? main : base, proposed),
      canAccept: authority.owner && version.status === "open", ...(access ? { access } : {}),
    };
  }
  accept(id: string, token: string, body: AcceptVersionInput): AcceptedVersion {
    this.owner(id, token);
    shortText(body?.operationId, "action identifier", 100);
    shortText(body?.actor, "name");
    if (!integer(body.expectedMainRevision) || !integer(body.expectedProposedRevision) ||
      typeof body.reviewedSnapshotHash !== "string" || !/^[a-f0-9]{64}$/.test(body.reviewedSnapshotHash))
      throw new HttpError(422, "Review both versions before accepting the changes.");
    const result = this.store.db.transaction(() => {
      const receipt = this.store.db.prepare("SELECT request_hash,result FROM version_receipts WHERE version_id=? AND operation_id=?")
        .get(id, body.operationId) as { request_hash: string; result: string } | undefined;
      if (receipt) {
        if (receipt.request_hash !== digest(body)) throw new HttpError(409, "This action identifier was used for another acceptance.", "DUPLICATE_ID");
        return JSON.parse(receipt.result) as AcceptedVersion;
      }
      const version = this.requireOpen(id);
      const main = this.store.get(version.parentDesignId), proposed = this.store.get(version.proposedDesignId);
      if (main.design.revision !== body.expectedMainRevision || proposed.design.revision !== body.expectedProposedRevision || snapshotHash(proposed) !== body.reviewedSnapshotHash)
        throw new HttpError(409, "A version changed after your review. Compare the latest versions before accepting.", "VERSION_CONFLICT");
      if (main.design.kind !== proposed.design.kind || main.design.mechanismVersion !== proposed.design.mechanismVersion)
        throw new HttpError(422, "This version needs an explicit design conversion before acceptance.", "CONVERSION_REQUIRED");
      validateDesign(proposed.design);
      const changes = Object.fromEntries(Object.entries(proposed.design.params).filter(([key, value]) => value !== main.design.params[key]));
      const partsChanged = canonical(main.design.customParts) !== canonical(proposed.design.customParts);
      if (!Object.keys(changes).length && !partsChanged)
        throw new HttpError(422, "This proposed version has no changes to accept.", "NO_CHANGES");
      const snapshot = this.store.apply(version.parentDesignId, {
        id: body.operationId, actor: body.actor, baseRevision: main.design.revision,
        changes, readSet: { ...main.design.params },
        ...(partsChanged ? { customParts: proposed.design.customParts } : {}),
        summary: "Accept proposed version: " + version.name,
      });
      const accepted: ProposedVersion = { ...version, status: "accepted", closedAt: new Date().toISOString(),
        acceptedBy: body.actor, acceptedMainRevision: snapshot.design.revision, acceptedProposedRevision: proposed.design.revision };
      this.save(accepted);
      this.revokeAll(id);
      const result: AcceptedVersion = { version: accepted, snapshot: { ...snapshot, role: "editor" } };
      this.store.db.prepare("INSERT INTO version_receipts VALUES(?,?,?,?)").run(id, body.operationId, digest(body), JSON.stringify(result));
      return result;
    }).immediate();
    this.broadcast(result.version.parentDesignId, this.store.get(result.version.parentDesignId));
    return result;
  }
  reject(id: string, token: string): ProposedVersion {
    this.owner(id, token);
    return this.store.db.transaction(() => {
      const old = this.record(id);
      if (old.status === "rejected") return old;
      const version = this.requireOpen(id);
      const rejected: ProposedVersion = { ...version, status: "rejected", closedAt: new Date().toISOString() };
      this.save(rejected); this.revokeAll(id);
      return rejected;
    }).immediate();
  }
  issueAgent(id: string, token: string, body: { role: AgentRole; label: string }) {
    this.owner(id, token); this.requireOpen(id);
    if (!["designer", "engineer", "external"].includes(body?.role)) throw new HttpError(422, "Choose an agent role.");
    const label = shortText(body.label, "agent name", 60), value = randomBytes(32).toString("base64url");
    const credential: AgentCredential = { id: randomUUID(), versionId: id, role: body.role, label, createdAt: new Date().toISOString() };
    this.store.db.prepare("INSERT INTO agent_credentials VALUES(?,?,?,?,?,?,NULL)")
      .run(credential.id, id, tokenHash(value), body.role, label, credential.createdAt);
    return { credential, token: value, mcpUrl: `/api/proposed-versions/${id}/mcp` };
  }
  agent(id: string, token: string): AgentCredential {
    if (typeof token !== "string" || !token || token.length > 200) throw new HttpError(403, "Use an active agent connection for this proposed version.", "AGENT_FORBIDDEN");
    const row = this.store.db.prepare("SELECT * FROM agent_credentials WHERE version_id=? AND token_hash=? AND revoked_at IS NULL")
      .get(id, tokenHash(token)) as CredentialRow | undefined;
    if (!row) throw new HttpError(403, "Use an active agent connection for this proposed version.", "AGENT_FORBIDDEN");
    this.requireOpen(id);
    return credentialFrom(row);
  }
  credentials(id: string, token: string): AgentCredential[] {
    this.owner(id, token, false);
    return (this.store.db.prepare("SELECT * FROM agent_credentials WHERE version_id=? ORDER BY created_at").all(id) as CredentialRow[]).map(credentialFrom);
  }
  revoke(id: string, token: string, credentialId: string) {
    this.owner(id, token);
    this.store.db.prepare("UPDATE agent_credentials SET revoked_at=? WHERE version_id=? AND id=? AND revoked_at IS NULL")
      .run(new Date().toISOString(), id, credentialId);
  }
  private revokeAll(id: string) {
    this.store.db.prepare("UPDATE agent_credentials SET revoked_at=? WHERE version_id=? AND revoked_at IS NULL")
      .run(new Date().toISOString(), id);
  }
  log(credential: AgentCredential, action: AgentEvent["action"], revision: number, detail: string): AgentEvent {
    const event: AgentEvent = { id: randomUUID(), versionId: credential.versionId, agentId: credential.id,
      role: credential.role, label: credential.label, action, revision, at: new Date().toISOString(), detail: detail.slice(0, 2000) };
    this.store.db.prepare("INSERT INTO agent_events VALUES(?,?,?)").run(event.id, credential.versionId, JSON.stringify(event));
    return event;
  }
  events(id: string, token: string): AgentEvent[] {
    this.authorize(id, token);
    return (this.store.db.prepare("SELECT event FROM agent_events WHERE version_id=? ORDER BY rowid DESC LIMIT 200").all(id) as { event: string }[])
      .reverse().map((r) => JSON.parse(r.event));
  }
  outcomes(id: string, token: string, studies: (designId: string) => EngineeringJob[]) {
    this.authorize(id, token);
    return this.store.db.transaction(() => {
      const version = this.record(id), proposed = this.store.get(version.proposedDesignId);
      const credentials = (this.store.db.prepare("SELECT * FROM agent_credentials WHERE version_id=? ORDER BY created_at")
        .all(id) as CredentialRow[]).map(credentialFrom);
      const events = (this.store.db.prepare("SELECT event FROM agent_events WHERE version_id=? ORDER BY rowid")
        .all(id) as { event: string }[]).map(row => JSON.parse(row.event) as AgentEvent);
      const operations = this.store.db.prepare("SELECT command_id,command,before_snapshot,result FROM operations WHERE design_id=? ORDER BY rowid")
        .all(version.proposedDesignId) as RecordedOperationRow[];
      return projectAgentOutcomes({ versionId: id, proposedDesignId: version.proposedDesignId,
        proposedRevision: proposed.design.revision, currentParts: proposed.derived.parts, status: version.status, credentials, events, operations,
        studies: studies(version.proposedDesignId) }, compareSnapshots);
    })();
  }
  // Before/after proof from saved records only: no study or build is started here.
  proof(id: string, token: string, studies: (designId: string) => EngineeringJob[], latestBuild: (designId: string) => BuildJob | null, partId?: string): ProofCard {
    this.authorize(id, token);
    return this.store.db.transaction(() => {
      const row = this.row(id), version: ProposedVersion = JSON.parse(row.record);
      const base: Snapshot = JSON.parse(row.base_snapshot);
      const main = this.store.get(version.parentDesignId), proposed = this.store.get(version.proposedDesignId);
      return buildProofCard({
        version, base, main, proposed, diff: compareSnapshots(base, proposed),
        originalStudies: studies(version.parentDesignId), proposedStudies: studies(version.proposedDesignId),
        originalSourceHash: studySourceHash(base), proposedSourceHash: studySourceHash(proposed),
        latestBuild: latestBuild(version.parentDesignId),
        ...(typeof partId === "string" && partId ? { partId: partId.slice(0, 200) } : {}),
      });
    })();
  }
  preview(id: string, token: string, input: AgentCommandInput): AgentPreview {
    const credential = this.agent(id, token), version = this.requireOpen(id), before = this.store.get(version.proposedDesignId);
    const command: Command = { ...input, actor: agentActor(credential) };
    validateCommand(command, before.design);
    if (command.baseRevision !== before.design.revision || Object.entries(command.readSet).some(([key, value]) => before.design.params[key] !== value))
      throw new HttpError(409, "The proposed version changed. Read it again before previewing.", "CONFLICT");
    for (const key of readDependencies(before.design.kind, command.changes))
      if (!Object.hasOwn(command.readSet, key)) throw new HttpError(422, "The edit is missing an original measurement.", "MISSING_DEPENDENCY");
    const design = { ...before.design, params: { ...before.design.params, ...command.changes },
      ...(command.customParts ? { customParts: command.customParts } : {}) };
    validateDesign(design);
    const after = { ...before, design, derived: deriveDesign(design) };
    this.log(credential, "preview", before.design.revision, command.summary || "Previewed measured changes");
    return { revision: before.design.revision, snapshotHash: snapshotHash(before), diff: compareSnapshots(before, after), parts: after.derived.parts, warnings: after.derived.warnings };
  }
  apply(id: string, token: string, input: AgentCommandInput): Snapshot {
    const credential = this.agent(id, token), version = this.requireOpen(id);
    try {
      const snapshot = this.store.apply(version.proposedDesignId, { ...input, actor: agentActor(credential) });
      this.log(credential, "edit", snapshot.design.revision, input.summary || "Updated the proposed design");
      this.broadcast(version.proposedDesignId, this.store.get(version.proposedDesignId));
      return { ...snapshot, role: "editor" };
    } catch (error) {
      this.log(credential, error instanceof HttpError && error.status === 409 ? "conflict" : "error",
        this.store.get(version.proposedDesignId).design.revision, error instanceof Error ? error.message : "Edit failed");
      throw error;
    }
  }
  undo(id: string, token: string, operationId: string, idempotencyId: string): Snapshot {
    const credential = this.agent(id, token), version = this.requireOpen(id);
    shortText(operationId, "operation identifier", 100); shortText(idempotencyId, "action identifier", 100);
    const result = this.store.undo(version.proposedDesignId, agentActor(credential), operationId, idempotencyId);
    this.log(credential, "undo", result.design.revision, "Undid an agent edit");
    this.broadcast(version.proposedDesignId, this.store.get(version.proposedDesignId));
    return result;
  }
}

export const versionTokenOf = (request: FastifyRequest) => {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : "";
};
export interface VersionRouteOptions {
  store: Store;
  broadcast?: (id: string, snapshot: Snapshot) => void;
  aiKey?: string;
  analyze?: AnalysisTool;
  studies?: (designId: string) => EngineeringJob[];
  latestBuild?: (designId: string) => BuildJob | null;
  allowedOrigins?: string[];
}
export function registerVersionRoutes(app: FastifyInstance, options: VersionRouteOptions) {
  const versions = new VersionService(options.store, options.broadcast);
  const idOf = (r: FastifyRequest) => String((r.params as { id: string }).id);
  app.post("/api/designs/:id/proposed-versions", async (r, reply) => reply.code(201).send(versions.create(idOf(r), versionTokenOf(r), r.body as any)));
  app.get("/api/designs/:id/proposed-versions", async (r) => versions.list(idOf(r), versionTokenOf(r)));
  app.get("/api/proposed-versions/:id", async (r) => versions.view(idOf(r), versionTokenOf(r)));
  app.get("/api/proposed-versions/:id/outcomes", async (r) => versions.outcomes(idOf(r), versionTokenOf(r), options.studies || (() => [])));
  app.get("/api/proposed-versions/:id/proof", async (r) => versions.proof(idOf(r), versionTokenOf(r), options.studies || (() => []),
    options.latestBuild || (() => null), (r.query as { part?: unknown })?.part as string | undefined));
  app.post("/api/proposed-versions/:id/accept", async (r) => versions.accept(idOf(r), versionTokenOf(r), r.body as AcceptVersionInput));
  app.post("/api/proposed-versions/:id/reject", async (r) => versions.reject(idOf(r), versionTokenOf(r)));
  app.post("/api/proposed-versions/:id/agent-credentials", async (r, reply) => reply.code(201).send(versions.issueAgent(idOf(r), versionTokenOf(r), r.body as any)));
  app.get("/api/proposed-versions/:id/agent-credentials", async (r) => versions.credentials(idOf(r), versionTokenOf(r)));
  app.delete("/api/proposed-versions/:id/agent-credentials/:credentialId", async (r, reply) => {
    versions.revoke(idOf(r), versionTokenOf(r), (r.params as { credentialId: string }).credentialId); return reply.code(204).send();
  });
  app.get("/api/proposed-versions/:id/activity", async (r) => versions.events(idOf(r), versionTokenOf(r)));
  const agents = new AgentService(versions, { apiKey: options.aiKey, analyze: options.analyze });
  registerAgentRoutes(app, versions, agents, options.allowedOrigins);
  app.addHook("onClose", async () => { await agents.close(); });
  return { versions, agents };
}
