import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { collectBrowserNotices, dependencyRoot } from "../scripts/browser-notices";
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "browser-notices-")); dirs.push(root);
  await mkdir(join(root, "node_modules/@sample/widget"), { recursive: true });
  await mkdir(join(root, "public/fonts/licenses"), { recursive: true });
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ packages: { "node_modules/@sample/widget": { version: "1.0.0", license: "MIT", resolved: "https://example.invalid/widget.tgz" } } }));
  await writeFile(join(root, "node_modules/@sample/widget/package.json"), JSON.stringify({ name: "@sample/widget", version: "1.0.0" }));
  const file = join(root, "node_modules/@sample/widget/index.js");
  await writeFile(file, "/*! Copyright Example; @license MIT */\nexport const value = 1;");
  return { root, file };
}
it("locates scoped and nested packages without exposing parent paths", () => {
  expect(dependencyRoot("/app/node_modules/outer/node_modules/@sample/widget/index.js?commonjs-proxy")).toBe("/app/node_modules/outer/node_modules/@sample/widget");
  expect(dependencyRoot("/app/src/App.tsx")).toBeUndefined();
});
it("fails on missing notice text rather than accepting license metadata alone", async () => {
  const { root, file } = await fixture();
  await expect(collectBrowserNotices(root, [file])).rejects.toThrow("Missing browser license notice");
});
it("preserves exact notice text, source notices and font hashes without filesystem paths", async () => {
  const { root, file } = await fixture();
  const notice = "MIT License\r\nCopyright Widget authors\r\n";
  await writeFile(join(root, "node_modules/@sample/widget/LICENSE"), notice);
  await writeFile(join(root, "public/fonts/demo-latin.woff2"), "font fixture");
  await writeFile(join(root, "public/fonts/licenses/demo-OFL.txt"), "SIL OPEN FONT LICENSE Version 1.1\nCopyright Font authors\n");
  const result = await collectBrowserNotices(root, [file, file]);
  expect(result.manifest.packages).toHaveLength(1);
  expect(result.text).toContain(notice);
  expect(result.text).toContain("/*! Copyright Example; @license MIT */");
  expect(result.manifest.packages[0].notices[0].sha256).toBe(createHash("sha256").update(notice).digest("hex"));
  expect(result.manifest.fonts[0].file).toBe("fonts/demo-latin.woff2");
  expect(JSON.stringify(result)).not.toContain(root);
  expect(await collectBrowserNotices(root, [file])).toEqual(result);
});
it("rejects a changed package version against the lockfile", async () => {
  const { root, file } = await fixture();
  await writeFile(join(root, "node_modules/@sample/widget/package.json"), JSON.stringify({ name: "@sample/widget", version: "2.0.0" }));
  await expect(collectBrowserNotices(root, [file])).rejects.toThrow("Unmatched browser dependency");
});

it("accepts only a version-pinned upstream fallback with matching notice bytes", async () => {
  const { root, file } = await fixture();
  const text = "MIT License\nCopyright Upstream authors\n";
  await writeFile(join(root, "release-LICENSE.txt"), text);
  const fallback = {name: "@sample/widget", version: "1.0.0", file: "release-LICENSE.txt", sha256: createHash("sha256").update(text).digest("hex"), source: "https://example.invalid/releases/1.0.0/LICENSE"};
  expect((await collectBrowserNotices(root, [file], [fallback])).text).toContain(text);
  await expect(collectBrowserNotices(root, [file], [{...fallback, version: "2.0.0"}])).rejects.toThrow("Missing browser license notice");
  await writeFile(join(root, "release-LICENSE.txt"), text + "changed");
  await expect(collectBrowserNotices(root, [file], [fallback])).rejects.toThrow("Upstream notice hash mismatch");
});
