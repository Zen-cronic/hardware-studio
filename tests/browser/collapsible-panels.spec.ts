import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

async function openDesign(page: Page, request: APIRequestContext) {
  const response = await request.post("/api/designs", {
    data: { kind: "turntable", name: "Adjustable turntable" },
  });
  expect(response.status()).toBe(201);
  const result = await response.json();
  await page.goto(`/studio/${result.snapshot.design.id}#token=${encodeURIComponent(result.access.editorToken)}`);
  await expect(page.locator(".scene-panel .model-canvas")).toHaveAttribute("data-ready", "true");
}
const toggle = (page: Page, side: "left" | "right", open = true) =>
  page.getByRole("button", { name: `${open ? "Collapse" : "Expand"} ${side} panel`, exact: true });
const sceneWidth = async (page: Page) => (await page.locator(".scene-panel").boundingBox())!.width;
async function settleCanvas(page: Page) {
  await expect.poll(() => page.locator(".scene-panel canvas").evaluate((canvas: HTMLCanvasElement) =>
    Math.abs(canvas.width - canvas.getBoundingClientRect().width * devicePixelRatio)),
  ).toBeLessThan(2);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const width of [1440, 900]) {
  test(`panels reclaim canvas space and preserve drafts at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openDesign(page, request);
    await page.getByTestId("design-prompt").fill("Add a wider base for the camera.");
    await page.getByTestId("param-diameter").fill("280");
    const initialWidth = await sceneWidth(page);
    await page.screenshot({ path: `.artifacts/panels-${width}-expanded.png` });
    await toggle(page, "left").focus();
    await page.keyboard.press("Enter");
    await expect(toggle(page, "left", false)).toHaveAttribute("aria-expanded", "false");
    await expect(toggle(page, "left", false)).toBeFocused();
    await expect(page.locator(".left-panel")).toBeHidden();
    expect(await sceneWidth(page)).toBeGreaterThan(initialWidth + 200);
    await toggle(page, "right").focus();
    await page.keyboard.press("Space");
    await expect(page.locator(".right-panel")).toBeHidden();
    expect(await sceneWidth(page)).toBeGreaterThan(initialWidth + 400);
    await settleCanvas(page);
    await page.screenshot({ path: `.artifacts/panels-${width}-collapsed.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await toggle(page, "left", false).click();
    await expect(page.getByTestId("design-prompt")).toHaveValue("Add a wider base for the camera.");
    await toggle(page, "right", false).click();
    await expect(page.getByTestId("param-diameter")).toHaveValue("280");
    await expect(toggle(page, "right")).toHaveAttribute("aria-expanded", "true");
    expect(await sceneWidth(page)).toBeCloseTo(initialWidth, 0);
  });
}

test("desktop collapse preferences do not hide mobile editing or shared notes", async ({ page, request }) => {
  await openDesign(page, request);
  await toggle(page, "left").click();
  await toggle(page, "right").click();
  for (const width of [375, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("group", { name: "Side panels" })).toBeHidden();
    await expect(page.getByTestId("param-diameter")).toBeVisible();
    await page.getByRole("button", { name: "Describe a change", exact: true }).click();
    await expect(page.getByTestId("design-prompt")).toBeVisible();
    await page.getByRole("button", { name: "Open shared notes", exact: true }).click();
    await expect(page.locator(".notes-drawer")).toBeVisible();
    await page.getByRole("button", { name: "Close shared notes", exact: true }).click();
    await page.getByRole("button", { name: "Dimensions", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.artifacts/panels-${width}-mobile.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator(".left-panel")).toBeHidden();
  await expect(page.locator(".right-panel")).toBeHidden();
  await toggle(page, "left", false).click();
  await toggle(page, "right", false).click();
  await expect(page.getByTestId("design-prompt")).toBeVisible();
  await expect(page.getByTestId("param-diameter")).toBeVisible();
});

test("assembly and build panels can be reopened after changing workspace tabs", async ({ page, request }) => {
  await openDesign(page, request);
  await toggle(page, "left").click();
  await toggle(page, "right").click();
  for (const name of ["Assemble", "Build"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.locator(".left-panel")).toBeHidden();
    await expect(page.locator(".right-panel")).toBeHidden();
    await toggle(page, "left", false).click();
    await toggle(page, "right", false).click();
    await expect(page.locator(".left-panel")).toBeVisible();
    await expect(page.locator(".right-panel")).toBeVisible();
    await toggle(page, "left").click();
    await toggle(page, "right").click();
  }
});
