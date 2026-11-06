import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClipJobs, registerClipRoutes, type ClipRenderer } from "../server/clips";
import { Store, HttpError } from "../server/store";
import type { ClipJob } from "../src/lib/clip-timeline";
const flush = () => new Promise(resolve => setTimeout(resolve, 10));
async function fixture(queueLimit = 4) {
  const dir = mkdtempSync(join(tmpdir(), "hardware-clips-")), store = new Store(join(dir, "db.sqlite")), app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof HttpError ? error.status : 500).send({ error: error instanceof Error ? error.message : "Unknown failure" }));
  const pending: { input: Parameters<ClipRenderer>[0]; complete: () => void }[] = [];
  const renderer: ClipRenderer = input => new Promise((resolve, reject) => {
    pending.push({ input, complete: () => { writeFileSync(input.output, "scheduler-test-only"); resolve({ frames: 600, width: 1920, height: 1080, fps: 30, durationSeconds: 20, snapshotHash: input.project.snapshotHash }); } });
    input.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
  });
  const jobs = registerClipRoutes(app, { store, dataDir: dir, serverBaseUrl: "http://127.0.0.1:4174", renderer, queueLimit });
  const created = store.create("turntable"), id = created.snapshot.design.id;
  const headers = { authorization: "Bearer " + created.access.editorToken }, viewer = { authorization: "Bearer " + created.access.viewerToken };
  const submit = (revision = 0) => app.inject({ method: "POST", url: `/api/designs/${id}/clips`, headers, payload: { revision } });
  return { app, store, jobs, id, headers, viewer, pending, submit, dir, created,
    close: async () => { await jobs.close(); await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
describe("revision-bound video jobs", () => {
  it("checks capabilities, strict input and revision before queueing; freezes geometry and serves protected artifacts", async () => {
    const f = await fixture();
    try {
      expect((await f.app.inject({ method: "POST", url: `/api/designs/${f.id}/clips`, headers: f.viewer, payload: { revision: 0 } })).statusCode).toBe(403);
      expect((await f.submit(1)).statusCode).toBe(409);
      expect((await f.app.inject({ method: "POST", url: `/api/designs/${f.id}/clips`, headers: f.headers, payload: { revision: 0, url: "http://external.invalid" } })).statusCode).toBe(422);
      const response = await f.submit(), job: ClipJob = response.json(); expect(response.statusCode).toBe(202);
      expect(job.totalFrames).toBe(600); expect(job.snapshotHash).toMatch(/^[a-f0-9]{64}$/); await flush();
      expect((await f.submit()).json().id).toBe(job.id); expect(f.pending).toHaveLength(1);
      for (const suffix of ["", "/project", "/download"]) expect((await f.app.inject({ url: `/api/clips/${job.id}${suffix}` })).statusCode).toBe(403);
      expect((await f.app.inject({ method: "POST", url: `/api/clips/${job.id}/cancel`, headers: f.viewer, payload: {} })).statusCode).toBe(403);
      const current = f.store.get(f.id);
      f.store.apply(f.id, { id: "larger", actor: "Tester", baseRevision: 0, changes: { diameter: 280 }, readSet: current.design.params });
      const frozen = (await f.app.inject({ url: `/api/clips/${job.id}/project`, headers: f.viewer })).json();
      expect(frozen.snapshot.design.revision).toBe(0); expect(frozen.snapshot.design.params.diameter).toBe(current.design.params.diameter);
      expect(frozen.snapshot.role).toBeUndefined(); expect(frozen.snapshot.history).toEqual([]); expect(f.jobs.get(job.id).stale).toBe(true);
      expect((await f.app.inject({ url: `/api/clips/${job.id}/download`, headers: f.headers })).statusCode).toBe(409);
      f.pending[0].input.progress(300); expect(f.jobs.get(job.id).frame).toBe(300); f.pending[0].input.progress(100); expect(f.jobs.get(job.id).frame).toBe(300);
      f.pending[0].complete(); await flush(); expect(f.jobs.get(job.id).status).toBe("ready");
      const download = await f.app.inject({ url: `/api/clips/${job.id}/download`, headers: f.viewer });
      expect(download.statusCode).toBe(200); expect(download.headers["content-type"]).toContain("video/mp4");
      expect(f.store.get(f.id).design.revision).toBe(1);
    } finally { await f.close(); }
  });
  it("runs one worker at a time, bounds its queue and cancels queued/running work without mutating design", async () => {
    const f = await fixture(1);
    try {
      const first = (await f.submit()).json(); await flush();
      const secondDesign = f.store.create("slider"), thirdDesign = f.store.create("lamp");
      const second = f.jobs.submit(secondDesign.snapshot, { revision: 0 }); expect(second.status).toBe("queued");
      expect(() => f.jobs.submit(thirdDesign.snapshot, { revision: 0 })).toThrow("Several videos");
      f.jobs.cancel(second.id); expect(f.jobs.get(second.id).status).toBe("cancelled");
      const third = f.jobs.submit(thirdDesign.snapshot, { revision: 0 });
      f.jobs.cancel(first.id); await flush();
      expect(f.jobs.get(first.id).status).toBe("cancelled"); expect(f.pending[0].input.signal.aborted).toBe(true);
      expect(f.pending).toHaveLength(2); expect(f.jobs.get(third.id).status).toBe("running");
      f.pending[1].complete(); await flush(); expect(f.jobs.get(third.id).status).toBe("ready");
      expect(f.store.get(f.id).design.revision).toBe(0); expect(f.store.get(secondDesign.snapshot.design.id).design.revision).toBe(0);
      expect(f.jobs.cancel(first.id).status).toBe("cancelled");
    } finally { await f.close(); }
  });
  it("persists completed jobs and diagnoses interrupted jobs on restart", async () => {
    const f = await fixture();
    try {
      const first = (await f.submit()).json(); await flush(); f.pending[0].complete(); await flush();
      const another = f.store.create("lamp"), pending = f.jobs.submit(another.snapshot, { revision: 0 }); await flush();
      await f.jobs.close(); expect(f.jobs.get(pending.id).status).toBe("failed");
      const restored = new ClipJobs({ store: f.store, dataDir: f.dir, serverBaseUrl: "http://127.0.0.1:4174" });
      expect(restored.get(first.id).status).toBe("ready"); expect(restored.archive(first.id)).toContain("product.mp4");
      expect(restored.get(pending.id).error).toContain("interrupted"); await restored.close();
    } finally { await f.close(); }
  });
});
