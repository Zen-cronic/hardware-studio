import { expect, test } from "@playwright/test";
import { droneParts } from "../../src/shared/drone";

// "See it in your room": the view page hands the built GLB to model-viewer with real-size AR,
// and the studio sheet makes the model itself, then shows a phone code for a view-only link.
const evidence = process.env.COMPANION_EVIDENCE;
test.setTimeout(120000);

test("the view page renders model-viewer at real size, and the studio sheet offers a view-only phone code", async ({ page, request }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const created = await (await request.post("/api/designs", { data: { kind: "custom", name: "Camera drone", customParts: droneParts() } })).json();
  const id = created.snapshot.design.id, { editorToken, viewerToken } = created.access;

  // Before any build the page explains the gap, naming only controls the studio has.
  await page.goto(`/view/${id}#token=${encodeURIComponent(viewerToken)}`);
  await expect(page.getByRole("alert")).toHaveText("This design has no 3D model yet. Open this design on a computer and press See it in your room. The 3D model is made automatically; then scan the new code.");
  await expect(page.getByRole("alert")).not.toContainText(/Generate build package|choose Build/);

  // Opening the sheet makes the model at once; the code and the link appear only when it is ready.
  await page.addInitScript(({ id, editorToken, viewerToken }) => {
    localStorage.setItem("hardware-designs", JSON.stringify([{ id, name: "Camera drone", kind: "custom", token: editorToken, viewerToken, editedAt: new Date().toISOString() }]));
  }, { id, editorToken, viewerToken });
  await page.goto(`/studio/${id}#token=${encodeURIComponent(editorToken)}`);
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("see-in-room").click();
  const sheet = page.getByTestId("room-sheet");
  await expect(sheet.getByRole("heading", { name: "See it in your room" })).toBeVisible();
  const qr = sheet.getByRole("img", { name: "Code to open this design in AR on a phone" });
  const copy = sheet.getByRole("button", { name: "Copy view link", exact: true });
  await expect(sheet.getByTestId("room-making")).toHaveText("Making the 3D model…");
  await expect(sheet).toHaveAttribute("data-model-state", "making");
  await expect(sheet.getByTestId("room-code-waiting")).toHaveText("The code for your phone appears here when the 3D model is ready.");
  await expect(qr).toHaveCount(0); await expect(copy).toHaveCount(0);
  await expect(sheet.getByRole("link", { name: "Open it in your room" })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: /Prepare|Generate/ })).toHaveCount(0);
  if (evidence) await page.screenshot({ path: `${evidence}/room-sheet-making.png` });
  // While making, the code stays hidden at every check.
  for (let i = 0; i < 5 && await sheet.getAttribute("data-model-state") === "making"; i++) {
    expect(await qr.count()).toBe(0); expect(await copy.count()).toBe(0);
    await page.waitForTimeout(500);
  }
  const preview = sheet.locator("model-viewer");
  await expect(preview).toHaveAttribute("src", `/api/designs/${id}/model.glb?token=${encodeURIComponent(editorToken)}`, { timeout: 90000 });
  await expect(sheet).toHaveAttribute("data-model-state", "ready");
  await expect(sheet.getByTestId("room-code-waiting")).toHaveCount(0);
  // The sheet ran the same build the Build tab runs: one ready build for revision 0.
  const latest = await (await request.get(`/api/designs/${id}/builds/latest`, { headers: { authorization: `Bearer ${editorToken}` } })).json();
  expect(latest).toMatchObject({ status: "ready", revision: 0 });
  await expect(qr).toHaveAttribute("src", /^data:image\/png;base64,/);
  // Still scannable at about two-thirds size: at least 280 px on screen, dark modules on white with a quiet zone.
  const qrBox = (await qr.boundingBox())!;
  expect(qrBox.width).toBeGreaterThanOrEqual(280); expect(qrBox.height).toBeGreaterThanOrEqual(280);
  const corner = await qr.evaluate(async (img: HTMLImageElement) => {
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!; ctx.drawImage(img, 0, 0);
    const px = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
    return { size: img.naturalWidth, margin: px(4, 4), finder: px(Math.round(img.naturalWidth * 0.14), Math.round(img.naturalWidth * 0.14)) };
  });
  expect(corner.size).toBeGreaterThanOrEqual(560);
  expect(corner.margin).toEqual([255, 255, 255]);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await copy.click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toBe(`${new URL(page.url()).origin}/view/${id}#token=${encodeURIComponent(viewerToken)}`);
  expect(link).not.toContain(encodeURIComponent(editorToken));
  await expect.poll(() => preview.evaluate((el: any) => el.loaded === true), { timeout: 30000 }).toBe(true);
  if (evidence) await page.screenshot({ path: `${evidence}/room-sheet.png` });
  await sheet.getByRole("button", { name: "Close room view", exact: true }).click();

  // The phone page: AR on, Scene Viewer / WebXR / Quick Look, fixed real scale, metres from the GLB.
  await page.goto(link);
  const viewer = page.locator("model-viewer");
  await expect(viewer).toHaveAttribute("src", `/api/designs/${id}/model.glb?token=${encodeURIComponent(viewerToken)}`);
  await expect(viewer).toHaveAttribute("ar", "");
  await expect(viewer).toHaveAttribute("ar-modes", "webxr scene-viewer quick-look");
  await expect(viewer).toHaveAttribute("ar-scale", "fixed");
  await expect.poll(() => viewer.evaluate((el: any) => el.loaded === true), { timeout: 30000 }).toBe(true);
  const size = await viewer.evaluate((el: any) => { const d = el.getDimensions(); return [d.x, d.y, d.z]; });
  // The drone spans about 0.27 m across its propeller tips and stands about 0.1 m tall.
  expect(size[0]).toBeGreaterThan(0.2); expect(size[0]).toBeLessThan(0.4);
  expect(size[1]).toBeGreaterThan(0.06); expect(size[1]).toBeLessThan(0.14);
  expect(size[2]).toBeGreaterThan(0.2); expect(size[2]).toBeLessThan(0.4);
  if (evidence) await page.screenshot({ path: `${evidence}/view-in-room-page.png` });

  // After an applied change the model is from an earlier version: the phone page says so instead of showing it,
  // and the studio sheet keeps the out-of-date flag and offers to update it, with no code until it is current.
  const current = await (await request.get(`/api/designs/${id}`, { headers: { authorization: `Bearer ${editorToken}` } })).json();
  const customParts = current.design.customParts.map((p: any) => p.id === "arm-front-left" ? { ...p, size: [p.size[0], 6, p.size[2]] } : p);
  expect((await request.post(`/api/designs/${id}/commands`, { headers: { authorization: `Bearer ${editorToken}` },
    data: { id: crypto.randomUUID(), actor: "Maker", baseRevision: current.design.revision, changes: {}, readSet: current.design.params, customParts, summary: "thicker arm" } })).status()).toBe(200);
  // Already on the view link: reload, since a same-URL navigation keeps the page.
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("This 3D model is from an earlier version of the design.");
  await expect(page.locator("model-viewer")).toHaveCount(0);
  await page.goto(`/studio/${id}#token=${encodeURIComponent(editorToken)}`);
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("see-in-room").click();
  await expect(sheet).toContainText("This 3D model is from an earlier version (revision 0).");
  await expect(sheet.getByRole("button", { name: "Update the 3D model", exact: true })).toBeVisible();
  await expect(sheet.locator("model-viewer")).toHaveCount(0);
  await expect(qr).toHaveCount(0); await expect(copy).toHaveCount(0);
  await expect(sheet.getByTestId("room-code-waiting")).toHaveText("The code for your phone appears here once the 3D model is up to date.");
  expect(errors).toEqual([]);
});

test("a viewer without edit rights gets a plain message and no code, and nothing is built", async ({ page, request }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const created = await (await request.post("/api/designs", { data: { kind: "custom", name: "Camera drone", customParts: droneParts() } })).json();
  const id = created.snapshot.design.id, { editorToken, viewerToken } = created.access;
  await page.goto(`/studio/${id}#token=${encodeURIComponent(viewerToken)}`);
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("see-in-room").click();
  const sheet = page.getByTestId("room-sheet");
  await expect(sheet).toContainText("This design has no 3D model yet. It is made when someone who can edit the design opens See it in your room.");
  await expect(sheet.getByRole("img", { name: "Code to open this design in AR on a phone" })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Copy view link", exact: true })).toHaveCount(0);
  await expect(sheet.getByTestId("room-making")).toHaveCount(0);
  await expect(sheet.getByRole("button")).toHaveCount(1); // Close only.
  expect(await (await request.get(`/api/designs/${id}/builds/latest`, { headers: { authorization: `Bearer ${editorToken}` } })).json()).toBeNull();
  expect(errors).toEqual([]);
});
