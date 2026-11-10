import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import * as THREE from "three";
import { deskArmParts } from "../../src/shared/desk-arm";
import { explodedParts } from "../../src/lib/explosion";
import type { Part, Vec3 } from "../../src/shared/types";
import { openPrompt } from "./workspace-tools";

const evidence = process.env.SURFACE_EVIDENCE;
const HOLE_RIM: Vec3[] = [[-45, 2, 4.4], [-45, 2, 4.8], [-45 + 4.2, 2, 2], [-45 - 4.2, 2, 2], [-45, 2, -4.4]];
const UPPER_TOP: Vec3[] = [[-28, 2, 7], [-30, 2, -7], [-25, 2, 0], [-20, 2, 8], [-35, 2, 8], [10, 2, 6], [0, 2, -6]];
const UPPER_END: Vec3[] = [[55, 0, 6], [55, 1, -6], [55, 0, 0], [55, -1, 9]];
const LOWER_TOP: Vec3[] = [[0, 2, 6], [-20, 2, 6], [20, 2, -6], [0, 2, 0], [-30, 2, 0]];

async function openArm(page: Page, request: APIRequestContext) {
  await page.addInitScript(() => {
    const w = window as any; w.__speech = [];
    w.SpeechRecognition = class { continuous = false; interimResults = false; onstart?: () => void; onend?: () => void; constructor() { w.__speech.push(this); } start() { this.onstart?.(); } stop() { this.onend?.(); } abort() { this.onend?.(); } };
  });
  const response = await request.post("/api/designs", { data: { kind: "custom", name: "Articulated camera arm", customParts: deskArmParts() } });
  expect(response.status()).toBe(201);
  const created = await response.json();
  await page.goto(`/studio/${created.snapshot.design.id}#token=${encodeURIComponent(created.access.editorToken)}`);
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-ready", "true");
  await settle(page);
  return created;
}
// Wait until the framing (and any panel transition) stops changing the camera.
async function settle(page: Page) {
  const canvas = page.locator(".model-canvas canvas");
  let last = "";
  for (let i = 0; i < 20; i++) {
    const view = `${await canvas.getAttribute("data-view")}|${JSON.stringify(await canvas.boundingBox())}`;
    if (view === last && view.startsWith("{")) return;
    last = view; await page.waitForTimeout(200);
  }
}
// Projects a part-local point through the app's own framed camera.
async function project(page: Page, part: Part, local: Vec3) {
  const canvas = page.locator(".model-canvas canvas"), box = (await canvas.boundingBox())!;
  const view = JSON.parse((await canvas.getAttribute("data-view"))!);
  const camera = new THREE.PerspectiveCamera(35, box.width / box.height, 0.1, 20000);
  camera.position.fromArray(view.position); camera.lookAt(new THREE.Vector3(...view.target)); camera.updateMatrixWorld();
  const ndc = new THREE.Vector3(...local).applyEuler(new THREE.Euler(...(part.rotation || [0, 0, 0]))).add(new THREE.Vector3(...part.position)).project(camera);
  return { x: box.x + (ndc.x + 1) / 2 * box.width, y: box.y + (1 - ndc.y) / 2 * box.height };
}
async function pointAt(page: Page, partId: string, featureId: string, candidates: Vec3[], exploded = false) {
  const part = explodedParts(deskArmParts(), exploded ? 1 : 0).find(p => p.id === partId)!;
  const model = page.locator(".model-canvas");
  for (const local of candidates) {
    const point = await project(page, part, local);
    await page.mouse.move(point.x, point.y);
    try { await expect(model).toHaveAttribute("data-hovered-surface", `${partId}:${featureId}`, { timeout: 600 }); return point; } catch { /* try the next visible point */ }
  }
  throw new Error(`No visible point resolved to ${partId}:${featureId}`);
}
async function emit(page: Page, event: "speech" | "final", text = "") {
  await page.evaluate(({ event, text }) => {
    const r = (window as any).__speech.at(-1);
    if (event === "speech") r.onspeechstart?.();
    else { const result: any = [{ transcript: text }]; result.isFinal = true; r.onresult?.({ results: [result] }); }
  }, { event, text });
}
async function capture(page: Page, name: string, around?: { x: number; y: number }) {
  if (!evidence) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${evidence}/${name}.png` });
  if (around) await page.screenshot({ path: `${evidence}/${name}-detail.png`, clip: { x: Math.max(0, around.x - 260), y: Math.max(0, around.y - 170), width: 520, height: 340 } });
}
// Pinning a part opens the left panel on its own; switch it to the request without racing that.
async function writeRequest(page: Page) {
  const tab = page.locator(".inspector-tabs").getByRole("button", { name: "Write a request", exact: true });
  await expect(tab).toBeVisible(); await tab.click();
  await expect(page.getByTestId("design-prompt")).toBeVisible();
}
function recordProposals(page: Page) {
  const sent: any[] = [];
  page.route("**/propose", async route => { sent.push(route.request().postDataJSON()); await route.continue(); });
  return sent;
}
async function partsOf(request: APIRequestContext, created: any) {
  const response = await request.get(`/api/designs/${created.snapshot.design.id}`, { headers: { Authorization: `Bearer ${created.access.editorToken}` } });
  return (await response.json()).design as { revision: number; customParts: Part[] };
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("hover names the exact hole, top face and end face, with highlight and live text", async ({ page, request }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await openArm(page, request);
    const label = page.locator('[data-surface-label="hover"]'), status = page.getByTestId("pointing-status");
    const hole = await pointAt(page, "upper-arm", "hole-0", HOLE_RIM);
    await expect(label).toHaveText("Upper arm link, Ø6.4 mm hole 1");
    await expect(status).toHaveText("Pointer over Upper arm link, Ø6.4 mm hole 1");
    await expect(page.locator(".part-selection")).toHaveCount(0);
    await capture(page, "hover-hole", hole);
    const top = await pointAt(page, "upper-arm", "face+y", UPPER_TOP);
    await expect(label).toHaveText("Upper arm link, top face");
    await capture(page, "hover-top-face", top);
    // The see-through payload envelope does not hide the link below it.
    await page.getByRole("button", { name: "Toggle exploded assembly" }).click(); await settle(page); await page.waitForTimeout(900);
    const end = await pointAt(page, "upper-arm", "face+x", UPPER_END, true);
    await expect(label).toHaveText("Upper arm link, +X end face");
    await expect(status).toHaveText("Pointer over Upper arm link, +X end face");
    await capture(page, "hover-end-face", end);
    await page.mouse.move(5, 5);
    await expect(page.locator(".model-canvas")).toHaveAttribute("data-hovered-surface", "");
    await expect(label).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("typed request: click pins the hole, chip binds it, review shows it, accept changes only that hole", async ({ page, request }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const created = await openArm(page, request), sent = recordProposals(page);
    const hole = await pointAt(page, "upper-arm", "hole-0", HOLE_RIM);
    await page.mouse.click(hole.x, hole.y);
    await expect(page.locator(".model-canvas")).toHaveAttribute("data-pointed-surface", "upper-arm:hole-0");
    await expect(page.getByTestId("pointed-feature")).toHaveText("Ø6.4 mm hole 1");
    await expect(page.getByTestId("pointing-status")).toHaveText("Pointing at Upper arm link, Ø6.4 mm hole 1");
    await writeRequest(page); await settle(page);
    const chip = page.getByTestId("request-target");
    await expect(chip).toHaveText("Pointing at: Upper arm link, Ø6.4 mm hole 1");
    // Moving across other parts on the way to the text box never retargets the pinned surface.
    await pointAt(page, "lower-arm", "hole-0", [[-50, 2, 4.4], [-50, 2, -4.4], [-50 + 4.2, 2, 0]]);
    await expect(chip).toHaveText("Pointing at: Upper arm link, Ø6.4 mm hole 1");
    await page.getByTestId("design-prompt").fill("make this hole 8 mm");
    await capture(page, "typed-chip", hole);
    await page.getByTestId("propose-change").click();
    const review = page.getByRole("region", { name: "Proposed change" });
    await expect(review).toBeVisible();
    expect(sent[0].selection).toMatchObject({ partIds: ["upper-arm"], source: "click", surface: { partId: "upper-arm", featureId: "hole-0" } });
    expect(sent[0].selection.surface.point).toHaveLength(3); expect(sent[0].selection.surface.normal).toHaveLength(3);
    await expect(review.getByTestId("proposal-target")).toHaveText("Applied to: Upper arm link, Ø6.4 mm hole 1");
    await expect(review).toContainText("hole 1 diameter → 8 mm");
    await expect(page.locator(".model-canvas")).toHaveAttribute("data-pointed-surface", "upper-arm:hole-0");
    await capture(page, "proposal-applied-to", hole);
    expect((await partsOf(request, created)).revision).toBe(0);
    await page.getByTestId("apply-proposal").click();
    await expect(page.locator(".design-title")).toContainText("Revision 1");
    const after = await partsOf(request, created), before = deskArmParts();
    expect(after.customParts.find(p => p.id === "upper-arm")!.holes).toEqual([{ x: -45, z: 0, diameter: 8 }, { x: 45, z: 0, diameter: 6.4 }]);
    expect({ ...after.customParts.find(p => p.id === "upper-arm")!, holes: [] }).toEqual({ ...before.find(p => p.id === "upper-arm")!, holes: [] });
    expect(after.customParts.filter(p => p.id !== "upper-arm")).toEqual(before.filter(p => p.id !== "upper-arm"));
    // The pin belonged to the old geometry; it is dropped rather than carried forward.
    await expect(page.locator(".model-canvas")).toHaveAttribute("data-pointed-surface", "");
    expect(errors).toEqual([]);
  });

  test("an assistant-style response is reviewed against the bound feature", async ({ page, request }) => {
    const created = await openArm(page, request); let sent: any;
    await page.route("**/propose", async route => {
      sent = route.request().postDataJSON();
      const customParts = deskArmParts().map(p => p.id === "upper-arm" ? { ...p, holes: [{ x: -45, z: 0, diameter: 8.4 }, p.holes![1]] } : p);
      await route.fulfill({ json: { source: "ai", explanation: "Hole 1 now clears an M8 bolt.", questions: [], command: { id: "mock-proposal", actor: "Maker", baseRevision: 0, changes: {}, readSet: created.snapshot.design.params, customParts, summary: "Widen hole" } } });
    });
    const hole = await pointAt(page, "upper-arm", "hole-0", HOLE_RIM);
    await page.mouse.click(hole.x, hole.y); await expect(page.getByTestId("pointed-feature")).toHaveText("Ø6.4 mm hole 1"); await writeRequest(page);
    await page.getByTestId("design-prompt").fill("widen this hole for an M8 bolt"); await page.getByTestId("propose-change").click();
    await expect(page.getByTestId("proposal-target")).toHaveText("Applied to: Upper arm link, Ø6.4 mm hole 1");
    expect(sent.selection.surface).toMatchObject({ partId: "upper-arm", featureId: "hole-0" });
    // The preview highlights the same feature on the proposed geometry.
    await expect(page.locator(".model-canvas")).toHaveAttribute("data-pointed-surface", "upper-arm:hole-0");
    await expect(page.locator('[data-surface-label="pinned"]')).toHaveText("Upper arm link, Ø8.4 mm hole 1");
  });

  test("clearing the chip keeps the part; a conflicting feature asks instead of guessing", async ({ page, request }) => {
    await openArm(page, request); const sent = recordProposals(page);
    const hole = await pointAt(page, "upper-arm", "hole-0", HOLE_RIM);
    await page.mouse.click(hole.x, hole.y); await expect(page.getByTestId("pointed-feature")).toHaveText("Ø6.4 mm hole 1"); await writeRequest(page);
    await page.getByTestId("design-prompt").fill("make hole 2 8 mm"); await page.getByTestId("propose-change").click();
    const review = page.getByRole("region", { name: "Proposed change" });
    await expect(review).toContainText("names hole 2"); await expect(page.getByTestId("apply-proposal")).toBeDisabled();
    await capture(page, "conflict-clarification");
    await page.getByRole("button", { name: "Dismiss proposal", exact: true }).click();
    await page.getByRole("button", { name: "Stop pointing at this surface", exact: true }).click();
    await expect(page.getByTestId("request-target")).toHaveText("Request for Upper arm link");
    await expect(page.locator(".model-canvas")).toHaveAttribute("data-pointed-surface", "");
    await expect(page.getByTestId("design-prompt")).toBeFocused();
    await page.getByTestId("propose-change").click(); await expect(review).toBeVisible();
    expect(sent[0].selection.surface.featureId).toBe("hole-0"); expect(sent[1].selection.surface).toBeUndefined(); expect(sent[1].selection.partIds).toEqual(["upper-arm"]);
  });

  test("keyboard cycles the selected part's features with the same binding", async ({ page, request }) => {
    await openArm(page, request);
    const list = page.getByLabel("Choose a part from the list", { exact: true });
    await list.focus(); await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Upper arm link", exact: true }).focus(); await page.keyboard.press("Enter");
    const feature = page.getByTestId("pointed-feature"), next = page.getByRole("button", { name: "Next feature", exact: true });
    await expect(feature).toHaveText("Whole part");
    await next.focus(); await page.keyboard.press("Enter"); await expect(feature).toHaveText("Ø6.4 mm hole 1");
    await page.keyboard.press("Enter"); await expect(feature).toHaveText("Ø6.4 mm hole 2");
    await expect(page.getByTestId("pointing-status")).toHaveText("Pointing at Upper arm link, Ø6.4 mm hole 2");
    await page.keyboard.press("Enter"); await expect(feature).toHaveText("+X end face");
    await page.getByRole("button", { name: "Previous feature", exact: true }).click(); await expect(feature).toHaveText("Ø6.4 mm hole 2");
    await expect(page.locator(".model-canvas")).toHaveAttribute("data-pointed-surface", "upper-arm:hole-1");
    await writeRequest(page); await expect(page.getByTestId("request-target")).toHaveText("Pointing at: Upper arm link, Ø6.4 mm hole 2");
  });

  test("SYNTHETIC: voice freezes the full surface at speech onset and binds the spoken request", async ({ page, request }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await openArm(page, request); const sent = recordProposals(page);
    await page.getByRole("button", { name: "Speak an instruction", exact: true }).click();
    const hole = await pointAt(page, "upper-arm", "hole-0", HOLE_RIM);
    await emit(page, "speech");
    await expect(page.getByTestId("voice-status")).toHaveText("Listening about Upper arm link, Ø6.4 mm hole 1.");
    await pointAt(page, "upper-arm", "face+y", UPPER_TOP);
    await expect(page.getByTestId("voice-status")).toHaveText("Listening about Upper arm link, Ø6.4 mm hole 1.");
    await expect(page.locator('[data-surface-label="pinned"]')).toHaveText("Upper arm link, Ø6.4 mm hole 1");
    await expect(page.locator('[data-surface-label="hover"]')).toHaveCount(0);
    await capture(page, "voice-frozen", hole);
    await emit(page, "final", "make this hole 8 mm");
    await expect(page.getByTestId("proposal-target")).toHaveText("Applied to: Upper arm link, Ø6.4 mm hole 1");
    expect(sent[0].selection).toMatchObject({ source: "hover", partIds: ["upper-arm"], surface: { featureId: "hole-0" } });
    expect(errors).toEqual([]);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  test("tap pins a surface as the touch equivalent of hover", async ({ page, request }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await openArm(page, request);
    const part = deskArmParts().find(p => p.id === "lower-arm")!;
    let pinned = "";
    for (const local of LOWER_TOP) {
      const point = await project(page, part, local);
      await page.touchscreen.tap(point.x, point.y);
      pinned = await page.locator(".model-canvas").getAttribute("data-pointed-surface") || "";
      if (pinned === "lower-arm:face+y") break;
    }
    expect(pinned).toBe("lower-arm:face+y");
    await expect(page.locator('[data-surface-label="hover"]')).toHaveCount(0);
    await openPrompt(page);
    await expect(page.getByTestId("request-target")).toHaveText("Pointing at: Lower arm link, top face");
    await page.getByTestId("design-prompt").fill("make this 6 mm thick");
    await capture(page, "mobile-tap-chip");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByTestId("propose-change").click();
    await expect(page.getByTestId("proposal-target")).toHaveText("Applied to: Lower arm link, top face");
    await expect(page.getByRole("region", { name: "Proposed change" })).toContainText("local Y dimension → 6 mm");
    await capture(page, "mobile-proposal");
    expect(errors).toEqual([]);
  });
});
