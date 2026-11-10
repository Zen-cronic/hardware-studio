import { expect, test, type Page } from "@playwright/test";

// The home request box carries a typed request and a photo into the studio. The photo is
// re-encoded like the studio's reference input; a photo that cannot travel never loses the request.

async function bigPhoto(page: Page) {
  // A 3000 x 2000 PNG of noise: several megabytes, like a phone photo.
  const base64 = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 3000; c.height = 2000;
    const ctx = c.getContext("2d")!, data = ctx.createImageData(3000, 2000);
    for (let i = 0; i < data.data.length; i++) data.data[i] = (i * 2654435761) >>> 24;
    ctx.putImageData(data, 0, 0);
    return c.toDataURL("image/png").split(",")[1];
  });
  return { name: "photo.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

test("a large photo arrives as a small JPEG with the request", async ({ page }) => {
  await page.goto("/new");
  await page.getByLabel("Describe what you want to make").fill("A camera drone for my backpack");
  await page.locator('input[type=file][accept*="image/png"]').setInputFiles(await bigPhoto(page));
  const attached = page.getByRole("img", { name: "Your photo" });
  await expect(attached).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
  const size = await attached.evaluate((img: HTMLImageElement) => Math.max(img.naturalWidth, img.naturalHeight));
  expect(size).toBeLessThanOrEqual(1000);
  await page.getByRole("button", { name: "Build it" }).click();
  await expect(page.getByTestId("design-prompt")).toHaveValue("A camera drone for my backpack");
  await expect(page.getByRole("img", { name: "Your design reference" })).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
});

test("when the photo does not fit in storage, the request still arrives and the studio says so", async ({ page }) => {
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (value.length > 20000) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return set.call(this, key, value);
    };
  });
  await page.goto("/new");
  await page.getByLabel("Describe what you want to make").fill("A desk arm for my phone");
  await page.locator('input[type=file][accept*="image/png"]').setInputFiles(await bigPhoto(page));
  await expect(page.getByRole("img", { name: "Your photo" })).toBeVisible();
  await page.getByRole("button", { name: "Build it" }).click();
  await expect(page.getByTestId("design-prompt")).toHaveValue("A desk arm for my phone");
  await expect(page.getByText("The photo was too large; add it in the studio.")).toBeVisible();
});

test("a photo type the assistant cannot read is refused at once", async ({ page }) => {
  await page.goto("/new");
  await page.locator('input[type=file][accept*="image/png"]').setInputFiles({ name: "photo.gif", mimeType: "image/gif", buffer: Buffer.from("R0lGODlhAQABAAAAACw=", "base64") });
  await expect(page.getByRole("alert")).toHaveText("Add a PNG, JPEG or WebP photo.");
});
