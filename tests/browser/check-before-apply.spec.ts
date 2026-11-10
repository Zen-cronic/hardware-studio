import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { deskArmParts } from "../../src/shared/desk-arm";
import type { Vec3 } from "../../src/shared/types";
import { ARM, ARM_TOP, openDesign, pointAt, say, spoken } from "./voice-tools";

// Spoken demo lines that stay local, then a matched check before applying. Real strength studies run.
const evidence = process.env.COMPANION_EVIDENCE;
const UPPER_TOP: Vec3[] = [[-28, 2, 7], [-30, 2, -7], [-25, 2, 0], [-20, 2, 8], [-35, 2, 8], [10, 2, 6], [0, 2, -6]];
const HOLE_RIM: Vec3[] = [[-45, 2, 4.4], [-45, 2, 4.8], [-45 + 4.2, 2, 2], [-45 - 4.2, 2, 2], [-45, 2, -4.4]];
test.setTimeout(240000);

async function checkAndApply(page: Page, name: string, improved = true) {
  const proposal = page.getByRole("region", { name: "Proposed change" });
  await proposal.getByTestId("check-proposal").click();
  const result = proposal.getByTestId("check-result");
  await expect(result).toBeVisible({ timeout: 180000 });
  if (improved) {
    await expect(result).toHaveAttribute("data-verdict", "improved");
    await expect(result).toContainText("Improved under the same conditions");
  } else await expect(result).toHaveAttribute("data-verdict", /^(improved|worse|mixed|unchanged|preliminary)$/);
  const sentence = (await result.locator(".check-sentence").textContent())!;
  await result.getByText("How we checked", { exact: true }).click();
  const numbers = await result.locator(".check-numbers").innerText();
  const change = sentence.match(/bends \d+% (less|more)/)![0];
  await expect.poll(async () => (await spoken(page)).join(" ")).toContain(change);
  if (evidence) { await page.screenshot({ path: `${evidence}/${name}.png` }); writeFileSync(`${evidence}/${name}.txt`, sentence + "\n" + numbers + "\n" + await result.locator("details p").first().innerText() + "\n"); }
  await page.getByTestId("apply-proposal").click();
  await expect(page.getByText("Design updated. Parts and assembly now match.")).toBeVisible({ timeout: 20000 });
  return sentence;
}

test("drone: 'these arms 6 mm thick' moves all four arms locally, is checked under motor thrust, then applied", async ({ page, request }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const proposals: any[] = [];
  page.on("response", async response => { if (response.url().endsWith("/propose")) proposals.push(await response.json()); });
  const created = await openDesign(page, request, undefined, "Camera drone", true);
  await pointAt(page, ARM, "face+y", ARM_TOP);
  await say(page, "Make these arms stiffer");
  await expect(page.getByTestId("proposal-target")).toHaveText("Applied to: 4 arms");
  await expect(page.getByRole("region", { name: "Proposed change" })).toContainText("All 4 arms go from 4 mm to 6 mm thick. A thicker arm bends less under the same load.");
  await expect.poll(() => spoken(page)).toContain("All 4 arms go from 4 millimetres to 6 millimetres thick.");
  await expect(page.locator('[data-companion="agent"]')).toHaveCount(4);
  await page.getByRole("button", { name: "Dismiss proposal", exact: true }).click();

  await pointAt(page, ARM, "face+y", ARM_TOP);
  await say(page, "make these arms 6 mm thick");
  await expect(page.getByTestId("proposal-target")).toHaveText("Applied to: 4 arms");
  expect(proposals.map(p => p.source)).toEqual(["local", "local"]);
  const sentence = await checkAndApply(page, "check-drone-arms");
  expect(sentence).toMatch(/^Under the same 1 kgf \(9\.8 N\) peak motor thrust, upward at the motor end, Arm, front right bends \d+% less \([\d.]+ mm to [\d.]+ mm\) and its typical stress drops \d+%\.$/);
  const after = await (await request.get(`/api/designs/${created.snapshot.design.id}`, { headers: { authorization: "Bearer " + created.access.editorToken } })).json();
  expect(after.design.revision).toBe(1);
  expect(after.derived.parts.filter((p: any) => /^arm-/.test(p.id)).map((p: any) => p.size[1])).toEqual([6, 6, 6, 6]);
  const versions = await (await request.get(`/api/designs/${created.snapshot.design.id}/proposed-versions`, { headers: { authorization: "Bearer " + created.access.editorToken } })).json();
  expect(versions[0].status).toBe("accepted");
  expect(errors).toEqual([]);
});

test("camera arm: 'make the hole 8 mm' asks which hole, 'this one' answers, checked under the 0.5 kg payload, then applied", async ({ page, request }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const proposals: any[] = [];
  page.on("response", async response => { if (response.url().endsWith("/propose")) proposals.push(await response.json()); });
  const parts = deskArmParts();
  const created = await openDesign(page, request, parts, "Articulated camera arm", true);
  await pointAt(page, "upper-arm", "face+y", UPPER_TOP, parts);
  await say(page, "make the hole 8 mm");
  const proposal = page.getByRole("region", { name: "Proposed change" });
  await expect(proposal).toContainText("Upper arm link has 2 holes.");
  await expect.poll(() => spoken(page)).toContain("Which hole?");
  await expect(page.locator('[data-companion="agent"]')).toHaveCount(2);
  if (evidence) await page.screenshot({ path: `${evidence}/arm-which-hole.png` });
  await say(page, "this one", async () => { await pointAt(page, "upper-arm", "hole-0", HOLE_RIM, parts); });
  await expect(page.getByTestId("proposal-target")).toHaveText("Applied to: Upper arm link, Ø6.4 mm hole 1");
  await expect(proposal).toContainText("hole 1 diameter → 8 mm");
  expect(proposals.map(p => p.source)).toEqual(["local", "local"]);
  // A wider hole near the fixed end may weaken the link; the card says so either way.
  const sentence = await checkAndApply(page, "check-arm-hole", false);
  expect(sentence).toMatch(/^Under the same 0\.5 kg camera payload \(4\.9 N\), downward at the free end, Upper arm link bends \d+% (less|more)/);
  const after = await (await request.get(`/api/designs/${created.snapshot.design.id}`, { headers: { authorization: "Bearer " + created.access.editorToken } })).json();
  expect(after.derived.parts.find((p: any) => p.id === "upper-arm").holes[0].diameter).toBe(8);
  expect(errors).toEqual([]);
});
