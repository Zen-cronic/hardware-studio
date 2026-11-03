import { test, expect } from "@playwright/test";
test("retained holder preserves guided tilt and screw interfaces through edits, reload, motion and export", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await request.post("/api/designs", {
    data: { kind: "holder", name: "Guided adjustable work holder" },
  });
  expect(response.status()).toBe(201);
  const made = await response.json();
  expect(made.snapshot.design.mechanismVersion).toBe(2);
  expect(made.snapshot.derived.parts.length).toBeGreaterThan(30);
  await page.goto(
    `/studio/${made.snapshot.design.id}#token=${encodeURIComponent(made.access.editorToken)}`,
  );
  const canvas = page.locator(".scene-panel .model-canvas");
  await expect(canvas).toHaveAttribute("data-ready", "true");
  for (const [key, value] of Object.entries({
    jawWidth: 120,
    opening: 150,
    screwDiameter: 12,
    angle: 30,
  }))
    await page.getByTestId("param-" + key).fill(String(value));
  await page.getByTestId("apply-dimensions").click();
  await expect(
    page.getByText("Design updated. Parts and assembly now match."),
  ).toBeVisible();
  await page.reload();
  for (const [key, value] of Object.entries({
    jawWidth: 120,
    opening: 150,
    screwDiameter: 12,
    angle: 30,
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
    path: ".artifacts/holder-standard/desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Expand right panel", exact: true })
    .click();
  await page.getByRole("tab", { name: "Assemble", exact: true }).click();
  await page.screenshot({
    path: ".artifacts/holder-standard/assembly.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Build", exact: true }).click();
  await page.getByTestId("generate-build").click();
  await expect(
    page.getByRole("link", { name: "Download package" }),
  ).toBeVisible({ timeout: 90000 });
  const dl = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download package" }).click();
  await (await dl).saveAs(".artifacts/holder-standard/revision-1.zip");
  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.getByTestId("param-opening")).toHaveValue("150");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".artifacts/holder-standard/mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
