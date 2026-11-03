import { test, expect } from "@playwright/test";

for (const width of [1440, 375]) {
  test(`fit measurements preserve a draft until both values are valid at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const created = await request.post("/api/designs", {
      data: { kind: "turntable", name: "Fit measurement check" },
    });
    expect(created.status()).toBe(201);
    const data = await created.json();
    const headers = { Authorization: `Bearer ${data.access.editorToken}` };
    let proposals = 0;
    await page.route("**/propose", async (route) => {
      proposals++;
      await route.abort();
    });
    await page.goto(
      `/studio/${data.snapshot.design.id}#token=${encodeURIComponent(data.access.editorToken)}`,
    );
    if (width < 600)
      await page
        .getByRole("button", { name: "Describe a change", exact: true })
        .click();
    const prompt = page.getByTestId("design-prompt");
    await prompt.fill("Keep my existing draft.");
    await page
      .getByRole("button", { name: "Fit something you own", exact: false })
      .click();
    const w = page.getByLabel("Width (mm)", { exact: true });
    const h = page.getByLabel("Height (mm)", { exact: true });
    const use = page.getByRole("button", {
      name: "Use these measurements",
      exact: true,
    });
    for (const input of [w, h]) {
      for (const value of ["", "0", "-1", "2000.1"]) {
        await input.fill(value);
        await expect(use).toBeDisabled();
        await expect(input).toHaveAttribute("aria-invalid", "true");
        await expect(
          page.getByText("Enter a width and height from 1 to 2,000 mm.", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(prompt).toHaveValue("Keep my existing draft.");
      }
      await input.fill("80");
    }
    for (const [x, y] of [
      ["1", "2000"],
      ["120.5", "80.25"],
    ]) {
      await w.fill(x);
      await h.fill(y);
      await expect(use).toBeEnabled();
      await expect(w).toHaveAttribute("aria-invalid", "false");
      await use.click();
      await expect(prompt).toHaveValue(
        `Help adapt this Fit measurement check to fit an object ${x} mm wide and ${y} mm high. Ask for any other measurement you need.`,
      );
    }
    await w.fill("");
    await expect(w).toHaveValue("");
    await expect(use).toBeDisabled();
    await expect(prompt).toHaveValue(
      "Help adapt this Fit measurement check to fit an object 120.5 mm wide and 80.25 mm high. Ask for any other measurement you need.",
    );
    const saved = await request.get(`/api/designs/${data.snapshot.design.id}`, {
      headers,
    });
    expect((await saved.json()).design).toEqual(data.snapshot.design);
    expect(proposals).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.artifacts/fit-measurements-${width}.png`,
      fullPage: false,
    });
  });
}
