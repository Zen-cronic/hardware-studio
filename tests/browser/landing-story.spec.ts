import { expect, test } from "@playwright/test";

// The home story without scroll scrubbing still reaches every step, and the turntable's
// reset button does what it says.

test("on a phone with reduced motion the story advances past the first step", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const story = page.locator("#lp-story");
  await story.scrollIntoViewIfNeeded();
  const active = story.locator('.lp-steps [aria-current="step"]');
  await expect(active).toContainText("Point at a part");
  const next = story.getByRole("button", { name: "Next step", exact: true });
  for (const title of ["Say what to change", "Check that it still holds", "Accept the change", "See it in your room"]) {
    await next.click();
    await expect(active).toContainText(title);
    await expect(active).toBeVisible();
  }
  await expect(next).toBeDisabled();
  await story.getByRole("button", { name: "Previous step", exact: true }).click();
  await expect(active).toContainText("Accept the change");
});

test("the turntable's tour button returns to the tour after choosing a size", async ({ page }) => {
  await page.goto("/");
  const size = page.getByTestId("landing-size-280");
  await size.scrollIntoViewIfNeeded();
  await size.click();
  await expect(size).toHaveAttribute("aria-pressed", "true");
  const back = page.getByTestId("landing-follow-scroll");
  await expect(back).toHaveText("Back to the tour");
  await back.click();
  await expect(back).toHaveCount(0);
  await expect(page.getByTestId("landing-size-220")).toHaveAttribute("aria-pressed", "true");
});
