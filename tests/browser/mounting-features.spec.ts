import { openDimensions, closePanels, studioTab } from './workspace-tools';
import { test, expect } from "@playwright/test";

test("mounting channels and counterbores remain visible through scaled save and package export", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const r = await request.post("/api/designs", {
    data: {
      kind: "custom",
      name: "Linear guide mounting study",
      customParts: [
        {
          id: "guide",
          name: "Guide block envelope",
          shape: "box",
          size: [45.4, 10, 27],
          position: [-30, 8, 0],
          channel: { width: 12.2, depth: 5.2 },
          holes: [-10, 10].flatMap((x) =>
            [-10, 10].map((z) => ({ x, z, diameter: 3 })),
          ),
          color: "#A2C7FF",
          material: "Steel",
          process: "buy",
        },
        {
          id: "rail",
          name: "Rail with recessed fasteners",
          shape: "box",
          size: [100, 8, 12],
          position: [30, 4, 35],
          holes: [-37.5, -12.5, 12.5, 37.5].map((x) => ({
            x,
            z: 0,
            diameter: 3.5,
            counterbore: { diameter: 6, depth: 4.5 },
          })),
          color: "#C8CDD1",
          material: "Steel",
          process: "buy",
        },
      ],
    },
  });
  expect(r.status()).toBe(201);
  const saved = await r.json();
  await page.goto(
    `/studio/${saved.snapshot.design.id}#token=${encodeURIComponent(saved.access.editorToken)}`,
  );
  await expect(page.locator(".scene-panel .model-canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  { await openDimensions(page); await page.getByTestId("param-scale").fill("1.5"); }
  await page.getByTestId("apply-dimensions").click();
  await expect(
    page.getByText("Design updated. Parts and assembly now match."),
  ).toBeVisible();
  await page.reload();
  { await openDimensions(page); await expect(page.getByTestId("param-scale")).toHaveValue("1.5"); }
  await expect(page.locator(".scene-panel .model-canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await closePanels(page);
  await closePanels(page);
  await page.screenshot({
    path: ".artifacts/mounting-features-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Expand right panel", exact: true })
    .click();
  await studioTab(page, "Build");
  await page.getByTestId("generate-build").click();
  await expect(
    page.getByRole("link", { name: "Download package" }),
  ).toBeVisible({ timeout: 60000 });
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download package" }).click();
  await (await download).saveAs(".artifacts/mounting-features-r1.zip");
  expect(errors).toEqual([]);
});
