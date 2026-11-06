import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createDesign, deriveDesign } from "../../src/shared/engine";
import { makeClipProject } from "../../src/lib/clip-timeline";
test("product film preview scrubs exact frames, keeps its position through polling and respects viewer capabilities", async ({ page }) => {
  const response = await page.request.post("/api/designs", { data: { kind: "turntable", name: "Orbit Desktop Turntable" } });
  expect(response.ok()).toBeTruthy();
  const { snapshot, access } = await response.json(), id = snapshot.design.id;
  await page.goto(`/develop/${id}#token=${access.editorToken}`);
  await page.getByRole("button", { name: "Product video", exact: true }).click();
  const range = page.getByRole("slider", { name: "Video frame" });
  await expect(page.getByRole("button", { name: "Create video from revision 0" })).toBeEnabled();
  await range.fill("225");
  await expect(page.locator("#clip-stage canvas")).toHaveAttribute("data-frame", "225");
  await expect(page.getByRole("heading", { name: "Explore every component", exact: true })).toBeVisible();
  await page.waitForTimeout(3300);
  await expect(range).toHaveValue("225");
  await page.getByRole("button", { name: "Play video preview", exact: true }).click();
  await expect.poll(async () => Number(await range.inputValue())).toBeGreaterThan(225);
  await page.getByRole("button", { name: "Pause video preview", exact: true }).click();
  await range.fill("225");
  mkdirSync(".artifacts/clip-export", { recursive: true });
  await page.screenshot({ path: ".artifacts/clip-export/workbench-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: ".artifacts/clip-export/workbench-mobile.png", fullPage: true });
  await page.goto(`/develop/${id}#token=${access.viewerToken}`);
  await page.getByRole("button", { name: "Product video", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create video from revision 0" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Play video preview", exact: true })).toBeEnabled();
});

test("render route reproduces frame pixels and renders the six example mechanisms", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto("/render-clip");
  await page.waitForFunction(() => typeof window.loadClipProject === "function");
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  mkdirSync(".artifacts/clip-export/examples", { recursive: true });
  const receipts = [];
  for (const kind of ["turntable", "slider", "conveyor", "lamp", "planter", "holder"] as const) {
    const design = createDesign(kind), project = makeClipProject({ design, derived: deriveDesign(design), history: [] }, "example-verification", { width: 640, height: 360, fps: 30, durationSeconds: 20 });
    await page.evaluate(project => window.loadClipProject!(project), project);
    for (const frame of [0, 225, 375, 599]) {
      const receipt = await page.evaluate(frame => window.setClipFrame!(frame), frame);
      expect(receipt.frame).toBe(frame);
      const png = await page.screenshot({ path: `.artifacts/clip-export/examples/${kind}-${frame}.png` });
      const hash = createHash("sha256").update(png).digest("hex");
      if (frame === 225) {
        await page.evaluate(() => window.setClipFrame!(226)); await page.evaluate(() => window.setClipFrame!(225));
        expect(createHash("sha256").update(await page.screenshot()).digest("hex")).toBe(hash);
      }
      receipts.push({ kind, frame, hash });
    }
  }
  expect(errors).toEqual([]);
  writeFileSync(".artifacts/clip-export/pixel-receipt.json", JSON.stringify(receipts, null, 2));
});
