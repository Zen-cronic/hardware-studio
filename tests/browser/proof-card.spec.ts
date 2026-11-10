import { expect, test, type Locator, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../server/app";
import { PROPOSED_RESULT, SETUP, saveStudy, seedProof, studyRecord } from "../helpers/proof-fixture";
import { openLoadSetup, openMeshSetup } from "./workspace-tools";

test.use({ channel: "chrome" });
const PORT = Number(process.env.PROOF_CARD_PORT || 4311);
const ORIGIN = `http://127.0.0.1:${PORT}`;
// Optional extra copy of the screenshots for review outside the test output folder.
const shotsDir = process.env.PROOF_SHOTS_DIR;

async function isolate(page: Page) {
  const external: string[] = [];
  await page.context().route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === ORIGIN) return route.continue();
    external.push(url.origin); return route.abort();
  });
  await page.context().routeWebSocket("**/*", (socket) => { if (new URL(socket.url()).port === String(PORT)) socket.connectToServer(); else socket.close(); });
  return external;
}
async function shoot(target: Locator | Page, name: string, outputPath: (name: string) => string) {
  const path = outputPath(name);
  await target.screenshot({ path, ...("goto" in target ? { fullPage: true } : {}) });
  if (shotsDir) { mkdirSync(shotsDir, { recursive: true }); writeFileSync(join(shotsDir, name), readFileSync(path)); }
}
async function openVersion(page: Page, designId: string, token: string) {
  await page.goto(`${ORIGIN}/develop/${designId}#token=${token}`);
  await page.getByRole("button", { name: "Proposed versions", exact: true }).click();
  await page.getByRole("button", { name: "Thicker upper link / open", exact: true }).click();
  const card = page.getByRole("region", { name: "Before and after proof" });
  await expect(card.getByRole("status").first()).not.toHaveText(/Loading/);
  return card;
}

for (const [width, scheme] of [[1440, "light"], [375, "light"], [1440, "dark"], [375, "dark"]] as const)
  test(`before/after proof confirms matched conditions and binds the download to the accepted revision at ${width}px ${scheme}`, async ({ browser }, info) => {
    const dataDir = mkdtempSync(join(tmpdir(), "proof-card-browser-"));
    const { app, store } = await createApp({ dataDir, aiKey: "" });
    const f = seedProof(store);
    const mainId = f.owner.snapshot.design.id;
    // A package for the original r0 already exists before acceptance.
    store.setBuild({ id: "package-r0", designId: mainId, revision: 0, status: "ready", downloadUrl: "/api/builds/package-r0/download" });
    await app.listen({ host: "127.0.0.1", port: PORT });
    const context = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 1000 }, reducedMotion: "reduce", colorScheme: scheme });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    const external = await isolate(page);
    const tag = `${width}-${scheme}`;
    try {
      const card = await openVersion(page, mainId, f.owner.access.editorToken);
      const verdict = card.locator(".proof-verdict");
      await expect(verdict).toContainText("Improved under the same conditions");
      await expect(verdict).toContainText("maximum displacement −70.14% and 95th-percentile stress −50.85%");
      await expect(card.locator(".proof-checks")).toContainText("Same conditions");
      await expect(card.locator(".proof-checks")).toContainText("Not accepted yet");
      await expect(card.locator(".proof-checks")).toContainText("The current package is for main r0.");
      const table = card.getByRole("table", { name: "Measured results for Upper arm link" });
      await expect(table.getByRole("row", { name: /Mesh check/ })).toContainText("ConvergedConverged");
      const displacement = table.getByRole("row", { name: /Max displacement/ });
      await expect(displacement).toContainText("0.2538");
      await expect(displacement).toContainText("0.07579");
      await expect(displacement).toContainText("−70.14%");
      await expect(table.getByRole("row", { name: /95th-percentile stress/ })).toContainText("−50.85%");
      await card.getByText("Changed parts (1)", { exact: true }).click();
      await expect(card).toContainText("110 × 4 × 24 → 110 × 6 × 24 mm");
      await card.getByText("Test conditions", { exact: true }).click();
      await expect(card.locator(".proof-conditions")).toContainText("4.903 N toward local −Y on the +X end");
      await expect(card.locator(".proof-conditions [data-same=no]")).toHaveCount(0);
      await expect(card).toContainText("not an assembly certification");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await card.scrollIntoViewIfNeeded();
      await shoot(card, `proof-open-${tag}.png`, (n) => info.outputPath(n));
      if (width === 1440 && scheme === "light") await shoot(page, `proof-open-page-${tag}.png`, (n) => info.outputPath(n));

      await page.getByRole("button", { name: "Accept into main design", exact: true }).click();
      await expect(page.getByRole("button", { name: "Accept into main design", exact: true })).toHaveCount(0);
      const exportCheck = card.locator("[data-export]");
      await expect(exportCheck).toHaveAttribute("data-export", "older");
      await expect(exportCheck).toContainText("Export is for an older revision");
      await expect(exportCheck).toContainText("The latest package is for r0, before the accepted r1.");
      await expect(exportCheck.getByRole("link")).toHaveCount(0);
      await expect(verdict).toContainText("Improved under the same conditions");
      await shoot(card, `proof-accepted-older-export-${tag}.png`, (n) => info.outputPath(n));

      // A ready package for accepted r1, with its archive hash recorded.
      const archiveDir = join(dataDir, "builds", "package-r1", "package");
      mkdirSync(archiveDir, { recursive: true });
      const archive = join(archiveDir, "package.zip"), bytes = Buffer.from("accepted revision 1 package");
      writeFileSync(archive, bytes);
      const sha = createHash("sha256").update(bytes).digest("hex");
      store.setBuild({ id: "package-r1", designId: mainId, revision: 1, status: "ready", downloadUrl: "/api/builds/package-r1/download", archiveSha256: sha }, archive);
      await expect(exportCheck).toHaveAttribute("data-export", "matches", { timeout: 10000 });
      await expect(exportCheck).toContainText("Download matches accepted r1");
      await expect(exportCheck).toContainText(sha.slice(0, 16));
      const [download] = await Promise.all([page.waitForEvent("download"), exportCheck.getByRole("link", { name: "Download r1 package" }).click()]);
      expect(createHash("sha256").update(readFileSync(await download.path())).digest("hex")).toBe(sha);
      await card.scrollIntoViewIfNeeded();
      await shoot(card, `proof-accepted-matching-export-${tag}.png`, (n) => info.outputPath(n));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
    } finally { await context.close(); await app.close(); rmSync(dataDir, { recursive: true, force: true }); }
  });

