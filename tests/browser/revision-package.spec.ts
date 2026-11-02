import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
test("exports stay on their accepted revision while another edit is committed", async ({
  request,
}, info) => {
  test.setTimeout(90000);
  const made = await (
    await request.post("/api/designs", { data: { kind: "turntable" } })
  ).json();
  const d = made.snapshot.design,
    headers = { Authorization: "Bearer " + made.access.editorToken };
  const oldJob = await (
    await request.post("/api/designs/" + d.id + "/build", { headers, data: {} })
  ).json();
  const changed = await request.post("/api/designs/" + d.id + "/commands", {
    headers,
    data: {
      id: crypto.randomUUID(),
      actor: "Revision check",
      baseRevision: 0,
      changes: { diameter: 280 },
      readSet: { diameter: 220, shaftDiameter: 8 },
    },
  });
  expect(changed.status()).toBe(200);
  const newJob = await (
    await request.post("/api/designs/" + d.id + "/build", { headers, data: {} })
  ).json();
  for (const [job, revision, diameter] of [
    [oldJob, 0, 220],
    [newJob, 1, 280],
  ] as const) {
    await expect
      .poll(
        async () => {
          const body = await (
            await request.get("/api/builds/" + job.id, { headers })
          ).json();
          return body.status;
        },
        { timeout: 60000, intervals: [300, 600, 1200] },
      )
      .toBe("ready");
    const bytes = await (
      await request.get("/api/builds/" + job.id + "/download", { headers })
    ).body();
    const path = info.outputPath("revision-" + revision + ".zip");
    writeFileSync(path, bytes);
    const content = JSON.parse(
      execFileSync(
        "python3",
        [
          "-c",
          'import sys,json,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({"manifest":json.loads(z.read("manifest.json")),"snapshot":json.loads(z.read("design.json"))}))',
          path,
        ],
        { encoding: "utf8" },
      ),
    );
    expect(content.manifest.revision).toBe(revision);
    expect(content.snapshot.design.params.diameter).toBe(diameter);
  }
  const current = await (
    await request.get("/api/designs/" + d.id, { headers })
  ).json();
  expect(current.design.revision).toBe(1);
  expect(current.design.params.diameter).toBe(280);
});
