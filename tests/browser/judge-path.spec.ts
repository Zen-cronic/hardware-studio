import { expect, test } from "@playwright/test";
import { ARM, ARM_TOP, mockSpeech, pointAt, settle } from "./voice-tools";
import { openPrompt } from "./workspace-tools";

// The /judge page: one camera drone path, five steps in order, each naming a control the studio has.
const STEPS = [
  "Open the camera drone Drag to turn it around. Every part is real and editable.",
  "Describe a change Click the top of an arm, then type or say “make this arm 6 mm thick”. The change card shows “4 → 6 mm thick”. This works without any AI.",
  "Check that it still holds On the change card, press Check it before applying. The same strength test runs on the arm as it is and as proposed, under the same motor thrust. Then press Apply change.",
  "See it in your room Press See it in your room. The 3D model is made automatically; then scan the code to open the drone at real size on your phone.",
  "Get build files Press Get build files to download the CAD files, parts list and assembly steps for the accepted design. Prepare build files makes them if they are not ready yet.",
];
const evidence = process.env.COMPANION_EVIDENCE;

test("/judge is one drone path in five steps, with no turntable widget", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/judge");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("See what Make Anything does, in five steps.");
  const steps = page.locator(".judge-steps > div");
  await expect(steps).toHaveCount(5);
  for (const [i, text] of STEPS.entries()) await expect(steps.nth(i)).toHaveText(`${i + 1}${text}`);
  // The older turntable comparison is gone: no platter sizes, no turntable start, no 3D canvas on this page.
  await expect(page.getByTestId("guide-dimension-preview")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/wider platter|Platter diameter|220 mm|280 mm|turntable/i);
  await expect(page.getByRole("button", { name: /turntable/i })).toHaveCount(0);
  await expect(page.locator("main canvas")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start with the camera drone" })).toBeVisible();
  if (evidence) await page.screenshot({ path: `${evidence}/judge.png`, fullPage: true });
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "Or start from another design", exact: true }).click();
  await expect(page).toHaveURL(/\/browse$/);
  expect(errors).toEqual([]);
});

test("the /judge steps complete in order on a fresh camera drone, with no AI", async ({ page, request }) => {
  test.setTimeout(420000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const proposals: any[] = [];
  page.on("response", async response => { if (response.url().endsWith("/propose")) proposals.push(await response.json()); });
  await mockSpeech(page);
  await page.goto("/judge");

  // 1. Open the camera drone: a fresh, editable copy.
  await page.getByRole("button", { name: "Start with the camera drone" }).click();
  await expect(page).toHaveURL(/\/studio\//);
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-ready", "true");
  await settle(page);
  const id = decodeURIComponent(new URL(page.url()).pathname.split("/")[2]);
  const token = decodeURIComponent(new URL(page.url()).hash.replace(/^#token=/, ""));
  const auth = { authorization: `Bearer ${token}` };

  // 2. Describe a change: click the top of an arm, type the example, read the change card.
  const point = await pointAt(page, ARM, "face+y", ARM_TOP);
  await page.mouse.click(point.x, point.y);
  await openPrompt(page);
  await expect(page.getByTestId("request-target")).toHaveText("Pointing at: Arm, front right, top face");
  await page.getByTestId("design-prompt").fill("make this arm 6 mm thick");
  await page.getByTestId("propose-change").click();
  const card = page.getByRole("region", { name: "Proposed change" });
  await expect(card).toContainText("Arm, front right: 4 → 6 mm thick");
  expect(proposals.map(p => p.source)).toEqual(["local"]);

  // 3. Check that it still holds: the change card's own check, then Apply change.
  const check = card.getByTestId("check-proposal");
  await expect(check).toHaveText("Check it before applying");
  await check.click();
  const result = card.getByTestId("check-result");
  await expect(result).toBeVisible({ timeout: 180000 });
  await expect(result).toHaveAttribute("data-verdict", "improved");
  await expect(result.locator(".check-sentence")).toHaveText(/^Under the same 1 kgf \(9\.8 N\) peak motor thrust, upward at the motor end, Arm, front right bends \d+% less/);
  await page.getByTestId("apply-proposal").click();
  await expect(page.getByText("Design updated. Parts and assembly now match.")).toBeVisible({ timeout: 20000 });
  const applied = await (await request.get(`/api/designs/${id}`, { headers: auth })).json();
  expect(applied.design.revision).toBe(1);

  // 4. See it in your room: the model is made on opening; the code appears when it is ready.
  await page.getByTestId("see-in-room").click();
  const sheet = page.getByTestId("room-sheet");
  await expect(sheet.getByTestId("room-making")).toHaveText("Making the 3D model…");
  await expect(sheet.getByRole("img", { name: "Code to open this design in AR on a phone" })).toHaveCount(0);
  await expect(sheet.locator("model-viewer")).toHaveAttribute("src", /model\.glb/, { timeout: 120000 });
  await expect(sheet.getByRole("img", { name: "Code to open this design in AR on a phone" })).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(sheet).toContainText("Model from revision 1.");
  await sheet.getByRole("button", { name: "Close room view", exact: true }).click();

  // 5. Get build files: the files for the accepted revision are ready to download.
  await page.getByRole("button", { name: "Get build files", exact: true }).click();
  const panel = page.locator(".right-panel");
  await expect(panel.getByRole("heading", { name: "Build files", exact: true })).toBeVisible();
  await expect(page.getByTestId("generate-build")).toHaveText("Prepare build files");
  await expect(panel.getByText("Your files are ready.")).toBeVisible({ timeout: 30000 });
  await expect(panel.getByRole("link", { name: "Download package" })).toBeVisible();
  const latest = await (await request.get(`/api/designs/${id}/builds/latest`, { headers: auth })).json();
  expect(latest).toMatchObject({ status: "ready", revision: 1 });
  expect(proposals.every(p => p.source === "local")).toBe(true);
  expect(errors).toEqual([]);
});
