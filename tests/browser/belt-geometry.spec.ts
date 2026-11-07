import { openDimensions, closePanels } from './workspace-tools';
import { test, expect } from "@playwright/test";

test("continuous belt and both return runs survive scaled save and package export", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const r = await request.post("/api/designs", {
    data: {
      kind: "custom",
      name: "Continuous belt study",
      customParts: [
        {
          id: "belt",
          name: "Continuous belt clearance envelope",
          shape: "tube",
          size: [201.59, 6, 21.59],
          loopSpan: 180,
          holeDiameter: 18.59,
          position: [0, 6, 0],
          color: "#353841",
          material: "Rubber",
          process: "buy",
        },
        ...[-90, 90].map((x, i) => ({
          id: `pulley-${i}`,
          name: "Pulley clearance envelope",
          shape: "tube",
          size: [18.59, 7, 18.59],
          holeDiameter: 5,
          position: [x, 6, 0],
          color: "#A2C7FF",
          material: "Aluminium",
          process: "buy",
        })),
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
    path: ".artifacts/belt-geometry-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Expand right panel", exact: true })
    .click();
  await page.getByRole("tab", { name: "Build", exact: true }).click();
  await page.getByTestId("generate-build").click();
  await expect(
    page.getByRole("link", { name: "Download package" }),
  ).toBeVisible({ timeout: 60000 });
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download package" }).click();
  await (await download).saveAs(".artifacts/belt-geometry-r1.zip");
  expect(errors).toEqual([]);
});
