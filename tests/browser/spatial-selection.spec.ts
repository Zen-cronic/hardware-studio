import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function circleView(page: Page) {
  await page.getByRole("button", { name: "Circle a part", exact: true }).click();
  const overlay = page.getByTestId("circle-selection-overlay");
  await expect(overlay).toBeVisible();
  const box = (await overlay.boundingBox())!;
  const points = [[20, 70], [box.width - 20, 70], [box.width - 20, box.height - 20], [20, box.height - 20], [20, 70]];
  await page.mouse.move(box.x + points[0][0], box.y + points[0][1]); await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 10 });
  await page.mouse.up();
}

test("depth-tested circle excludes an occluded part; keyboard list can select it", async ({ page, request }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const response = await request.post("/api/designs", { data: { kind: "custom", name: "Circle visibility check", customParts: [
    { id: "shell", name: "Outer shell", shape: "box", size: [90, 90, 90], position: [0, 45, 0], color: "#A2C7FF", material: "PETG", process: "print" },
    { id: "hidden", name: "Hidden interior", shape: "box", size: [10, 10, 10], position: [0, 45, 0], color: "#245BA8", material: "PETG", process: "print" },
  ] } });
  expect(response.status()).toBe(201);
  const result = await response.json();
  await page.goto(`/studio/${result.snapshot.design.id}#token=${encodeURIComponent(result.access.editorToken)}`);
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-ready", "true");
  await circleView(page);
  await expect(page.getByText("Outer shell selected.", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Choose circled parts" })).toHaveCount(0);
  const list = page.getByLabel("Choose a part from the list", { exact: true });
  await list.focus(); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Hidden interior", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Hidden interior selected.", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("circle-selection-and-hidden-list.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("a circle containing multiple parts asks before selecting", async ({ page, request }) => {
  const response = await request.post("/api/designs", { data: { kind: "custom", name: "Ambiguous circle", customParts: [
    { id: "left", name: "Left block", shape: "box", size: [30, 30, 30], position: [-45, 15, 0], color: "#A2C7FF", material: "PETG", process: "print" },
    { id: "right", name: "Right block", shape: "box", size: [30, 30, 30], position: [45, 15, 0], color: "#245BA8", material: "PETG", process: "print" },
  ] } });
  expect(response.status()).toBe(201); const result = await response.json();
  await page.goto(`/studio/${result.snapshot.design.id}#token=${encodeURIComponent(result.access.editorToken)}`);
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-ready", "true");
  await circleView(page);
  const choices = page.getByRole("region", { name: "Choose circled parts" });
  await expect(choices).toBeVisible();
  await choices.getByRole("checkbox", { name: "Right block" }).uncheck();
  await choices.getByRole("button", { name: "Use selected parts" }).click();
  await expect(page.getByText("Left block selected.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Circle a part", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("circle-selection-overlay")).toHaveCount(0);
});


test("exploded view has intermediate frames, reverses smoothly and respects reduced motion", async ({ page, request }, info) => {
  const response = await request.post("/api/designs", { data: { kind: "turntable", name: "Exploded motion check" } });
  const result = await response.json();
  await page.goto(`/studio/${result.snapshot.design.id}#token=${encodeURIComponent(result.access.editorToken)}`);
  const canvas = page.locator(".model-canvas canvas");
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-ready", "true");
  await expect(canvas).toHaveAttribute("data-explosion-progress", "0.0000");
  const toggle = page.getByRole("button", { name: "Toggle exploded assembly", exact: true });
  const before = await canvas.screenshot();
  await page.getByRole("button", { name: "Run mechanism", exact: true }).click();
  await expect.poll(async () => Number(await canvas.getAttribute("data-mechanism-seconds"))).toBeGreaterThan(.1);
  const mechanismTime = Number(await canvas.getAttribute("data-mechanism-seconds"));
  // Observe and reverse on a browser frame, avoiding automation round-trip
  // latency consuming the short transition before the second click arrives.
  const transition = await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>(".model-canvas canvas")!;
    const toggle = document.querySelector<HTMLButtonElement>('button[aria-label="Toggle exploded assembly"]')!;
    return new Promise<{ midpoint: number; immediatelyAfter: number; reverseFrames: number[] }>((resolve, reject) => {
      let midpoint = -1, immediatelyAfter = -1;
      const reverseFrames: number[] = [], started = performance.now();
      toggle.click();
      const sample = () => {
        const progress = Number(canvas.dataset.explosionProgress);
        if (midpoint < 0 && progress > .1 && progress < .9) {
          midpoint = progress; toggle.click(); immediatelyAfter = Number(canvas.dataset.explosionProgress);
        } else if (midpoint >= 0) {
          reverseFrames.push(progress);
          if (progress === 0) { resolve({ midpoint, immediatelyAfter, reverseFrames }); return; }
        }
        if (performance.now() - started > 8000) { reject(new Error("No complete reversible transition was rendered")); return; }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  });
  expect(transition.midpoint).toBeGreaterThan(.1); expect(transition.midpoint).toBeLessThan(.9);
  expect(transition.immediatelyAfter).toBe(transition.midpoint);
  expect(transition.reverseFrames.some(value => value > 0 && value <= transition.midpoint)).toBe(true);
  expect(Number(await canvas.getAttribute("data-mechanism-seconds"))).toBeGreaterThanOrEqual(mechanismTime);
  await expect(canvas).toHaveAttribute("data-explosion-progress", "0.0000");
  await toggle.click();
  await expect(canvas).toHaveAttribute("data-explosion-progress", "1.0000");
  const after = await canvas.screenshot();
  expect(after.equals(before)).toBe(false);
  await page.screenshot({ path: info.outputPath("smooth-exploded-assembly.png"), fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await toggle.click();
  await expect(canvas).toHaveAttribute("data-explosion-progress", "0.0000");
});
