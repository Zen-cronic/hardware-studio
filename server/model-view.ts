import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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
  const design = store.db.prepare("SELECT json_extract(snapshot,'$.design.revision') AS revision FROM designs WHERE id=?").get(designId) as { revision: number } | undefined;
  if (!design) return null;
  // Only ready packages with files, newest first, read through the design index; each job is parsed only when used.
  const rows = store.db.prepare("SELECT job, archive, json_extract(job,'$.revision') AS revision FROM builds WHERE design_id=? AND archive IS NOT NULL AND json_extract(job,'$.status')='ready' ORDER BY rowid DESC")
    .iterate(designId) as Iterable<{ job: string; archive: string; revision: number }>;
  let fallback: { path: string; job: string } | null = null;
  for (const row of rows) {
    const path = join(dirname(row.archive), "assembly.glb");
    if (!existsSync(path)) continue;
    if (row.revision === design.revision) return { path, job: JSON.parse(row.job), current: true };
    fallback ??= { path, job: row.job };
  }
  return fallback ? { path: fallback.path, job: JSON.parse(fallback.job), current: false } : null;
}

export function registerModelRoutes(app: FastifyInstance, store: Store) {
  const model = (r: FastifyRequest) => {
    const id = String((r.params as { id: string }).id);
    store.authorize(id, tokenOf(r));
    const found = latestModel(store, id);
    if (!found)
      throw new HttpError(409, "No 3D model is ready for this design yet. Open the design on a computer and press See it in your room; the 3D model is made automatically. Then try again.", "MODEL_NOT_BUILT");
    return found;
  };
  const headers = (reply: FastifyReply, found: ModelFile) => reply
    .header("Cache-Control", "private, no-store")
    .header("Content-Length", statSync(found.path).size)
    .header("X-Model-Revision", String(found.job.revision))
    .header("X-Model-Current", found.current ? "true" : "false")
    .type("model/gltf-binary");
  // The room view asks whether a model exists and is current: a file stat, never the file itself.
  // Registered before GET so it replaces the automatic HEAD route.
  app.head("/api/designs/:id/model.glb", async (r, reply) => headers(reply, model(r)).send());
  app.get("/api/designs/:id/model.glb", async (r, reply) => {
    const found = model(r);
    return headers(reply, found).send(createReadStream(found.path));
  });
}
