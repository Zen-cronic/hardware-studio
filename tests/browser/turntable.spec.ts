import { test, expect } from "@playwright/test";

test("supported turntable keeps fixed interfaces through edit, motion and reload", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const result = await request.post("/api/designs", {
    data: { kind: "turntable", name: "Supported spindle turntable" },
  });
  expect(result.status()).toBe(201);
  const r = await result.json();
  expect(r.snapshot.design.mechanismVersion).toBe(2);
  await page.goto(
    `/studio/${r.snapshot.design.id}#token=${encodeURIComponent(r.access.editorToken)}`,
  );
  await expect(page.locator(".scene-panel .model-canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.getByTestId("param-shaftDiameter")).toBeDisabled();
  await expect(page.getByTestId("param-shaftDiameter")).toHaveValue("8");
  await expect(page.getByTestId("param-height")).toHaveValue("180");
  await page.getByTestId("param-height").fill("200");
  await page.getByTestId("apply-dimensions").click();
  await expect(
    page.getByText("Design updated. Parts and assembly now match."),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("param-height")).toHaveValue("200");
  await expect(page.locator(".scene-panel .model-canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.screenshot({
    path: ".artifacts/turntable-supported-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Run mechanism", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause mechanism", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pause mechanism", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Collapse left panel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Collapse right panel", exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator(".scene-panel canvas")
        .evaluate((c: HTMLCanvasElement) =>
          Math.abs(
            c.width - c.getBoundingClientRect().width * devicePixelRatio,
          ),
        ),
    )
    .toBeLessThan(2);
  await page.screenshot({
    path: ".artifacts/turntable-supported-expanded-canvas.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.getByTestId("param-shaftDiameter")).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".artifacts/turntable-supported-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
