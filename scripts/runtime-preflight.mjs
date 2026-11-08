// Dependency smoke checks only. This does not certify hosting, full jobs or public access.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, rmSync, statfsSync } from "node:fs";
import { homedir, platform, arch, totalmem, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import Database from "better-sqlite3";

const exec = promisify(execFile);
const args = new Set(process.argv.slice(2));
if ([...args].some(arg => arg !== "--require-linux")) throw new Error("Only --require-linux is supported.");
process.umask(0o077);
const root = mkdtempSync(join(tmpdir(), "hardware-runtime-"));
const python = process.env.CAD_PYTHON || join(homedir(), ".pyenv/versions/.victoria-hardware/bin/python");
const checks = [];
let browser;
async function check(name, operation) {
  try { checks.push({ name, ok: true, evidence: await operation() }); }
  catch (error) { checks.push({ name, ok: false, error: error instanceof Error ? error.message.slice(0, 500) : "Check failed" }); }
}
async function pythonCheck(code) {
  const { stdout } = await exec(python, ["-c", code], { timeout: 90000, maxBuffer: 100000 });
  return JSON.parse(stdout.trim().split("\n").at(-1));
}
try {
  await check("node-major", () => {
    if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Node24 is required by the release runtime.");
    return { version: process.versions.node };
  });
  await check("platform", () => {
    if (args.has("--require-linux") && (platform() !== "linux" || arch() !== "x64")) throw new Error("Linux x86-64 rehearsal must run on that platform; this machine cannot establish it.");
    return { platform: platform(), arch: arch(), linuxX64: platform() === "linux" && arch() === "x64" };
  });
  await check("python-version", async () => {
    const value = await pythonCheck("import sys,json; print(json.dumps({'version':sys.version.split()[0],'supported':sys.version_info[:2]==(3,12)}))");
    if (!value.supported) throw new Error("Python3.12 is required by the locked runtime.");
    return value;
  });
  await check("sqlite-native", () => {
    const db = new Database(join(root, "probe.sqlite"));
    try {
      db.pragma("journal_mode = WAL"); db.exec("CREATE TABLE probe(value INTEGER); INSERT INTO probe VALUES(42)");
      if (db.prepare("SELECT value FROM probe").get().value !== 42) throw new Error("SQLite read/write failed.");
      return { version: db.prepare("SELECT sqlite_version() AS version").get().version, journal: db.pragma("journal_mode", { simple: true }) };
    } finally { db.close(); }
  });
  // OCC-backed native libraries stay in separate processes, as they do in the app workers.
  await check("cadquery-solid", () => pythonCheck("import cadquery as cq,json; solid=cq.Workplane('XY').box(1,2,3).val(); assert solid.isValid() and abs(solid.Volume()-6)<1e-8; print(json.dumps({'cadquery':cq.__version__,'validSolid':True,'volumeMm3':solid.Volume()}))"));
  await check("netgen-occ-import", () => pythonCheck("import netgen,netgen.occ,json; print(json.dumps({'netgen':netgen.__version__,'nativeOccImport':True}))"));
  await check("numerical-imports", () => pythonCheck("import skfem,scipy,trimesh,numpy,json; print(json.dumps({name:module.__version__ for name,module in [('skfem',skfem),('scipy',scipy),('trimesh',trimesh),('numpy',numpy)]}))"));
  await check("open3d-native", () => pythonCheck("import open3d as o,json; mesh=o.geometry.TriangleMesh.create_box(1,2,3); assert mesh.is_watertight(); print(json.dumps({'open3d':o.__version__,'watertight':True}))"));
  await check("rapier-native", async () => {
    const { default: rapier } = await import("@dimforge/rapier3d-compat");
    await rapier.init(); const world = new rapier.World({ x: 0, y: 0, z: 0 });
    try { world.step(); return { step: true }; } finally { world.free(); }
  });
  await check("browser-webgl-frame", async () => {
    browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-webgl", "--renderer-process-limit=2"] });
    const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
    await page.route("**/*", route => route.abort());
    await page.setContent('<body style="margin:0"><canvas width="320" height="180"></canvas></body>');
    const gl = await page.evaluate(() => {
      const canvas = document.querySelector("canvas"), context = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!context) return false;
      context.clearColor(0.08, 0.23, 0.48, 1); context.clear(context.COLOR_BUFFER_BIT); context.finish();
      const pixel = new Uint8Array(4); context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
      return pixel[2] > 100 && pixel[3] === 255;
    });
    if (!gl) throw new Error("Headless Chromium did not render a WebGL pixel.");
    await page.screenshot({ path: join(root, "frame.png") });
    return { version: browser.version(), webglPixelReadback: true, pngBytes: readFileSync(join(root, "frame.png")).length };
  });
  await check("h264-encode-probe", async () => {
    const { stdout: encoders } = await exec("ffmpeg", ["-hide_banner", "-encoders"], { timeout: 15000, maxBuffer: 200000 });
    if (!/\blibx264\b/.test(encoders)) throw new Error("FFmpeg must include the libx264 encoder.");
    await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", join(root, "frame.png"), "-frames:v", "1", "-r", "1", "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", join(root, "probe.mp4")], { timeout: 30000, maxBuffer: 100000 });
    const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height,nb_frames", "-of", "json", join(root, "probe.mp4")], { timeout: 15000, maxBuffer: 100000 });
    const result = JSON.parse(stdout).streams?.[0];
    if (result?.codec_name !== "h264" || result.width !== 320 || result.height !== 180 || Number(result.nb_frames) !== 1) throw new Error("Encoded browser frame failed ffprobe validation.");
    return result;
  });
  await check("built-app", () => {
    const html = readFileSync(resolve("dist/index.html"), "utf8");
    const notices = readFileSync(resolve("dist/THIRD_PARTY_NOTICES.txt"), "utf8");
    if (!html.includes("/assets/") || notices.length < 100) throw new Error("Build assets or notices are missing.");
    return { html: true, browserNotices: true };
  });
} finally {
  await browser?.close();
  const disk = statfsSync(root);
  const receipt = {
    scope: "dependency-preflight", ok: checks.every(item => item.ok), checkedAt: new Date().toISOString(),
    platform: platform(), arch: arch(), totalMemoryBytes: totalmem(), freeTemporaryDiskBytes: disk.bavail * disk.bsize,
    checks,
    limits: ["No provider request or existing application data was used.", "One browser WebGL frame was encoded, not a full application product clip.", "Native imports and one CAD solid do not prove full CAD/study/reconstruction workloads.", "Public HTTPS/WebSockets, persistent-volume capacity, peak job resources, restart and restore require separate evidence on the selected host."]
  };
  rmSync(root, { recursive: true, force: true });
  process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
  if (!receipt.ok) process.exitCode = 1;
}
