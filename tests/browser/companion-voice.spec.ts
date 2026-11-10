import { expect, test, type Page } from "@playwright/test";
import { droneParts } from "../../src/shared/drone";
import { ARM, ARM_TOP, camera, open, pointAt, speak, world } from "./voice-tools";

// Hold-to-talk with the circle companion, against mocked browser speech in and out.
const evidence = process.env.COMPANION_EVIDENCE;

async function shot(page: Page, name: string) {
  if (evidence) await page.screenshot({ path: `${evidence}/${name}.png` });
}

test("hold Space over an arm, the target freezes at speech onset, the reply is spoken and the assistant circle lands on the arm", async ({ page, request }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await open(page, request);
  const userCircle = page.locator('[data-companion="user"]');
  await pointAt(page, ARM, "face+y", ARM_TOP);
  await expect(userCircle).toHaveClass(/is-shown/);
  await expect(userCircle.locator("[data-companion-label]")).toHaveText("Arm, front right, top face");
  await shot(page, "companion-hover");

  // Hold Space: listening starts, the speech-onset target freezes, later pointer moves do not retarget.
  await page.keyboard.down("Space");
  await expect(page.getByTestId("agent-dock")).toHaveAttribute("data-phase", "listening");
  await expect(userCircle).toHaveClass(/is-listening/);
  expect(await page.evaluate(() => (window as any).__speech.length)).toBe(1);
  await speak(page, "speech");
  await expect(page.getByTestId("voice-status")).toHaveText("Listening about Arm, front right, top face.");
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-pointed-surface", `${ARM}:face+y`);
  await shot(page, "companion-listening");
  const box = (await page.locator(".model-canvas canvas").boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + box.height - 30, { steps: 3 });
  await expect(page.getByTestId("voice-status")).toHaveText("Listening about Arm, front right, top face.");
  await speak(page, "final", "make this 6 mm thick");
  await page.keyboard.up("Space");
  expect(await page.evaluate(() => (window as any).__speech.at(-1).stopped)).toBe(true);

  // The proposal is bound to the frozen arm face and previews the 6 mm arm.
  const proposal = page.getByRole("region", { name: "Proposed change" });
  await expect(proposal).toBeVisible();
  await expect(page.getByTestId("proposal-target")).toHaveText("Applied to: Arm, front right, top face");
  await expect(proposal).toContainText("local Y dimension → 6 mm");

  // The assistant circle glides onto the arm and the reply is spoken in short sentences.
  const agent = page.locator('[data-companion="agent"]');
  await expect(agent).toHaveAttribute("data-agent-state", "arrived", { timeout: 4000 });
  await expect(agent).toHaveAttribute("data-agent-target", `${ARM}:face+y`);
  await page.waitForTimeout(150);
  const dot = (await agent.locator(".companion-dot").boundingBox())!;
  const centre = { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 };
  const thick = droneParts().find(p => p.id === ARM)!; thick.size = [thick.size[0], 6, thick.size[2]];
  const { toScreen } = await camera(page);
  const corners = [-1, 1].flatMap(sx => [-1, 1].flatMap(sy => [-1, 1].map(sz => toScreen(world(thick, [sx * thick.size[0] / 2, sy * 3, sz * thick.size[2] / 2])))));
  const rect = { left: Math.min(...corners.map(c => c.x)), right: Math.max(...corners.map(c => c.x)), top: Math.min(...corners.map(c => c.y)), bottom: Math.max(...corners.map(c => c.y)) };
  expect(centre.x).toBeGreaterThanOrEqual(rect.left - 3); expect(centre.x).toBeLessThanOrEqual(rect.right + 3);
  expect(centre.y).toBeGreaterThanOrEqual(rect.top - 3); expect(centre.y).toBeLessThanOrEqual(rect.bottom + 3);
  const spoken: string[] = await page.evaluate(() => (window as any).__spoken);
  expect(spoken[0]).toBe("Arm, front right: local Y dimension to 6 millimetres.");
  expect(spoken.length).toBeGreaterThan(1);
  expect(spoken.every(line => line.length <= 141)).toBe(true);
  await expect(page.getByTestId("agent-reply")).toContainText("local Y dimension to 6 millimetres");
  await shot(page, "companion-agent-landed");

  // Accepting keeps the existing flow; the assistant circle leaves with the proposal.
  await page.getByTestId("apply-proposal").click();
  await expect(page.getByText("Design updated. Parts and assembly now match.")).toBeVisible();
  await expect(agent).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Space stays with text fields and keyboard-focused controls; mute silences replies; the mic can be held", async ({ page, request }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await open(page, request, true);
  await page.getByRole("button", { name: "Expand left panel", exact: true }).click();
  const prompt = page.getByTestId("design-prompt");
  await prompt.click(); await page.keyboard.press("Space");
  await expect(prompt).toHaveValue(" ");
  expect(await page.evaluate(() => (window as any).__speech.length)).toBe(0);
  await prompt.fill("");
  const mute = page.getByRole("button", { name: "Mute spoken replies", exact: true });
  await mute.focus(); await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Turn spoken replies on", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => (window as any).__speech.length)).toBe(0);

  // Mic press-and-hold with a pinned arm face: the pinned target is used, and the muted reply stays silent.
  await pointAt(page, ARM, "face+y", ARM_TOP);
  await page.mouse.down(); await page.mouse.up();
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-pointed-surface", `${ARM}:face+y`);
  const mic = page.getByRole("button", { name: "Hold to talk", exact: true });
  const micBox = (await mic.boundingBox())!;
  await page.mouse.move(micBox.x + micBox.width / 2, micBox.y + micBox.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId("agent-dock")).toHaveAttribute("data-phase", "listening");
  await speak(page, "speech");
  await expect(page.getByTestId("voice-status")).toHaveText("Listening about Arm, front right, top face.");
  await speak(page, "final", "make this 5 mm thick");
  await page.mouse.up();
  await expect(page.getByTestId("proposal-target")).toHaveText("Applied to: Arm, front right, top face");
  // Still mode lands immediately.
  await expect(page.locator('[data-companion="agent"]')).toHaveAttribute("data-agent-state", "arrived");
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).__spoken.length)).toBe(0);
  // Voice waits while a proposal is open; Space does not start listening.
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.down("Space"); await page.keyboard.up("Space");
  expect(await page.evaluate(() => (window as any).__speech.length)).toBe(1);
  expect(errors).toEqual([]);
});

