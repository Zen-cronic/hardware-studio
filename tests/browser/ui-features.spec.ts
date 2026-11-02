import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
async function create(request: APIRequestContext) {
  const r = await request.post("/api/designs", {
    data: { kind: "turntable", name: "Interaction verification" },
  });
  expect(r.status()).toBe(201);
  return r.json();
}
const url = (r: any, viewer = false) =>
  "/studio/" +
  r.snapshot.design.id +
  "#token=" +
  encodeURIComponent(viewer ? r.access.viewerToken : r.access.editorToken);
async function draw(page: Page, points: number[][]) {
  const b = await page.getByTestId("shared-sketch").boundingBox();
  expect(b).not.toBeNull();
  await page.mouse.move(b!.x + points[0][0], b!.y + points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1))
    await page.mouse.move(b!.x + x, b!.y + y, { steps: 4 });
  await page.mouse.up();
}
test("shared sketch converges, own undo preserves another author and reload persists", async ({
  browser,
  request,
}) => {
  const r = await create(request),
    a = await browser.newContext(),
    b = await browser.newContext();
  await a.addInitScript(() => sessionStorage.setItem("hardware-name", "Kaung"));
  await b.addInitScript(() => sessionStorage.setItem("hardware-name", "Maya"));
  const p = await a.newPage(),
    q = await b.newPage();
  try {
    await Promise.all([p.goto(url(r)), q.goto(url(r))]);
    for (const page of [p, q]) {
      await page
        .getByRole("button", { name: "Open shared notes", exact: true })
        .click();
      await page.getByRole("tab", { name: "Sketch", exact: true }).click();
      await expect(
        page.locator(".shared-tabs").getByText("Connected", { exact: true }),
      ).toBeVisible();
    }
    await Promise.all([
      draw(p, [
        [30, 30],
        [120, 30],
        [120, 100],
        [30, 100],
        [30, 30],
      ]),
      draw(q, [
        [80, 10],
        [80, 130],
        [70, 120],
        [80, 130],
        [90, 120],
      ]),
    ]);
    await expect(
      p.getByText("2 shared strokes", { exact: true }),
    ).toBeVisible();
    await expect(
      q.getByText("2 shared strokes", { exact: true }),
    ).toBeVisible();
    await p
      .getByRole("button", { name: "Undo my stroke", exact: true })
      .click();
    await expect(
      q.getByText("1 shared strokes", { exact: true }),
    ).toBeVisible();
    await expect(q.locator(".sketch-authors")).toContainText("Maya");
    await expect(q.locator(".sketch-authors")).not.toContainText("Kaung");
    await q.reload();
    await q
      .getByRole("button", { name: "Open shared notes", exact: true })
      .click();
    await q.getByRole("tab", { name: "Sketch", exact: true }).click();
    await expect(
      q.getByText("1 shared strokes", { exact: true }),
    ).toBeVisible();
    await q
      .getByRole("button", { name: "Use as reference", exact: true })
      .click();
    await expect(q.locator(".reference-preview img")).toBeVisible();
  } finally {
    await a.close();
    await b.close();
  }
});
test("assembly coach catches incorrect virtual orientation and accepts correction", async ({
  page,
  request,
}) => {
  const r = await create(request);
  await page.goto(url(r));
  await expect(page.locator(".scene-panel .model-canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.getByRole("tab", { name: "Assemble", exact: true }).click();
  await page.locator(".step-parts button").first().click();
  await page
    .getByRole("button", { name: "Turn part 90°", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check selected part", exact: true })
    .click();
  await expect(
    page.getByText("The selected part is turned away", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reset orientation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check selected part", exact: true })
    .click();
  await expect(
    page.getByText("its virtual orientation matches", { exact: false }),
  ).toBeVisible();
  const snap = await request.get("/api/designs/" + r.snapshot.design.id, {
    headers: { Authorization: "Bearer " + r.access.editorToken },
  });
  expect((await snap.json()).design.revision).toBe(0);
});
test("sharing and sketch dialogs retain keyboard focus and restore it on Escape", async ({
  page,
  request,
}) => {
  const r = await create(request);
  await page.goto(url(r));
  const share = page.getByRole("button", { name: "Share", exact: true });
  await share.click();
  await expect(
    page.getByRole("button", { name: "Close sharing", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Copy invitation", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(share).toBeFocused();
  await page
    .getByRole("button", { name: "Draw a sketch", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Close sketch", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Draw a sketch", exact: true }),
  ).toBeFocused();
});

test("mobile editor opens dimensions first and switches to a compact prompt without overflow", async ({
  browser,
  request,
}) => {
  const r = await create(request),
    context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    }),
    page = await context.newPage();
  try {
    await page.goto(url(r));
    await expect(page.getByTestId("param-diameter")).toBeVisible();
    await expect(page.getByTestId("design-prompt")).not.toBeVisible();
    await page.getByTestId("param-diameter").fill("280");
    await page.getByTestId("apply-dimensions").click();
    await expect(page.getByTestId("param-diameter")).toHaveValue("280");
    await page
      .getByRole("button", { name: "Describe a change", exact: true })
      .click();
    await expect(page.getByTestId("design-prompt")).toBeVisible();
    await expect(page.getByTestId("param-diameter")).not.toBeVisible();
    await page
      .getByTestId("design-prompt")
      .fill("Make the platter 300 mm wide.");
    const prompt = await page.locator(".conversation-editor").boundingBox(),
      history = await page.locator(".history-panel").boundingBox();
    expect(history!.y).toBeGreaterThanOrEqual(prompt!.y + prompt!.height - 1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Dimensions", exact: true }).click();
    await expect(page.getByTestId("param-diameter")).toHaveValue("280");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});

for (const width of [320, 375, 768]) {
  test(`mobile shared notes at ${width}px exchange and persist with another editor`, async ({ browser, request }) => {
    const r = await create(request);
    const mobile = await browser.newContext({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true });
    const desktop = await browser.newContext();
    const phone = await mobile.newPage(), peer = await desktop.newPage();
    try {
      await Promise.all([phone.goto(url(r)), peer.goto(url(r))]);
      const toggle = phone.getByRole("button", { name: "Open shared notes", exact: true });
      await expect(toggle).toBeVisible();
      const box = await toggle.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(phone.locator(".scene-panel .model-canvas")).toHaveAttribute("data-ready", "true");
      await phone.screenshot({ path: `.artifacts/mobile-notes-${width}-closed.png` });
      await toggle.tap();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await peer.getByRole("button", { name: "Open shared notes", exact: true }).click();
      for (const p of [phone, peer]) {
        await expect(p.locator(".shared-tabs").getByText("Connected", { exact: true })).toBeVisible();
      }
      await phone.getByLabel("Add a shared note", { exact: true }).fill("Check the base diameter before assembly.");
      await phone.getByRole("button", { name: "Add note", exact: true }).tap();
      await expect(peer.locator(".notes-list")).toContainText("Check the base diameter before assembly.");
      await peer.getByLabel("Add a shared note", { exact: true }).fill("Confirmed: the base matches this revision.");
      await peer.getByRole("button", { name: "Add note", exact: true }).click();
      await expect(phone.locator(".notes-list")).toContainText("Confirmed: the base matches this revision.");
      expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await phone.screenshot({ path: `.artifacts/mobile-notes-${width}-open.png` });
      await phone.getByRole("button", { name: "Close shared notes", exact: true }).tap();
      await expect(phone.locator(".notes-drawer")).toHaveCount(0);
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(phone.getByTestId("param-diameter")).toBeVisible();
      await phone.reload();
      await phone.getByRole("button", { name: "Open shared notes", exact: true }).tap();
      await expect(phone.locator(".notes-list article")).toHaveCount(2);
      await phone.getByRole("tab", { name: "Sketch", exact: true }).tap();
      await expect(phone.getByTestId("shared-sketch")).toBeVisible();
      expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await mobile.close();
      await desktop.close();
    }
  });
}
