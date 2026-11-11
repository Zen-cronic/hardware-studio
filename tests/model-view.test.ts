import { describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Box3, Matrix4, Quaternion, Vector3 } from "three";
import { createApp } from "../server/app";

/** World bounding box of a GLB from its node transforms and POSITION accessor bounds. */
export function glbBounds(bytes: Buffer) {
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
  const length = bytes.readUInt32LE(12);
  expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a); // "JSON"
  const gltf = JSON.parse(bytes.subarray(20, 20 + length).toString("utf8"));
  const box = new Box3();
  const visit = (index: number, parent: Matrix4) => {
    const node = gltf.nodes[index];
    const local = node.matrix ? new Matrix4().fromArray(node.matrix)
      : new Matrix4().compose(new Vector3(...(node.translation || [0, 0, 0])), new Quaternion(...(node.rotation || [0, 0, 0, 1])), new Vector3(...(node.scale || [1, 1, 1])));
    const world = parent.clone().multiply(local);
    if (node.mesh !== undefined) for (const primitive of gltf.meshes[node.mesh].primitives) {
      const accessor = gltf.accessors[primitive.attributes.POSITION];
      box.union(new Box3(new Vector3(...accessor.min), new Vector3(...accessor.max)).applyMatrix4(world));
    }
    for (const child of node.children || []) visit(child, world);
  };
  for (const root of gltf.scenes[gltf.scene ?? 0].nodes) visit(root, new Matrix4());
  return box;
}

describe("model for viewing in a room", () => {
  it("is capability protected, explains when nothing is built, and serves the assembly GLB in metres, Y up", async () => {
    // The CAD worker reports resolved paths; macOS temp folders sit behind a /private symlink.
    const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "model-view-")));
    const { app } = await createApp({ dataDir, aiKey: "" });
    try {
      const created = (await app.inject({ method: "POST", url: "/api/designs", payload: { kind: "custom", name: "Block", customParts: [
        { id: "block", name: "Block", shape: "box", size: [100, 20, 50], position: [0, 10, 0], color: "#A2C7FF", material: "PETG", process: "print" },
      ] } })).json();
      const id = created.snapshot.design.id, { editorToken, viewerToken } = created.access;
      const url = `/api/designs/${id}/model.glb`;
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(403);
      const missing = await app.inject({ method: "GET", url: url + "?token=" + viewerToken });
      expect(missing.statusCode).toBe(409);
      expect(missing.json()).toMatchObject({ code: "MODEL_NOT_BUILT", error: expect.stringContaining("press See it in your room") });
      // Only controls that exist in the studio are named.
      expect(missing.json().error).not.toMatch(/Generate build package|choose Build/);

      let job = (await app.inject({ method: "POST", url: `/api/designs/${id}/build`, headers: { authorization: "Bearer " + editorToken } })).json();
      for (let i = 0; i < 300 && ["queued", "running"].includes(job.status); i++) {
        await new Promise(r => setTimeout(r, 200));
        job = (await app.inject({ method: "GET", url: `/api/builds/${job.id}`, headers: { authorization: "Bearer " + editorToken } })).json();
      }
      expect(job.error ?? job.status).toBe("ready");

      const served = await app.inject({ method: "GET", url: url + "?token=" + viewerToken });
      expect(served.statusCode).toBe(200);
      expect(served.headers["content-type"]).toBe("model/gltf-binary");
      expect(served.headers["x-model-revision"]).toBe("0");
      expect(served.headers["x-model-current"]).toBe("true");
      const box = glbBounds(served.rawPayload), size = box.getSize(new Vector3());
      // 100 × 20 × 50 mm resting on the floor: metres, Y up, nothing rotated into Z-up.
      expect(size.x).toBeCloseTo(0.1, 4); expect(size.y).toBeCloseTo(0.02, 4); expect(size.z).toBeCloseTo(0.05, 4);
      expect(box.min.y).toBeCloseTo(0, 4);
      // HEAD answers from a file stat: the same headers, no body.
      const head = await app.inject({ method: "HEAD", url: url + "?token=" + viewerToken });
      expect(head.statusCode).toBe(200);
      expect(head.headers["x-model-current"]).toBe("true");
      expect(Number(head.headers["content-length"])).toBe(served.rawPayload.length);
      expect(head.rawPayload.length).toBe(0);
      expect((await app.inject({ method: "HEAD", url: url + "?token=not-a-token" })).statusCode).toBe(403);
      // After an edit the model is from an earlier revision.
      const snapshot = (await app.inject({ method: "GET", url: `/api/designs/${id}`, headers: { authorization: "Bearer " + editorToken } })).json();
      const edited = await app.inject({ method: "POST", url: `/api/designs/${id}/commands`, headers: { authorization: "Bearer " + editorToken }, payload: {
        id: "taller", actor: "Maker", baseRevision: 0, changes: {}, readSet: snapshot.design.params,
        customParts: [{ ...snapshot.design.customParts[0], size: [100, 30, 50] }] } });
      expect(edited.statusCode).toBe(200);
      const old = await app.inject({ method: "HEAD", url: url + "?token=" + viewerToken });
      expect(old.headers["x-model-current"]).toBe("false");
      expect(old.headers["x-model-revision"]).toBe("0");
      // The bearer header works too, and an unrelated token does not.
      expect((await app.inject({ method: "GET", url, headers: { authorization: "Bearer " + editorToken } })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: url + "?token=not-a-token" })).statusCode).toBe(403);
    } finally { await app.close(); rmSync(dataDir, { recursive: true, force: true }); }
  }, 90000);
});