test("a question asked before any assistant call is spoken, circles fly to each choice, and a spoken answer settles it", async ({ page, request }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const proposals: any[] = [];
  page.on("response", async response => { if (response.url().endsWith("/propose")) proposals.push(await response.json()); });
  await open(page, request, true);
  const agents = page.locator('[data-companion="agent"]');
  const say = async (words: string, before?: () => Promise<void>) => {
    await page.keyboard.down("Space");
    await expect(page.getByTestId("agent-dock")).toHaveAttribute("data-phase", "listening");
    await before?.();
    await speak(page, "speech"); await speak(page, "final", words);
    await page.keyboard.up("Space");
  };
  const spoken = () => page.evaluate(() => (window as any).__spoken as string[]);

  // Nothing pointed at and one of four arms named: the studio asks, without any request to the server.
  await page.mouse.move(5, 5);
  await say("make the arm 6 mm thick");
  await expect(page.getByTestId("proposal-target")).toHaveText("Pointing at: 4 arms");
  await expect(agents).toHaveCount(4);
  for (const id of ["arm-front-right", "arm-front-left", "arm-rear-left", "arm-rear-right"])
    await expect(page.locator(`[data-companion="agent"][data-agent-target="${id}:face+y"]`)).toHaveAttribute("data-agent-state", "arrived");
  await expect.poll(spoken).toContain("Which arm: front right, front left, rear left or rear right?");
  expect(proposals).toHaveLength(0);
  // Each circle sits on its own arm, by the test's own projection.
  const { toScreen } = await camera(page);
  for (const id of ["arm-front-left", "arm-rear-right"]) {
    const arm = droneParts().find(p => p.id === id)!, dot = (await page.locator(`[data-agent-target="${id}:face+y"] .companion-dot`).boundingBox())!;
    const corners = [-1, 1].flatMap(sx => [-1, 1].flatMap(sy => [-1, 1].map(sz => toScreen(world(arm, [sx * arm.size[0] / 2, sy * arm.size[1] / 2, sz * arm.size[2] / 2])))));
    const cx = dot.x + dot.width / 2, cy = dot.y + dot.height / 2;
    expect(cx).toBeGreaterThanOrEqual(Math.min(...corners.map(c => c.x)) - 3); expect(cx).toBeLessThanOrEqual(Math.max(...corners.map(c => c.x)) + 3);
    expect(cy).toBeGreaterThanOrEqual(Math.min(...corners.map(c => c.y)) - 3); expect(cy).toBeLessThanOrEqual(Math.max(...corners.map(c => c.y)) + 3);
  }
  await shot(page, "companion-which-arm");

  // "The front left one" settles it: a measured edit of that arm, decided locally.
  await say("the front left one");
  await expect(page.getByTestId("proposal-target")).toHaveText("Applied to: Arm, front left, top face");
  await expect(page.getByRole("region", { name: "Proposed change" })).toContainText("local Y dimension → 6 mm");
  expect(proposals).toHaveLength(1);
  expect(proposals[0].source).toBe("local");
  await expect.poll(spoken).toContain("Arm, front left: local Y dimension to 6 millimetres.");
  await page.getByRole("button", { name: "Dismiss proposal", exact: true }).click();

  // A named-feature conflict: the server asks first (no assistant), circles mark each hole, "the left one" picks one.
  await pointAt(page, ARM, "face+y", ARM_TOP);
  await say("make this hole 4 mm");
  await expect(page.getByRole("region", { name: "Proposed change" })).toContainText("but the request says “this hole”");
  expect(proposals.at(-1).source).toBe("local");
  await expect(agents).toHaveCount(5);
  await expect.poll(spoken).toContain("Which feature should this change?");
  for (let i = 0; i < 5; i++) await expect(agents.nth(i)).toHaveAttribute("data-agent-state", "arrived");
  await shot(page, "companion-which-hole");
  const arm = droneParts().find(p => p.id === ARM)!, view = await camera(page);
  const holeX = arm.holes!.map(h => view.toScreen(world(arm, [h.x, 2, h.z])).x);
  const leftmost = holeX.indexOf(Math.min(...holeX));
  await say("the left one", async () => { await page.mouse.move(5, 5); });
  await expect(page.getByTestId("proposal-target")).toHaveText(new RegExp(`^Applied to: Arm, front right, Ø[\\d.]+ mm hole ${leftmost + 1}$`));
  await expect(page.getByRole("region", { name: "Proposed change" })).toContainText(`hole ${leftmost + 1} diameter → 4 mm`);
  expect(proposals.every(p => p.source === "local")).toBe(true);
  expect(errors).toEqual([]);
});
