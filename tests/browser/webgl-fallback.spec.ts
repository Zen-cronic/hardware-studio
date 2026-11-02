import { test, expect } from "@playwright/test";
test("disabled WebGL shows a readable fallback without a perpetual loading state", async ({
  browser,
  request,
}, info) => {
  const created = await request.post("/api/designs", {
    data: { kind: "turntable", name: "WebGL fallback verification" },
  });
  expect(created.status()).toBe(201);
  const r = await created.json();
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...args: unknown[]
    ) {
      if (
        kind === "webgl" ||
        kind === "webgl2" ||
        kind === "experimental-webgl"
      )
        return null;
      return (original as any).call(this, kind, ...args);
    } as typeof original;
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(
      "/studio/" +
        r.snapshot.design.id +
        "#token=" +
        encodeURIComponent(r.access.editorToken),
    );
    const model = page.locator(".scene-panel .model-canvas");
    await expect(model).toHaveAttribute("data-ready", "error");
    await expect(model).toHaveAttribute("aria-busy", "false");
    await expect(model.locator(".canvas-fallback")).toBeVisible();
    await expect(model.locator(".canvas-fallback")).toContainText(
      "Your dimensions, parts list and build files are still available.",
    );
    await expect(model.locator(".model-loading")).toHaveCount(0);
    await page.getByTestId("param-rpm").fill("4");
    await page.getByTestId("apply-dimensions").click();
    await expect(
      page.getByText("Design updated. Parts and assembly now match."),
    ).toBeVisible();
    await expect(model).toHaveAttribute("aria-busy", "false");
    await expect(model.locator(".model-loading")).toHaveCount(0);
    await page.getByRole("tab", { name: "Build", exact: true }).click();
    await expect(page.getByTestId("generate-build")).toBeEnabled();
    await expect(
      page.getByText("Parts list", { exact: false }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("webgl-unavailable.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
