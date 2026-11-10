import { openDimensions, studioTab } from './workspace-tools';
import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("assembly practice preserves the native camera and rendered view; revision and reset still refit", async ({
  browser,
  request,
}) => {
  test.setTimeout(90000);
  const output = ".artifacts/orientation-render";
  await mkdir(output, { recursive: true });
  const made = await request.post("/api/designs", {
    data: { kind: "turntable", name: "Orientation practice" },
  });
  expect(made.status()).toBe(201);
  const { snapshot, access } = await made.json();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: output, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage(),
    video = page.video()!;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(
      `/studio/${snapshot.design.id}#token=${encodeURIComponent(access.editorToken)}`,
    );
    const view = page.locator(".scene-panel .model-canvas"),
      canvas = view.locator("canvas");
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    await expect(view).toHaveAttribute("data-ready", "true");
    await studioTab(page, "Assemble");
    await button("Toggle exploded assembly").click();
    await expect(page.locator(".left-panel")).toBeHidden();
    await button("Reset camera").click();
    const bounds = (await canvas.boundingBox())!;
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width / 2 + 70,
      bounds.y + bounds.height / 2 - 55,
      { steps: 12 },
    );
    await page.mouse.up();
    await page
      .locator(".step-parts button")
      .filter({ hasText: "Base plate" })
      .click();
    await button("Check selected part").scrollIntoViewIfNeeded();
    await expect(canvas).toHaveAttribute("data-view", /position/);
    const native = await canvas.getAttribute("data-view");
    await view.evaluate((el) => {
      const state = { loading: false };
      (window as any).__renderObservation = state;
      new MutationObserver((records) => {
        if (
          el.getAttribute("data-ready") !== "true" ||
          records.some(
            (r) => r.type === "attributes" && r.oldValue === "false",
          ) ||
          el.querySelector(".model-loading")
        )
          state.loading = true;
      }).observe(el, {
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ["data-ready"],
        childList: true,
        subtree: true,
      });
    });
    await page.screenshot({ path: `${output}/before.png` });
    await button("Turn part 90°").click();
    await button("Check selected part").click();
    await expect(
      page.getByText("The selected part is turned away", { exact: false }),
    ).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(canvas).toHaveAttribute("data-view", native!);
    expect(
      await page.evaluate(() => (window as any).__renderObservation.loading),
    ).toBe(false);
    await page.screenshot({ path: `${output}/rejected.png` });
    await button("Reset orientation").click();
    await button("Check selected part").click();
    await expect(
      page.getByText("its virtual orientation matches", { exact: false }),
    ).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(canvas).toHaveAttribute("data-view", native!);
    expect(
      await page.evaluate(() => (window as any).__renderObservation.loading),
    ).toBe(false);
    await page.screenshot({ path: `${output}/accepted.png` });
    const current = await request.get(`/api/designs/${snapshot.design.id}`, {
      headers: { Authorization: `Bearer ${access.editorToken}` },
    });
    expect(await current.json()).toEqual(snapshot);
    await button("Reset camera").click();
    await expect(canvas).not.toHaveAttribute("data-view", native!);
    await studioTab(page, "Design");
    await button("Expand left panel").click();
    await button("Reset camera").click();
    await canvas.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const beforeDimension = await canvas.getAttribute("data-view");
    { await openDimensions(page); await page.getByTestId("param-diameter").fill("350"); }
    await page.getByTestId("apply-dimensions").click();
    await expect(
      page.getByText("Design updated. Parts and assembly now match."),
    ).toBeVisible();
    await expect(canvas).not.toHaveAttribute("data-view", beforeDimension!);
    await page.setViewportSize({ width: 375, height: 900 });
    { await openDimensions(page); await expect(page.getByTestId("param-diameter")).toHaveValue("350"); }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `${output}/mobile.png` });
    await expect(view).toHaveAttribute("data-ready", "true");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await video.saveAs(`${output}/practice.webm`);
  }
});
