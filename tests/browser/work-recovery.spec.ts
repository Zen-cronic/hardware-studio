import { openDimensions } from './workspace-tools';
import { test, expect } from "@playwright/test";
const invite = (made: any, token = made.access.editorToken) =>
  `/studio/${made.snapshot.design.id}#token=${encodeURIComponent(token)}`;
test("editor invitation returns through Your work and viewer visits preserve editing access", async ({
  page,
  request,
}) => {
  const res = await request.post("/api/designs", {
    data: { kind: "holder", name: "Return to this design" },
  });
  const made = await res.json();
  await page.goto(invite(made));
  { await openDimensions(page); await expect(page.getByTestId("param-opening")).toBeEnabled(); }
  await page.getByRole("button", { name: "Your work", exact: true }).click();
  await expect(page.locator(".work-row")).toHaveCount(1);
  await page.locator(".work-row").click();
  { await openDimensions(page); await expect(page.getByTestId("param-opening")).toBeEnabled(); }
  await page.reload();
  { await openDimensions(page); await expect(page.getByTestId("param-opening")).toBeEnabled(); }
  await page.goto(invite(made, made.access.viewerToken));
  { await openDimensions(page); await expect(page.getByTestId("param-opening")).toBeDisabled(); }
  await page.getByRole("button", { name: "Your work", exact: true }).click();
  await page.screenshot({
    path: ".artifacts/work-recovery/work.png",
    fullPage: true,
  });
  await page.locator(".work-row").click();
  { await openDimensions(page); await expect(page.getByTestId("param-opening")).toBeEnabled(); }
  const after = await request.get("/api/designs/" + made.snapshot.design.id, {
    headers: { Authorization: "Bearer " + made.access.editorToken },
  });
  expect((await after.json()).design).toEqual(made.snapshot.design);
});
test("viewer-only and invalid invitations cannot populate editable work", async ({
  page,
  request,
}) => {
  const made = await (
    await request.post("/api/designs", { data: { kind: "holder" } })
  ).json();
  await page.goto(invite(made, made.access.viewerToken));
  { await openDimensions(page); await expect(page.getByTestId("param-opening")).toBeDisabled(); }
  await page.getByRole("button", { name: "Your work", exact: true }).click();
  await expect(page.locator(".work-row")).toHaveCount(0);
  await page.goto(invite(made, "invalid"));
  await expect(page.getByRole("alert")).toBeVisible();
  await page.goto("/work");
  await expect(page.locator(".work-row")).toHaveCount(0);
});
test("malformed local data recovers and quota errors keep the authenticated model usable", async ({
  page,
  request,
}) => {
  const made = await (
    await request.post("/api/designs", { data: { kind: "holder" } })
  ).json();
  await page.addInitScript(() =>
    localStorage.setItem("hardware-designs", '{"broken":true}'),
  );
  await page.goto(invite(made));
  { await openDimensions(page); await expect(page.getByTestId("param-opening")).toBeEnabled(); }
  await page.getByRole("button", { name: "Your work", exact: true }).click();
  await expect(page.locator(".work-row")).toHaveCount(1);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "hardware-designs")
        throw new DOMException("Full", "QuotaExceededError");
      return original.call(this, k, v);
    };
  });
  await page.goto(invite(made));
  { await openDimensions(page); await expect(page.getByTestId("param-opening")).toBeEnabled(); }
  await expect(page.getByRole("status")).toContainText(
    "Keep your invitation link",
  );
  await expect(page.locator(".scene-panel .model-canvas")).toHaveAttribute("data-ready", "true");
  await page.screenshot({
    path: ".artifacts/work-recovery/storage-warning.png",
    fullPage: true,
  });
});
