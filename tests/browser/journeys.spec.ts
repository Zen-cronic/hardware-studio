import { openDimensions, studioTab } from './workspace-tools';
import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
const kinds = [
  "turntable",
  "slider",
  "conveyor",
  "lamp",
  "planter",
  "holder",
] as const;
const changes = {
  turntable: ["diameter", "280"],
  slider: ["travel", "750"],
  conveyor: ["length", "650"],
  lamp: ["reach", "350"],
  planter: ["pots", "4"],
  holder: ["opening", "120"],
};
async function create(request: APIRequestContext, kind: string) {
  const r = await request.post("/api/designs", {
    data: { kind, name: "Browser verification " + kind },
  });
  expect(r.status()).toBe(201);
  return r.json();
}
const url = (r: any, viewer = false) =>
  "/studio/" +
  r.snapshot.design.id +
  "#token=" +
  encodeURIComponent(viewer ? r.access.viewerToken : r.access.editorToken);
for (const kind of kinds)
  test(
    kind + " edit, assembly and real package",
    async ({ page, request }, info) => {
      test.setTimeout(90000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const r = await create(request, kind);
      await page.goto(url(r));
      { await openDimensions(page); await expect(page.getByTestId("param-" + changes[kind][0])).toBeVisible(); }
      { await openDimensions(page); await page
        .getByTestId("param-" + changes[kind][0])
        .fill(changes[kind][1]); }
      if (kind === "lamp") await page.getByTestId("param-angle").fill("60");
      await page.getByTestId("apply-dimensions").click();
      await expect(
        page.getByText("Design updated. Parts and assembly now match."),
      ).toBeVisible();
      if (kind === "lamp") {
        await expect(page.getByRole("button", { name: "Run mechanism", exact: true })).toBeDisabled();
        await expect(page.getByRole("button", { name: "Run mechanism", exact: true })).toHaveText("Static pose");
        const changed = await (await request.get(`/api/designs/${r.snapshot.design.id}`, {
          headers: { Authorization: `Bearer ${r.access.editorToken}` },
        })).json();
        expect(changed.design.params.angle).toBe(60);
        expect(changed.derived.parts.some((part: any) => {
          const previous = r.snapshot.derived.parts.find((value: any) => value.id === part.id);
          return previous && JSON.stringify(part.rotation) !== JSON.stringify(previous.rotation);
        })).toBe(true);
        await expect(page.locator('.scene-panel .model-canvas')).toHaveAttribute('data-ready', 'true');
      } else {
        await page.getByRole("button", { name: "Run mechanism", exact: true }).click();
        await expect(page.getByRole("button", { name: "Pause mechanism", exact: true })).toBeVisible();
      }
      await studioTab(page, "Assemble");
      await page.getByRole("button", { name: "Expand left panel", exact: true }).click();
      await expect(page.getByText("Put it together.")).toBeVisible();
      await page.getByRole("button", { name: "Expand right panel", exact: true }).click();
      await page
        .getByRole("button", { name: "Mark step reviewed", exact: true })
        .click();
      await expect(page.getByText(`1 of ${r.snapshot.derived.steps.length} steps reviewed`)).toBeVisible();
      await studioTab(page, "Build");
      await page.getByTestId("generate-build").click();
      await expect(
        page.getByRole("link", { name: "Download package" }),
      ).toBeVisible({ timeout: 60000 });
      const download = page.waitForEvent("download");
      await page.getByRole("link", { name: "Download package" }).click();
      const file = await download;
      await file.saveAs(info.outputPath(kind + "-r1.zip"));
      expect(file.suggestedFilename()).toBe("hardware-design-r1.zip");
      await page.screenshot({
        path: info.outputPath(kind + "-build.png"),
        fullPage: true,
      });
      expect(errors).toEqual([]);
    },
  );
test("two editors merge independent edits, detect collision and share notes", async ({
  browser,
  request,
}) => {
  const r = await create(request, "turntable");
  const a = await browser.newContext(),
    b = await browser.newContext();
  const p = await a.newPage(),
    q = await b.newPage();
  try {
    await Promise.all([p.goto(url(r)), q.goto(url(r))]);
    { await openDimensions(p); await expect(p.getByTestId("param-diameter")).toHaveValue("220"); }
    { await openDimensions(q); await expect(q.getByTestId("param-height")).toHaveValue("180"); }
    { await openDimensions(p); await p.getByTestId("param-diameter").fill("280"); }
    { await openDimensions(q); await q.getByTestId("param-height").fill("200"); }
    await p.getByTestId("apply-dimensions").click();
    { await openDimensions(q); await expect(q.getByTestId("param-diameter")).toHaveValue("280"); }
    await q.getByTestId("apply-dimensions").click();
    { await openDimensions(p); await expect(p.getByTestId("param-height")).toHaveValue("200"); }
    { await openDimensions(p); await p.getByTestId("param-diameter").fill("300"); }
    { await openDimensions(q); await q.getByTestId("param-diameter").fill("320"); }
    await p.getByTestId("apply-dimensions").click();
    await expect(
      p.getByText("Design updated. Parts and assembly now match."),
    ).toBeVisible();
    await q.getByTestId("apply-dimensions").click();
    await expect(q.getByRole("alert")).toContainText(
      "changed while you were editing",
    );
    await q.getByRole("button", { name: "Review latest design" }).click();
    { await openDimensions(q); await expect(q.getByTestId("param-diameter")).toHaveValue("300"); }
    await p.getByRole("button", { name: "Open shared notes" }).click();
    await q.getByRole("button", { name: "Open shared notes" }).click();
    await p
      .getByLabel("Add a shared note")
      .fill("Check the hub bore against the measured shaft.");
    await expect(
      p.getByRole("button", { name: "Add note", exact: true }),
    ).toBeEnabled();
    await p.getByRole("button", { name: "Add note", exact: true }).click();
    await expect(
      q.getByText("Check the hub bore against the measured shaft."),
    ).toBeVisible();
    await q.reload();
    { await openDimensions(q); await expect(q.getByTestId("param-diameter")).toHaveValue("300"); }
  } finally {
    await a.close();
    await b.close();
  }
});
test("viewer cannot edit; mobile routes have no horizontal overflow", async ({
  browser,
  request,
}) => {
  const r = await create(request, "turntable");
  const c = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const p = await c.newPage();
  try {
    for (const route of ["/", "/designs/slider", "/new", url(r, true)]) {
      await p.goto(route);
      await p
        .getByRole("button", { name: "Make Anything home" })
        .first()
        .waitFor();
      await expect
        .poll(() =>
          p.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        )
        .toBe(true);
    }
    { await openDimensions(p); await expect(p.getByTestId("param-diameter")).toBeDisabled(); }
    const denied = await request.post(
      "/api/designs/" + r.snapshot.design.id + "/build",
      {
        headers: { Authorization: "Bearer " + r.access.viewerToken },
        data: {},
      },
    );
    expect(denied.status()).toBe(403);
  } finally {
    await c.close();
  }
});
test("unknown design and invalid dimensions have actionable recovery", async ({
  page,
  request,
}) => {
  await page.goto("/studio/missing#token=invalid");
  await expect(page.getByText("This design was not found.")).toBeVisible();
  const r = await create(request, "conveyor");
  await page.goto(url(r));
  { await openDimensions(page); await page.getByTestId("param-sensorPosition").fill("780"); }
  await page.getByTestId("apply-dimensions").click();
  await expect(page.getByRole("alert")).toContainText("sensor");
  await page.getByRole("button", { name: "Review latest design" }).click();
  { await openDimensions(page); await expect(page.getByTestId("param-sensorPosition")).toHaveValue("200"); }
});