for (const width of [1440, 375])
  test(`mismatched conditions and unconverged results stay visible at ${width}px`, async ({ browser }, info) => {
    const dataDir = mkdtempSync(join(tmpdir(), "proof-card-browser-"));
    const { app, store } = await createApp({ dataDir, aiKey: "" });
    const f = seedProof(store);
    // The newest proposed study used a heavier load and did not converge.
    store.db.prepare("DELETE FROM engineering_jobs WHERE id=?").run(f.after!.id);
    saveStudy(store, studyRecord(f.proposed, {
      setup: { ...structuredClone(SETUP), loads: [{ axis: "x", side: "max", forceN: [0, -9.80665, 0] }] },
      result: { ...structuredClone(PROPOSED_RESULT), status: "unconverged", maxDisplacementMm: 0.1516, convergence: { status: "unconverged", displacementRelativeChange: 0.031, p95StressRelativeChange: 0.08 } },
    }));
    await app.listen({ host: "127.0.0.1", port: PORT });
    const context = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    const external = await isolate(page);
    try {
      const card = await openVersion(page, f.owner.snapshot.design.id, f.owner.access.editorToken);
      await expect(card.locator(".proof-verdict")).toContainText("Not comparable: test conditions differ");
      await expect(card.locator(".proof-checks")).toContainText("Conditions differ");
      await expect(card.locator(".proof-checks")).toContainText("Different: Load.");
      const table = card.getByRole("table", { name: "Measured results for Upper arm link" });
      await expect(table.getByRole("row", { name: /Mesh check/ })).toContainText("Not converged");
      const displacement = table.getByRole("row", { name: /Max displacement/ });
      await expect(displacement).toContainText("0.2538");
      await expect(displacement).toContainText("0.1516");
      await expect(displacement).toContainText("Not comparable");
      await expect(displacement).not.toContainText("%");
      const conditions = card.locator(".proof-conditions");
      await expect(conditions).toBeVisible();
      await expect(conditions.locator("[data-same=no]")).toHaveCount(1);
      await expect(conditions).toContainText("Proposed: 9.807 N toward local −Y on the +X end");
      await expect(card.getByRole("button", { name: "Test the proposed design", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await card.scrollIntoViewIfNeeded();
      await shoot(card, `proof-mismatch-${width}.png`, (n) => info.outputPath(n));
      await card.getByRole("button", { name: "Test the proposed design", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/develop/${f.view.version.proposedDesignId}`));
      await expect(page.getByRole("heading", { name: "Test a component", exact: true })).toBeVisible();
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
    } finally { await context.close(); await app.close(); rmSync(dataDir, { recursive: true, force: true }); }
  });

for (const width of [1440, 375])
  test(`testing the proposed design starts from the original study's setup and compares without manual edits at ${width}px`, async ({ browser }, info) => {
    test.setTimeout(240000);
    const dataDir = mkdtempSync(join(tmpdir(), "proof-card-browser-"));
    const { app, store } = await createApp({ dataDir, aiKey: "" });
    const f = seedProof(store, undefined, { studies: false });
    const mainId = f.owner.snapshot.design.id, headers = { authorization: "Bearer " + f.owner.access.editorToken };
    await app.listen({ host: "127.0.0.1", port: PORT });
    const context = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    const external = await isolate(page);
    try {
      // The original study runs on the real solver with a 4 mm starting mesh.
      const submitted = await page.request.post(`${ORIGIN}/api/designs/${mainId}/studies`, { headers, data: { type: "strength", revision: 0, ...structuredClone(SETUP) } });
      expect(submitted.status()).toBe(202);
      const original = await submitted.json();
      await expect.poll(async () => (await (await page.request.get(`${ORIGIN}/api/studies/${original.id}`, { headers })).json()).result?.convergence?.status, { timeout: 120000 }).toBe("converged");
      let card = await openVersion(page, mainId, f.owner.access.editorToken);
      await expect(card.locator(".proof-verdict")).toContainText("Needs a proposed study");
      await card.getByRole("button", { name: "Test the proposed design", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/develop/${f.view.version.proposedDesignId}\\?part=upper-arm&proof=${f.view.version.id}`));
      const hint = page.locator(".setup-prefill");
      await expect(hint).toHaveText("Same setup as the original study on r0: material, fixed end, force and mesh. You can still change it.");
      await expect(page.getByRole("combobox", { name: "Component", exact: true })).toHaveValue("upper-arm");
      await openLoadSetup(page);
      await expect(page.getByRole("spinbutton", { name: "Test payload (kg)", exact: true })).toHaveValue("0.5");
      await expect(page.getByRole("combobox", { name: "Fixed end", exact: true })).toHaveValue("min");
      await expect(page.getByRole("combobox", { name: "Loaded end", exact: true })).toHaveValue("max");
      await expect(page.getByRole("combobox", { name: "Force direction", exact: true })).toHaveValue("-y");
      await openMeshSetup(page);
      const mesh = page.getByRole("spinbutton", { name: "Starting mesh size (mm)", exact: true });
      await expect(mesh).toHaveValue("4");
      await expect(page.getByRole("combobox", { name: "Mesh refinements", exact: true })).toHaveValue("2");
      // An edit stays possible and is called out, then the copied value is restored.
      await mesh.fill("8");
      await expect(hint).toHaveText("Changed from the original study on r0: Mesh settings. The before and after proof will show these as different conditions.");
      await mesh.fill("4");
      await expect(hint).toContainText("Same setup as the original study on r0");
      await hint.scrollIntoViewIfNeeded();
      await shoot(page.locator(".development-controls"), `natural-flow-prefilled-form-${width}.png`, (n) => info.outputPath(n));
      await page.getByRole("checkbox", { name: /I reviewed this component/ }).check();
      await page.getByRole("button", { name: "Run study", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Mesh convergence passed", exact: true })).toBeVisible({ timeout: 120000 });
      card = await openVersion(page, mainId, f.owner.access.editorToken);
      await expect(card.locator(".proof-verdict")).toContainText("Improved under the same conditions");
      await expect(card.locator(".proof-verdict")).toContainText("maximum displacement −70.14% and 95th-percentile stress −50.85%");
      await expect(card.locator(".proof-checks")).toContainText("Same conditions");
      await expect(card.getByRole("table", { name: "Measured results for Upper arm link" }).getByRole("row", { name: /Mesh check/ })).toContainText("ConvergedConverged");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await card.scrollIntoViewIfNeeded();
      await shoot(card, `natural-flow-proof-${width}.png`, (n) => info.outputPath(n));
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
    } finally { await context.close(); await app.close(); rmSync(dataDir, { recursive: true, force: true }); }
  });
