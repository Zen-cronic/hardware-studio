import { expect, type APIRequestContext, type Page } from "@playwright/test";
import * as THREE from "three";
import { droneParts } from "../../src/shared/drone";
import type { Part, Vec3 } from "../../src/shared/types";

// Shared steps for the voice companion specs: mocked browser speech in and out, the app's own
// framed camera re-created in the test, and pointing at a part-local point.
export const ARM = "arm-front-right";
export const ARM_TOP: Vec3[] = [[10, 2, 0], [20, 2, 3], [0, 2, -3], [25, 2, 0], [-5, 2, 3], [30, 2, -4]];

export async function mockSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__speech = []; w.__spoken = [];
    w.SpeechRecognition = class {
      continuous = false; interimResults = false; lang = ""; stopped = false;
      onstart?: () => void; onend?: () => void; onresult?: (e: any) => void; onspeechstart?: () => void; onerror?: (e: any) => void;
      constructor() { w.__speech.push(this); }
      start() { setTimeout(() => this.onstart?.(), 0); }
      stop() { this.stopped = true; setTimeout(() => this.onend?.(), 30); }
      abort() { setTimeout(() => this.onend?.(), 0); }
    };
    w.SpeechSynthesisUtterance = class { text: string; lang = ""; rate = 1; voice: any = null; onstart?: () => void; onend?: () => void; onerror?: () => void; constructor(text: string) { this.text = text; } };
    const synth = {
      speaking: false, pending: false, paused: false, cancel() { /* Mock. */ }, pause() { /* Mock. */ }, resume() { /* Mock. */ },
      getVoices: () => [], addEventListener() { /* Mock. */ }, removeEventListener() { /* Mock. */ },
      speak(u: any) { w.__spoken.push(u.text); setTimeout(() => { u.onstart?.(); setTimeout(() => u.onend?.(), 300); }, 10); },
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  });
}
export async function openDesign(page: Page, request: APIRequestContext, parts: Part[] = droneParts(), name = "Camera drone", still = false) {
  await mockSpeech(page);
  const response = await request.post("/api/designs", { data: { kind: "custom", name, customParts: parts } });
  expect(response.status()).toBe(201);
  const created = await response.json();
  await page.goto(`/studio/${created.snapshot.design.id}${still ? "?still=1" : ""}#token=${encodeURIComponent(created.access.editorToken)}`);
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-ready", "true");
  await settle(page);
  return created;
}
export async function open(page: Page, request: APIRequestContext, still = false) {
  return openDesign(page, request, droneParts(), "Camera drone", still);
}
export async function settle(page: Page) {
  const canvas = page.locator(".model-canvas canvas");
  let last = "";
  for (let i = 0; i < 20; i++) {
    const view = `${await canvas.getAttribute("data-view")}|${JSON.stringify(await canvas.boundingBox())}`;
    if (view === last && view.startsWith("{")) return;
    last = view; await page.waitForTimeout(200);
  }
}
// The test's own projection through the app's framed camera, independent of the app's helper.
export async function camera(page: Page) {
  const canvas = page.locator(".model-canvas canvas"), box = (await canvas.boundingBox())!;
  const view = JSON.parse((await canvas.getAttribute("data-view"))!);
  const cam = new THREE.PerspectiveCamera(35, box.width / box.height, 0.1, 20000);
  cam.position.fromArray(view.position); cam.lookAt(new THREE.Vector3(...view.target)); cam.updateMatrixWorld();
  const toScreen = (world: THREE.Vector3) => { const n = world.clone().project(cam); return { x: box.x + (n.x + 1) / 2 * box.width, y: box.y + (1 - n.y) / 2 * box.height }; };
  return { toScreen };
}
export const world = (part: Part, local: Vec3) => new THREE.Vector3(...local).applyEuler(new THREE.Euler(...(part.rotation || [0, 0, 0]))).add(new THREE.Vector3(...part.position));
export async function pointAt(page: Page, partId: string, featureId: string, candidates: Vec3[], parts: Part[] = droneParts()) {
  await settle(page);
  const part = parts.find(p => p.id === partId)!, { toScreen } = await camera(page);
  for (const local of candidates) {
    const point = toScreen(world(part, local));
    await page.mouse.move(point.x, point.y, { steps: 4 });
    try { await expect(page.locator(".model-canvas")).toHaveAttribute("data-hovered-surface", `${partId}:${featureId}`, { timeout: 600 }); return point; } catch { /* Next visible point. */ }
  }
  throw new Error(`No visible point resolved to ${partId}:${featureId}`);
}
export async function speak(page: Page, event: "speech" | "final", text = "") {
  await page.evaluate(({ event, text }) => {
    const r = (window as any).__speech.at(-1);
    if (event === "speech") r.onspeechstart?.();
    else { const result: any = [{ transcript: text }]; result.isFinal = true; r.onresult?.({ resultIndex: 0, results: [result] }); }
  }, { event, text });
}
/** Hold Space, optionally do something while listening, say the words, release. */
export async function say(page: Page, words: string, whileListening?: () => Promise<void>) {
  await page.keyboard.down("Space");
  await expect(page.getByTestId("agent-dock")).toHaveAttribute("data-phase", "listening");
  await whileListening?.();
  await speak(page, "speech"); await speak(page, "final", words);
  await page.keyboard.up("Space");
}
export const spoken = (page: Page) => page.evaluate(() => (window as any).__spoken as string[]);
