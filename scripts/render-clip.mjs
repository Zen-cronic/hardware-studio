import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { readFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!["--input", "--output", "--url"].includes(process.argv[i]) || !process.argv[i + 1]) throw new Error("Expected input, output and local render URL.");
  args.set(process.argv[i], process.argv[i + 1]);
}
const input = resolve(args.get("--input") || ""), output = resolve(args.get("--output") || "");
const url = new URL(args.get("--url") || "http://invalid/");
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/render-clip" || url.search || url.hash || url.username || url.password || !output.endsWith(".mp4"))
  throw new Error("The video renderer requires the local render route and an MP4 output.");
let browser, encoder, aborted = false;
const temporary = output.replace(/\.mp4$/, ".partial.mp4");
const abort = () => { aborted = true; encoder?.kill("SIGTERM"); void browser?.close().catch(() => {}); };
process.on("SIGTERM", abort); process.on("SIGINT", abort);
const report = value => process.stdout.write(JSON.stringify(value) + "\n");
async function main() {
  if ((await stat(input)).size > 2_000_000) throw new Error("The frozen clip project is too large.");
  const project = JSON.parse(await readFile(input, "utf8")), { width, height, fps, durationSeconds } = project.format || {};
  const total = fps * durationSeconds;
  if (project.version !== 1 || !/^[a-f0-9]{64}$/.test(project.snapshotHash) || !Number.isInteger(width) || !Number.isInteger(height) ||
      width < 160 || width > 1920 || height < 90 || height > 1080 || width % 2 || height % 2 ||
      !Number.isInteger(fps) || fps < 1 || fps > 30 || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 20 || !Number.isInteger(total) || total < 1 || total > 600 ||
      !project.snapshot?.derived?.parts?.length || project.snapshot.derived.parts.length > 256)
    throw new Error("Unsupported frozen clip project.");
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
  const sourceHash = createHash("sha256").update(JSON.stringify(canonical({ design: project.snapshot.design, derived: project.snapshot.derived }))).digest("hex");
  if (sourceHash !== project.snapshotHash) throw new Error("The frozen design does not match its recorded hash.");
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-webgl", "--renderer-process-limit=2", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--js-flags=--max-old-space-size=512"] });
  if (aborted) throw new Error("Video export cancelled.");
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await context.route("**/*", route => {
    const requested = new URL(route.request().url());
    if (requested.origin === url.origin && route.request().method() === "GET") return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  let pageError;
  page.on("pageerror", error => { pageError ||= error.message; });
  await page.goto(url.href, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForFunction(() => typeof window.loadClipProject === "function" && typeof window.setClipFrame === "function", undefined, { timeout: 20000 });
  await page.evaluate(project => window.loadClipProject(project), project);
  if (pageError) throw new Error("The clip page failed: " + pageError);
  encoder = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-vcodec", "png", "-framerate", String(fps), "-i", "pipe:0", "-an", "-frames:v", String(total), "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", temporary], { stdio: ["pipe", "ignore", "pipe"] });
  let encoderError = "";
  encoder.stderr.on("data", chunk => { encoderError = (encoderError + chunk.toString()).slice(-3000); });
  encoder.stdin.on("error", () => {});
  const encoded = new Promise((resolve, reject) => {
    encoder.once("error", reject);
    encoder.once("close", code => code === 0 ? resolve() : reject(new Error(aborted ? "Video export cancelled." : "Video encoding failed. " + encoderError)));
  });
  // Attach a rejection handler immediately while frames are being produced.
  encoded.catch(() => {});
  for (let frame = 0; frame < total; frame++) {
    if (aborted) throw new Error("Video export cancelled.");
    const receipt = await page.evaluate(frame => window.setClipFrame(frame), frame);
    if (receipt.frame !== frame || receipt.snapshotHash !== project.snapshotHash || receipt.revision !== project.snapshot.design.revision)
      throw new Error("A video frame does not match its frozen design.");
    if (pageError) throw new Error("The clip page failed: " + pageError);
    const png = await page.screenshot({ type: "png", animations: "disabled", timeout: 20000 });
    await new Promise((resolve, reject) => encoder.stdin.write(png, error => error ? reject(error) : resolve()));
    if (frame % 30 === 0 || frame === total - 1) report({ type: "progress", frame: frame + 1, total });
  }
  encoder.stdin.end(); await encoded;
  if (aborted) throw new Error("Video export cancelled.");
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height,nb_frames,r_frame_rate:format=duration", "-of", "json", temporary], { maxBuffer: 100000 });
  const probe = JSON.parse(stdout), video = probe.streams?.find(stream => stream.codec_name === "h264");
  const rate = video?.r_frame_rate?.split("/").map(Number);
  if (!video || video.width !== width || video.height !== height || Number(video.nb_frames) !== total ||
      rate[0] / rate[1] !== fps || Math.abs(Number(probe.format.duration) - total / fps) > 1 / fps)
    throw new Error("Encoded video dimensions, duration or frame count do not match the timeline.");
  await rename(temporary, output);
  report({ type: "done", frames: total, width, height, fps, durationSeconds: total / fps, snapshotHash: project.snapshotHash });
}
try { await main(); }
catch (error) { report({ type: "error", message: error instanceof Error ? error.message : "Video export failed." }); process.exitCode = 1; }
finally {
  encoder?.kill("SIGTERM"); await browser?.close().catch(() => {});
  await rm(temporary, { force: true });
  process.off("SIGTERM", abort); process.off("SIGINT", abort);
}
