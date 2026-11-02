import Database from "better-sqlite3";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  createDesign,
  deriveDesign,
  validateDesign,
  readDependencies,
  DesignError,
} from "../src/shared/engine";
import type {
  Snapshot,
  Command,
  Access,
  ProductKind,
  Part,
  BuildJob,
  Design,
} from "../src/shared/types";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_ERROR",
    public conflicts: string[] = [],
  ) {
    super(message);
  }
}
interface DesignRow {
  id: string;
  snapshot: string;
  editor_token: string;
  viewer_token: string;
}
interface OperationRow {
  command_id: string;
  payload_hash: string;
  result: string;
  before_snapshot: string;
  command: string;
}
export class Store {
  db: Database.Database;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS designs(id TEXT PRIMARY KEY,snapshot TEXT NOT NULL,editor_token TEXT NOT NULL,viewer_token TEXT NOT NULL); CREATE TABLE IF NOT EXISTS operations(design_id TEXT NOT NULL,command_id TEXT NOT NULL,payload_hash TEXT NOT NULL,result TEXT NOT NULL,before_snapshot TEXT NOT NULL,command TEXT NOT NULL,PRIMARY KEY(design_id,command_id)); CREATE TABLE IF NOT EXISTS builds(id TEXT PRIMARY KEY,design_id TEXT NOT NULL,job TEXT NOT NULL,archive TEXT); CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,content BLOB NOT NULL); CREATE TABLE IF NOT EXISTS ai_usage(id TEXT PRIMARY KEY,at TEXT NOT NULL,status TEXT NOT NULL,reserved REAL NOT NULL,spent REAL NOT NULL,input_tokens INTEGER,output_tokens INTEGER);",
    );
    this.db
      .prepare(
        "UPDATE builds SET job=json_set(job,'$.status','failed','$.error','Build interrupted. Please start a new package.') WHERE json_extract(job,'$.status') IN ('queued','running')",
      )
      .run();
  }
  create(kind: ProductKind, name?: string, parts?: Part[]) {
    const design = createDesign(kind, name, parts);
    return this.insert({ design, derived: deriveDesign(design), history: [] });
  }
  insert(snapshot: Snapshot): { snapshot: Snapshot; access: Access } {
    const access = {
      editorToken: randomBytes(24).toString("base64url"),
      viewerToken: randomBytes(24).toString("base64url"),
    };
    this.db
      .prepare("INSERT INTO designs VALUES(?,?,?,?)")
      .run(
        snapshot.design.id,
        JSON.stringify(snapshot),
        access.editorToken,
        access.viewerToken,
      );
    return { snapshot: { ...snapshot, role: "editor" }, access };
  }
  get(id: string): Snapshot {
    const row = this.db.prepare("SELECT * FROM designs WHERE id=?").get(id) as
      | DesignRow
      | undefined;
    if (!row)
      throw new HttpError(404, "This design was not found.", "NOT_FOUND");
    return JSON.parse(row.snapshot);
  }
  role(id: string, token: string): "editor" | "viewer" {
    const row = this.db.prepare("SELECT * FROM designs WHERE id=?").get(id) as
      | DesignRow
      | undefined;
    if (!row)
      throw new HttpError(404, "This design was not found.", "NOT_FOUND");
    if (token && token === row.editor_token) return "editor";
    if (token && token === row.viewer_token) return "viewer";
    throw new HttpError(
      403,
      "Use a valid share link to open this design.",
      "FORBIDDEN",
    );
  }
  authorize(id: string, token: string, write = false) {
    const role = this.role(id, token);
    if (write && role !== "editor")
      throw new HttpError(
        403,
        "This link allows viewing. Ask the owner for an editing link.",
        "READ_ONLY",
      );
    return role;
  }
  fork(id: string) {
    const old = this.get(id);
    const now = new Date().toISOString();
    const design = {
      ...old.design,
      id: crypto.randomUUID(),
      name: old.design.name + " — copy",
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    return this.insert({ design, derived: deriveDesign(design), history: [] });
  }
  apply(id: string, command: Command): Snapshot {
    return this.db
      .transaction(() => {
        const current = this.get(id);
        validateCommand(command, current.design);
        const serialized = JSON.stringify(command),
          hash = createHash("sha256").update(serialized).digest("hex");
        const duplicate = this.db
          .prepare(
            "SELECT * FROM operations WHERE design_id=? AND command_id=?",
          )
          .get(id, command.id) as OperationRow | undefined;
        if (duplicate) {
          if (duplicate.payload_hash !== hash)
            throw new HttpError(
              409,
              "This action identifier was already used for a different change.",
              "DUPLICATE_ID",
            );
          return JSON.parse(duplicate.result);
        }
        if (command.baseRevision > current.design.revision)
          throw new HttpError(
            409,
            "Refresh this design before applying the change.",
            "FUTURE_REVISION",
          );
        const expected = readDependencies(current.design.kind, command.changes);
        for (const key of expected)
          if (!Object.hasOwn(command.readSet, key))
            throw new HttpError(
              422,
              "The change is missing its original " + key + " measurement.",
              "MISSING_DEPENDENCY",
            );
        const conflicts = Object.keys(command.readSet).filter(
          (k) => current.design.params[k] !== command.readSet[k],
        );
        if (
          current.design.kind === "custom" &&
          command.baseRevision !== current.design.revision
        )
          conflicts.push("parts");
        if (conflicts.length)
          throw new HttpError(
            409,
            "The design changed while you were editing. Review the latest measurements and try again.",
            "CONFLICT",
            conflicts,
          );
        const next: Design = {
          ...current.design,
          params: { ...current.design.params, ...command.changes },
          revision: current.design.revision + 1,
          updatedAt: new Date().toISOString(),
          ...(command.customParts
            ? { customParts: structuredClone(command.customParts) }
            : {}),
        };
        validateDesign(next);
        const derived = deriveDesign(next);
        const before = Object.fromEntries(
          Object.keys(command.changes).map((k) => [
            k,
            current.design.params[k],
          ]),
        );
        const snapshot: Snapshot = {
          design: next,
          derived,
          history: [
            ...current.history,
            {
              id: command.id,
              actor: command.actor,
              revision: next.revision,
              summary:
                command.summary ||
                "Updated " + Object.keys(command.changes).join(", "),
              at: next.updatedAt,
              changes: command.changes,
              before,
            },
          ],
        };
        this.db
          .prepare("UPDATE designs SET snapshot=? WHERE id=?")
          .run(JSON.stringify(snapshot), id);
        this.db
          .prepare("INSERT INTO operations VALUES(?,?,?,?,?,?)")
          .run(
            id,
            command.id,
            hash,
            JSON.stringify(snapshot),
            JSON.stringify(current),
            serialized,
          );
        return snapshot;
      })
      .immediate();
  }
  undo(id: string, actor: string, operationId: string, commandId: string) {
    return this.db
      .transaction(() => {
        const duplicate = this.db
          .prepare(
            "SELECT * FROM operations WHERE design_id=? AND command_id=?",
          )
          .get(id, commandId) as OperationRow | undefined;
        if (duplicate) {
          const previous = JSON.parse(duplicate.command) as Command;
          if (previous.undoOf !== operationId || previous.actor !== actor)
            throw new HttpError(
              409,
              "This action identifier was already used for a different change.",
              "DUPLICATE_ID",
            );
          return JSON.parse(duplicate.result) as Snapshot;
        }
        const row = this.db
          .prepare(
            "SELECT * FROM operations WHERE design_id=? AND command_id=?",
          )
          .get(id, operationId) as OperationRow | undefined;
        if (!row)
          throw new HttpError(404, "The selected change was not found.");
        const original = JSON.parse(row.command) as Command;
        if (original.actor !== actor)
          throw new HttpError(403, "You can undo your own changes only.");
        const old = JSON.parse(row.before_snapshot) as Snapshot,
          result = JSON.parse(row.result) as Snapshot,
          current = this.get(id);
        const affected = new Set(
          readDependencies(current.design.kind, original.changes),
        );
        for (const h of current.history.filter(
          (h) => h.revision > result.design.revision,
        )) {
          if (Object.keys(h.changes).some((k) => affected.has(k)))
            throw new HttpError(
              409,
              "A later change depends on this edit. Make a new adjustment instead.",
              "UNDO_CONFLICT",
            );
        }
        if (
          original.customParts &&
          current.design.revision !== result.design.revision
        )
          throw new HttpError(
            409,
            "Parts changed after this operation. Review a new proposal instead.",
            "UNDO_CONFLICT",
          );
        return this.apply(id, {
          id: commandId,
          actor,
          baseRevision: current.design.revision,
          changes: Object.fromEntries(
            Object.keys(original.changes).map((k) => [k, old.design.params[k]]),
          ),
          readSet: Object.fromEntries(
            [...affected].map((k) => [k, current.design.params[k]]),
          ),
          ...(original.customParts
            ? { customParts: old.design.customParts }
            : {}),
          summary: "Undo: " + (original.summary || "design change"),
          undoOf: operationId,
        });
      })
      .immediate();
  }
  setBuild(job: BuildJob, archive?: string) {
    this.db
      .prepare(
        "INSERT INTO builds VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET job=excluded.job,archive=COALESCE(excluded.archive,builds.archive)",
      )
      .run(job.id, job.designId, JSON.stringify(job), archive || null);
  }
  getBuild(id: string): { job: BuildJob; archive: string | null } {
    const r = this.db
      .prepare("SELECT job,archive FROM builds WHERE id=?")
      .get(id) as { job: string; archive: string | null } | undefined;
    if (!r) throw new HttpError(404, "Build package not found.");
    return { job: JSON.parse(r.job), archive: r.archive };
  }
  reserveAi(id: string) {
    this.db
      .transaction(() => {
        const used = this.db
          .prepare(
            "SELECT COALESCE(SUM(spent+reserved),0) AS total FROM ai_usage",
          )
          .get() as { total: number };
        if (used.total + 1 > 50)
          throw new HttpError(
            429,
            "The configured AI spending limit has been reached. Manual editing remains available.",
            "BUDGET_LIMIT",
          );
        this.db
          .prepare("INSERT INTO ai_usage VALUES(?,?,?,1,0,0,0)")
          .run(id, new Date().toISOString(), "reserved");
      })
      .immediate();
  }
  recordAi(id: string, input: unknown, output: unknown, status = "complete") {
    if (
      typeof input !== "number" ||
      typeof output !== "number" ||
      !Number.isSafeInteger(input) ||
      !Number.isSafeInteger(output) ||
      input < 0 ||
      output < 0
    ) {
      this.db
        .prepare("UPDATE ai_usage SET status='unpriced' WHERE id=?")
        .run(id);
      return;
    }
    const spent = (input * 0.75) / 1e6 + (output * 4.5) / 1e6;
    this.db
      .prepare(
        "UPDATE ai_usage SET reserved=0,spent=?,input_tokens=?,output_tokens=?,status=? WHERE id=?",
      )
      .run(spent, input, output, status, id);
  }
  failAi(id: string, possiblyCharged: boolean) {
    this.db
      .prepare("UPDATE ai_usage SET status=?,reserved=?,spent=? WHERE id=?")
      .run("failed", possiblyCharged ? 1 : 0, 0, id);
  }
  close() {
    this.db.close();
  }
}
function validateCommand(c: Command, d: Design) {
  if (
    !c ||
    typeof c !== "object" ||
    typeof c.id !== "string" ||
    c.id.length < 1 ||
    c.id.length > 100 ||
    typeof c.actor !== "string" ||
    !c.actor.trim() ||
    c.actor.length > 80 ||
    !Number.isInteger(c.baseRevision) ||
    c.baseRevision < 0
  )
    throw new HttpError(
      422,
      "The edit has an invalid action, author or revision.",
    );
  if (
    !c.changes ||
    Array.isArray(c.changes) ||
    typeof c.changes !== "object" ||
    !c.readSet ||
    typeof c.readSet !== "object" ||
    Array.isArray(c.readSet)
  )
    throw new HttpError(
      422,
      "Provide the changed measurements and their original values.",
    );
  if (!Object.keys(c.changes).length && !c.customParts)
    throw new HttpError(422, "Choose at least one change.");
  for (const [key, value] of Object.entries({ ...c.changes, ...c.readSet }))
    if (!Object.hasOwn(d.params, key) || !Number.isFinite(value))
      throw new HttpError(422, "Unknown or invalid measurement: " + key);
  if (c.customParts && d.kind !== "custom")
    throw new HttpError(422, "Use a new design to edit primitive parts.");
  if (
    c.summary !== undefined &&
    (typeof c.summary !== "string" || c.summary.length > 400)
  )
    throw new HttpError(422, "Keep the change summary under 400 characters.");
}
