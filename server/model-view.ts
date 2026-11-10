import type { FastifyInstance, FastifyRequest } from "fastify";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { HttpError, type Store } from "./store";
import type { BuildJob } from "../src/shared/types";

// The built assembly as one GLB for in-room viewing: Y-up, metres, from the CAD package.
// Same capability rule as other design reads: an editor or view-only token.
const tokenOf = (r: FastifyRequest) => {
  const header = r.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : String((r.query as { token?: unknown })?.token || "");
};

export interface ModelFile { path: string; job: BuildJob; current: boolean }

/** The newest ready package's assembly.glb, preferring one built from the current revision. */
export function latestModel(store: Store, designId: string): ModelFile | null {
  const revision = store.get(designId).design.revision;
  const rows = store.db.prepare("SELECT job, archive FROM builds WHERE design_id=? ORDER BY rowid DESC").all(designId) as { job: string; archive: string | null }[];
  let fallback: ModelFile | null = null;
  for (const row of rows) {
    const job: BuildJob = JSON.parse(row.job);
    if (job.status !== "ready" || !row.archive) continue;
    const path = join(dirname(row.archive), "assembly.glb");
    if (!existsSync(path)) continue;
    if (job.revision === revision) return { path, job, current: true };
    fallback ??= { path, job, current: false };
  }
  return fallback;
}

export function registerModelRoutes(app: FastifyInstance, store: Store) {
  app.get("/api/designs/:id/model.glb", async (r, reply) => {
    const id = String((r.params as { id: string }).id);
    store.authorize(id, tokenOf(r));
    const model = latestModel(store, id);
    if (!model)
      throw new HttpError(409, "No 3D model is ready for this design yet. Open the design, choose Build, then Generate build package, and try again.", "MODEL_NOT_BUILT");
    return reply
      .header("Cache-Control", "private, no-store")
      .header("Content-Length", statSync(model.path).size)
      .header("X-Model-Revision", String(model.job.revision))
      .header("X-Model-Current", model.current ? "true" : "false")
      .type("model/gltf-binary")
      .send(createReadStream(model.path));
  });
}
