import { expect, test } from "@playwright/test";

// /browse lists the camera drone and the articulated camera arm first; each starts as your own copy, as on /new.
const evidence = process.env.COMPANION_EVIDENCE;

test("/browse lists the camera drone and the camera arm first, and each opens as your own copy", async ({ page, request }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/browse");
  const cards = page.locator(".product-card");
  await expect(cards).toHaveCount(8);
  await expect(cards.nth(0)).toHaveAttribute("data-testid", "product-drone");
  await expect(cards.nth(1)).toHaveAttribute("data-testid", "product-arm");
  await expect(cards.nth(0).getByRole("heading")).toHaveText("Camera drone");
  await expect(cards.nth(1).getByRole("heading")).toHaveText("Articulated camera arm");
  // Eight preview canvases on software WebGL take a while to draw their first frames.
  await expect(cards.nth(0).locator(".model-canvas")).toHaveAttribute("data-ready", "true", { timeout: 60000 });
  await expect(cards.nth(1).locator(".model-canvas")).toHaveAttribute("data-ready", "true", { timeout: 60000 });
  if (evidence) await page.screenshot({ path: `${evidence}/browse.png` });
  // Filters and search find them like the other designs.
  await page.getByRole("button", { name: "Motion", exact: true }).click();
  await expect(page.getByTestId("product-drone")).toBeVisible();
  await expect(page.getByTestId("product-arm")).toHaveCount(0);
  await page.getByRole("button", { name: "Desk & studio", exact: true }).click();
  await expect(page.getByTestId("product-arm")).toBeVisible();
  await page.getByRole("button", { name: "All designs", exact: true }).click();
  await page.getByRole("textbox", { name: "Find a design" }).fill("drone");
  await expect(cards).toHaveCount(1);
  await page.getByRole("textbox", { name: "Find a design" }).fill("");

  // The drone opens straight into the studio as a new editable design, like "Start with a camera drone" on /new.
  await page.getByRole("button", { name: "Start with a camera drone", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/[^/#]+#token=/);
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-ready", "true");
  const drone = await (await request.get(`/api/designs/${decodeURIComponent(new URL(page.url()).pathname.split("/")[2])}`,
    { headers: { authorization: `Bearer ${decodeURIComponent(new URL(page.url()).hash.replace(/^#token=/, ""))}` } })).json();
  expect(drone.design).toMatchObject({ kind: "custom", name: "Camera drone", revision: 0 });
  expect(drone.design.customParts.map((p: any) => p.id)).toContain("arm-front-right");

  await page.goto("/browse");
  await page.getByRole("button", { name: "Start with an articulated camera arm", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/[^/#]+#token=/);
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-ready", "true");
  const arm = await (await request.get(`/api/designs/${decodeURIComponent(new URL(page.url()).pathname.split("/")[2])}`,
    { headers: { authorization: `Bearer ${decodeURIComponent(new URL(page.url()).hash.replace(/^#token=/, ""))}` } })).json();
  expect(arm.design).toMatchObject({ kind: "custom", name: "Articulated camera arm" });
  expect(arm.design.customParts.map((p: any) => p.id)).toContain("upper-arm");
  expect(errors).toEqual([]);
});
