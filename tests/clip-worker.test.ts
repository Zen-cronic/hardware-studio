import { test, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDesign, deriveDesign } from "../src/shared/engine";
import { canonicalClipSource, makeClipProject } from "../src/lib/clip-timeline";
const exec = promisify(execFile), script = resolve("scripts/render-clip.mjs");
test("isolated worker rejects a changed frozen source before launching the browser or encoder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clip-worker-")), input = join(dir, "project.json"), output = join(dir, "clip.mp4");
  try {
    const design = createDesign("turntable"), snapshot = { design, derived: deriveDesign(design), history: [] };
    const project = makeClipProject(snapshot, createHash("sha256").update(canonicalClipSource(snapshot)).digest("hex"));
    project.snapshot.derived.parts[0].size[0] += 1; writeFileSync(input, JSON.stringify(project));
    const error: any = await exec(process.execPath, [script, "--input", input, "--output", output, "--url", "http://127.0.0.1:4174/render-clip"]).then(() => null, error => error);
    expect(error?.code).toBe(1); expect(error.stdout).toContain("does not match its recorded hash"); expect(existsSync(output)).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("isolated worker refuses external URLs and URL-embedded secrets", async () => {
  for (const url of ["https://example.com/render-clip", "http://127.0.0.1:4174/render-clip?token=secret", "http://user:secret@localhost:4174/render-clip"]) {
    const error: any = await exec(process.execPath, [script, "--input", "/tmp/unused-project.json", "--output", "/tmp/unused-clip.mp4", "--url", url]).then(() => null, error => error);
    expect(error?.code).toBe(1); expect(error.stderr).toContain("requires the local render route");
  }
});
