import { test, expect } from "@playwright/test";

test("standard slider keeps mounting and drive interfaces through edit, reload, motion and real export", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const r = await request.post("/api/designs", {
    data: { kind: "slider", name: "Standard-parts camera slider" },
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
  await page.getByTestId("param-travel").fill("725");
  await page.getByTestId("param-railSpacing").fill("130");
  await page.getByTestId("apply-dimensions").click();
  await expect(
    page.getByText("Design updated. Parts and assembly now match."),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("param-travel")).toHaveValue("725");
  await expect(page.getByTestId("param-railSpacing")).toHaveValue("130");
  await expect(page.locator(".scene-panel .model-canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page
    .getByRole("button", { name: "Collapse left panel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Collapse right panel", exact: true })
    .click();
  await page.screenshot({
    path: ".artifacts/slider-standard/desktop.png",
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
    path: ".artifacts/slider-standard/moving.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Expand right panel", exact: true })
    .click();
  await page.getByRole("tab", { name: "Build", exact: true }).click();
  await page.getByTestId("generate-build").click();
  await expect(
    page.getByRole("link", { name: "Download package" }),
  ).toBeVisible({ timeout: 90000 });
  const dl = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download package" }).click();
  await (await dl).saveAs(".artifacts/slider-standard/revision-1.zip");
  await page.screenshot({
    path: ".artifacts/slider-standard/build.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.getByTestId("param-travel")).toHaveValue("725");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".artifacts/slider-standard/mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
