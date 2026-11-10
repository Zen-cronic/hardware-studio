import { openDimensions, closePanels, studioTab } from './workspace-tools';
import { test, expect } from "@playwright/test";

test("standard conveyor keeps supported rollers, sensor and gate through edit, reload, motion and real export", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const r = await request.post("/api/designs", {
    data: { kind: "conveyor", name: "Standard-parts sorting conveyor" },
  });
  expect(r.status()).toBe(201);
  const saved = await r.json();
  expect(saved.snapshot.design.mechanismVersion).toBe(2);
  await page.goto(
    `/studio/${saved.snapshot.design.id}#token=${encodeURIComponent(saved.access.editorToken)}`,
  );
  await expect(page.locator(".scene-panel .model-canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  { await openDimensions(page); await page.getByTestId("param-length").fill("650"); }
  { await openDimensions(page); await page.getByTestId("param-beltWidth").fill("160"); }
  { await openDimensions(page); await page.getByTestId("param-sensorPosition").fill("250"); }
  await page.getByTestId("apply-dimensions").click();
  await expect(
    page.getByText("Design updated. Parts and assembly now match."),
  ).toBeVisible();
  await page.reload();
  { await openDimensions(page); await expect(page.getByTestId("param-length")).toHaveValue("650"); }
  { await openDimensions(page); await expect(page.getByTestId("param-beltWidth")).toHaveValue("160"); }
  await expect(page.locator(".scene-panel .model-canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await closePanels(page);
  await closePanels(page);
  await page.screenshot({
    path: ".artifacts/conveyor-standard/desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Run mechanism", exact: true })
    .click();
  await page.waitForTimeout(1800);
  await page
    .getByRole("button", { name: "Pause mechanism", exact: true })
    .click();
  await page.screenshot({
    path: ".artifacts/conveyor-standard/moving.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Expand right panel", exact: true })
    .click();
  await studioTab(page, "Build");
  await page.getByTestId("generate-build").click();
  await expect(
    page.getByRole("link", { name: "Download package" }),
  ).toBeVisible({ timeout: 90000 });
  const dl = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download package" }).click();
  await (await dl).saveAs(".artifacts/conveyor-standard/revision-1.zip");
  await page.screenshot({
    path: ".artifacts/conveyor-standard/build.png",
    fullPage: true,
  });
  await studioTab(page, "Design");
  await page.setViewportSize({ width: 375, height: 900 });
  { await openDimensions(page); await expect(page.getByTestId("param-length")).toHaveValue("650"); }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".artifacts/conveyor-standard/mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
