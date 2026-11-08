import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../server/app";

// Exercise the built app and real admission responses without sharing a running
// developer's server, database, credentials, or collaboration service.
async function withApp(browser: Browser, width: number, rateLimited: boolean,
  run: (page: Page, store: Awaited<ReturnType<typeof createApp>>["store"]) => Promise<void>) {
  const dataDir = mkdtempSync(join(tmpdir(), "hardware-navigation-"));
  const { app, store } = await createApp({ dataDir, aiKey: "", designPolicy: {
    maxDesigns: 0, creationsPerWindow: rateLimited ? 1 : 0, windowSeconds: 4,
  } });
  const context = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 1000 }, reducedMotion: "reduce" });
  const errors: string[] = [], external: string[] = [];
  await app.listen({ host: "127.0.0.1", port: 4206 });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:4206") return route.continue();
    external.push(url.origin); return route.abort();
  });
  await context.routeWebSocket("**/*", socket => {
    if (new URL(socket.url()).port === "4206") socket.connectToServer();
    else socket.close(); // Notes synchronization is verified separately.
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  try {
    await run(page, store);
    expect(errors, "No unhandled errors during HTML label mount/unmount").toEqual([]);
    expect(external, "No external services used by navigation").toEqual([]);
  } finally {
    await context.close();
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}
test.use({ channel: "chrome" });
const origin = "http://127.0.0.1:4206";
async function preview(page: Page) {
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.locator(".dimension-tag")).toBeVisible();
  await expect(page.locator(".dimension-tag")).toHaveCount(1);
}
async function studio(page: Page, name: string) {
  await expect(page.locator(".design-title")).toContainText(name);
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.locator(".canvas-fallback")).toHaveCount(0);
}
async function capture(page: Page, info: TestInfo) {
  const path = info.outputPath("saved-studio.png");
  await page.screenshot({ path, fullPage: true });
  await info.attach("saved-studio", { path, contentType: "image/png" });
}
for (const width of [1440, 375]) {
  test(`new design saves and survives repeated back/forward at ${width}px`, async ({ browser }, info) => {
    await withApp(browser, width, false, async (page, store) => {
      await page.goto(origin + "/new"); await preview(page);
      const name = `Navigation prototype ${width}`;
      await page.getByLabel("Design name", { exact: true }).fill(name);
      await page.getByLabel("Width (mm)", { exact: true }).fill("160");
      await page.getByRole("button", { name: "Create design", exact: true }).click();
      await page.waitForURL("**/studio/**"); await studio(page, name);
      const id = new URL(page.url()).pathname.split("/")[2];
      const snapshot = JSON.stringify(store.get(id));
      for (let cycle = 0; cycle < 3; cycle++) {
        await page.goBack(); await preview(page);
        await page.goForward(); await studio(page, name);
        expect(JSON.stringify(store.get(id))).toBe(snapshot);
      }
      expect(store.db.prepare("SELECT COUNT(*) AS n FROM designs").get()).toEqual({ n: 1 });
      await capture(page, info);
    });
  });
  test(`real rate refusal retains draft and timed retry saves at ${width}px`, async ({ browser }, info) => {
    await withApp(browser, width, true, async (page, store) => {
      await page.goto(origin + "/new"); await preview(page);
      const name = `Retry prototype ${width}`;
      await page.getByLabel("Design name", { exact: true }).fill(name);
      await page.getByLabel("Width (mm)", { exact: true }).fill("160");
      store.create("holder", "Existing design");
      const response = page.waitForResponse(r => r.url().endsWith("/api/designs") && r.request().method() === "POST");
      await page.getByRole("button", { name: "Create design", exact: true }).click();
      const refusal = await response;
      expect(refusal.status()).toBe(429);
      expect((await refusal.json()).code).toBe("DESIGN_RATE_LIMIT");
      await expect(page.getByRole("alert")).toContainText("temporarily limited");
      await expect(page.getByLabel("Design name", { exact: true })).toHaveValue(name);
      await expect(page.getByLabel("Width (mm)", { exact: true })).toHaveValue("160");
      await preview(page);
      const retryAfter = Number(refusal.headers()["retry-after"]);
      expect(retryAfter).toBeGreaterThan(0);
      await page.waitForTimeout(retryAfter * 1000 + 100);
      await page.getByRole("button", { name: "Create design", exact: true }).click();
      await page.waitForURL("**/studio/**"); await studio(page, name);
      const id = new URL(page.url()).pathname.split("/")[2];
      expect(store.get(id).design.name).toBe(name);
      expect(store.db.prepare("SELECT COUNT(*) AS n FROM designs").get()).toEqual({ n: 2 });
      await capture(page, info);
    });
  });
  test(`landing, listing and saved Studio survive repeated navigation at ${width}px`, async ({ browser }, info) => {
    test.setTimeout(120_000);
    await withApp(browser, width, false, async (page, store) => {
      await page.goto(origin + "/");
      await expect(page.getByTestId("landing-scene")).toHaveAttribute("data-ready", "true");
      await page.getByTestId("landing-browse").click();
      await page.getByRole("button", { name: "Explore Motorized turntable", exact: true }).click();
      await page.waitForURL("**/designs/turntable");
      await expect(page.locator(".listing-stage .model-canvas")).toHaveAttribute("data-ready", "true");
      await page.getByTestId("customize-design").click();
      await page.waitForURL("**/studio/**"); await studio(page, "Motorized turntable");
      const id = new URL(page.url()).pathname.split("/")[2];
      const snapshot = JSON.stringify(store.get(id));
      for (let cycle = 0; cycle < 2; cycle++) {
        await page.goBack(); await expect(page.getByTestId("customize-design")).toBeVisible();
        await page.goBack(); await expect(page.getByTestId("product-turntable")).toBeVisible();
        await page.goBack(); await expect(page.getByTestId("landing-browse")).toBeVisible();
        await page.goForward(); await expect(page.getByTestId("product-turntable")).toBeVisible();
        await page.goForward(); await expect(page.getByTestId("customize-design")).toBeVisible();
        await page.goForward(); await studio(page, "Motorized turntable");
      }
      expect(JSON.stringify(store.get(id))).toBe(snapshot);
      expect(store.db.prepare("SELECT COUNT(*) AS n FROM designs").get()).toEqual({ n: 1 });
      await capture(page, info);
    });
  });
}
