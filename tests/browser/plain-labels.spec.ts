import { expect, test } from "@playwright/test";
import { droneParts } from "../../src/shared/drone";
import { ARM, ARM_TOP, camera, open, pointAt, speak, world } from "./voice-tools";

// Words people read in the studio: a pointed surface by name, and the voice hint for the whole design.
const evidence = process.env.COMPANION_EVIDENCE;
const PROP = "prop-front-right";

test("hovering a propeller names the part in plain words, never a normal vector or coordinates", async ({ page, request }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await open(page, request, true);
  const prop = droneParts().find(p => p.id === PROP)!, { toScreen } = await camera(page);
  // The 3D view's hover label and the pointer circle's label carry the same words.
  const canvas = page.locator(".model-canvas"), label = page.locator('[data-surface-label="hover"]');
  const circle = page.locator('[data-companion="user"] [data-companion-label]');
  const seen = new Set<string>();
  const half = prop.size[0] / 2;
  // Along the blade, both faces: every hit on the propeller gets a readable label. Next to the hub the
  // twisted blade has no named face, which is where a normal vector used to show.
  for (const x of [-0.9, -0.6, -0.3, -0.06, -0.02, 0.3, 0.6, 0.94]) for (const z of [-3, 0, 3, 5]) for (const y of [0.7, -0.7]) {
    const point = toScreen(world(prop, [x * half, y, z]));
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(80);
    if (await canvas.getAttribute("data-hovered-part") !== PROP) continue;
    const text = (await label.textContent())!;
    await expect(circle).toHaveText(text);
    seen.add(text);
    if (evidence && /curved surface/.test(text) && !seen.has("captured")) { seen.add("captured"); await page.screenshot({ path: `${evidence}/propeller-hover.png` }); }
  }
  seen.delete("captured");
  expect([...seen]).toContain("Propeller 5 in, front right, curved surface");
  for (const text of seen) {
    expect(text.startsWith("Propeller 5 in, front right, "), text).toBe(true);
    expect(text, text).not.toMatch(/normal|near \(|\(-?\d/);
  }
  expect(errors).toEqual([]);
});

test("holding Space with nothing pointed at says the request is about the whole design", async ({ page, request }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await open(page, request, true);
  const status = page.getByTestId("voice-status");
  await page.mouse.move(5, 5);
  await page.keyboard.down("Space");
  await expect(page.getByTestId("agent-dock")).toHaveAttribute("data-phase", "listening");
  await expect(status).toHaveText("Talking about the whole design.");
  if (evidence) await page.screenshot({ path: `${evidence}/whole-design-hint.png` });
  // Over a part the hint asks for a request about it; off the model it is the whole design again.
  await pointAt(page, ARM, "face+y", ARM_TOP);
  await expect(status).toHaveText("Hover over a part, then speak your request.");
  await page.mouse.move(5, 5);
  await expect(status).toHaveText("Talking about the whole design.");
  // Speech starts with nothing pointed at: still the whole design, not a draft or a hover prompt.
  await speak(page, "speech");
  await expect(status).toHaveText("Talking about the whole design.");
  // "This" with nothing pointed at stays a draft, as before.
  await speak(page, "final", "make this smaller");
  await page.keyboard.up("Space");
  await expect(status).toContainText("No part was targeted");
  expect(errors).toEqual([]);
});
