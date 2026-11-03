import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { Plugin } from "vite";
import releaseNotices from "./browser-notice-overrides.json";
type ReleaseNotice = {name: string; version: string; file: string; sha256: string; source: string};

const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const slash = (value: string) => value.replaceAll("\\", "/");

export function dependencyRoot(id: string): string | undefined {
  const path = slash(id.replaceAll("\0", "").split("?")[0]);
  const marker = "/node_modules/";
  const at = path.lastIndexOf(marker);
  if (at < 0) return;
  const parts = path.slice(at + marker.length).split("/");
  const count = parts[0].startsWith("@") ? 2 : 1;
  return path.slice(0, at + marker.length) + parts.slice(0, count).join("/");
}

export async function collectBrowserNotices(root: string, moduleIds: string[], fallbacks: ReleaseNotice[] = releaseNotices) {
  const groups = new Map<string, Set<string>>();
  for (const id of moduleIds) {
    const packageRoot = dependencyRoot(id);
    if (!packageRoot) continue;
    const modules = groups.get(packageRoot) ?? new Set<string>();
    modules.add(id.replaceAll("\0", "").split("?")[0]);
    groups.set(packageRoot, modules);
  }
  const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  const sections: string[] = [];
  const packages = [];
  for (const [directory, modules] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const info = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const packagePath = slash(relative(root, directory));
    const locked = lock.packages[packagePath];
    if (!locked || info.version !== locked.version) throw new Error(`Unmatched browser dependency: ${info.name}`);
    const notices = [];
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !/^(licen[cs]e|copying|notice)([.\-_]|$)/i.test(entry.name)) continue;
      const bytes = await readFile(join(directory, entry.name));
      if (!bytes.toString("utf8").trim()) throw new Error(`Empty notice: ${info.name}/${entry.name}`);
      notices.push({ file: entry.name, sha256: hash(bytes) });
      sections.push(`===== ${info.name} ${info.version} — ${entry.name} =====\n${bytes.toString("utf8")}`);
    }
    if (!notices.length) {
      const fallback = fallbacks.find(row => row.name === info.name && row.version === info.version);
      if (!fallback) throw new Error(`Missing browser license notice: ${info.name}`);
      const bytes = await readFile(join(root, fallback.file));
      if (hash(bytes) !== fallback.sha256) throw new Error(`Upstream notice hash mismatch: ${info.name}`);
      notices.push({ file: fallback.file, sha256: fallback.sha256, source: fallback.source });
      sections.push(`===== ${info.name} ${info.version} — upstream release notice =====\nSource: ${fallback.source}\n${bytes.toString("utf8")}`);
    }
    // Keep source-level third-party notices as well as the package's own license.
    const inlineNotices = [];
    const seen = new Set<string>();
    for (const file of [...modules].sort()) {
      const code = await readFile(file, "utf8");
      for (const match of code.matchAll(/\/\*[\s\S]*?\*\//g)) {
        if (!/(copyright|@license|@preserve|permission is hereby granted)/i.test(match[0])) continue;
        const digest = hash(match[0]);
        if (seen.has(digest)) continue;
        seen.add(digest);
        const source = slash(relative(directory, file));
        inlineNotices.push({ source, sha256: digest });
        sections.push(`===== ${info.name} ${info.version} — ${source} (source notice) =====\n${match[0]}`);
      }
    }
    packages.push({ name: info.name, version: info.version, path: packagePath, license: locked.license ?? info.license ?? "See notice text", source: locked.resolved, notices, inlineNotices });
  }
  const fonts = [];
  for (const file of (await readdir(join(root, "public/fonts"))).filter(f => f.endsWith(".woff2")).sort()) {
    const family = file.split("-")[0];
    const licensePath = `fonts/licenses/${family}-OFL.txt`;
    const bytes = await readFile(join(root, "public", licensePath));
    if (!bytes.toString("utf8").includes("SIL OPEN FONT LICENSE")) throw new Error(`Missing OFL text for ${file}`);
    fonts.push({ file: `fonts/${file}`, sha256: hash(await readFile(join(root, "public/fonts", file))), notice: licensePath, noticeSha256: hash(bytes) });
    if (!sections.some(s => s.startsWith(`===== ${family} font —`))) sections.push(`===== ${family} font — ${licensePath} =====\n${bytes.toString("utf8")}`);
  }
  const text = "Hardware Studio — browser third-party notices\n\nThese notices accompany bundled dependencies and fonts. Source-level notices are retained where present. Package presence does not imply every feature is used. This file does not assign a license to original application code.\n\n" + sections.join("\n\n") + "\n";
  return { text, manifest: { schemaVersion: 1, scope: "Bundled JavaScript modules, imported CSS packages and vendored fonts; excludes server/CAD runtime", packages, fonts, noticesSha256: hash(text) } };
}

export function browserNotices(): Plugin {
  let root = "";
  return {
    name: "browser-third-party-notices",
    apply: "build",
    configResolved(config) { root = resolve(config.root); },
    async generateBundle(_options, bundle) {
      const ids = Object.values(bundle).flatMap(entry => entry.type === "chunk" ? Object.keys(entry.modules) : []);
      // CSS is emitted as a separate asset and may not appear in chunk.modules.
      ids.push(...[...this.getModuleIds()].filter(id => /\.css(?:\?|$)/.test(id)));
      const result = await collectBrowserNotices(root, [...new Set(ids)]);
      const emittedFonts = Object.values(bundle).flatMap(entry => entry.type === "asset" && /\.woff2?$/.test(entry.fileName) ? [{ file: entry.fileName, sha256: hash(entry.source) }] : []);
      const manifest = { ...result.manifest, emittedFonts };
      this.emitFile({ type: "asset", fileName: "THIRD_PARTY_NOTICES.txt", source: result.text });
      this.emitFile({ type: "asset", fileName: "third-party-browser.json", source: JSON.stringify(manifest, null, 2) + "\n" });
    },
  };
}
