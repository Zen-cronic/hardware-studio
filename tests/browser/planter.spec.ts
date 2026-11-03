import { test, expect } from "@playwright/test";
test("supported planter preserves cups, drainage and water path through edits, reload, motion and real export", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await request.post("/api/designs", {
    data: { kind: "planter", name: "Four-cup watering planter" },
  });
  expect(response.status()).toBe(201);
  const made = await response.json();
  expect(made.snapshot.design.mechanismVersion).toBe(2);
  expect(made.snapshot.derived.parts).toHaveLength(53);
  await page.goto(
    `/studio/${made.snapshot.design.id}#token=${encodeURIComponent(made.access.editorToken)}`,
  );
  const canvas = page.locator(".scene-panel .model-canvas");
  await expect(canvas).toHaveAttribute("data-ready", "true");
  for (const [key, value] of Object.entries({
    pots: 4,
    potDiameter: 110,
    reservoirHeight: 100,
    waterMinutes: 6,
  }))
    await page.getByTestId("param-" + key).fill(String(value));
  await page.getByTestId("apply-dimensions").click();
  await expect(
    page.getByText("Design updated. Parts and assembly now match."),
  ).toBeVisible();
  await page.reload();
  for (const [key, value] of Object.entries({
    pots: 4,
    potDiameter: 110,
    reservoirHeight: 100,
    waterMinutes: 6,
  }))
    await expect(page.getByTestId("param-" + key)).toHaveValue(String(value));
  await expect(canvas).toHaveAttribute("data-ready", "true");
  await page
    .getByRole("button", { name: "Collapse left panel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Collapse right panel", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Run mechanism|Pause mechanism/ })
    .click();
  await page.waitForTimeout(1000);
  await page
    .getByRole("button", { name: /Run mechanism|Pause mechanism/ })
    .click();
  await page.screenshot({
    path: ".artifacts/planter-standard/desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Expand right panel", exact: true })
    .click();
  await page.getByRole("tab", { name: "Assemble", exact: true }).click();
  await page.screenshot({
    path: ".artifacts/planter-standard/assembly.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Build", exact: true }).click();
  await page.getByTestId("generate-build").click();
  await expect(
    page.getByRole("link", { name: "Download package" }),
  ).toBeVisible({ timeout: 90000 });
  const dl = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download package" }).click();
  await (await dl).saveAs(".artifacts/planter-standard/revision-1.zip");
  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.getByTestId("param-pots")).toHaveValue("4");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".artifacts/planter-standard/mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
