import { openDimensions } from './workspace-tools';
import { test, expect } from "@playwright/test";

for (const closeDelay of [0, 1000]) test(`renaming preserves status, shared edits and reconnection with close delay ${closeDelay}`, async ({ browser, request }) => {
  const made = await (await request.post("/api/designs", { data: { kind: "turntable", name: "Shared connection check" } })).json();
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    for (const context of contexts) await context.addInitScript((delay) => {
      const Native = window.WebSocket;
      (window as any).roomSockets = [];
      (window as any).deliveredRoomCloses = 0;
      const closeDescriptor = Object.getOwnPropertyDescriptor(Native.prototype, "onclose")!;
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          if (String(url).includes("/api/rooms/")) {
            (window as any).roomSockets.push(this);
            if (delay) Object.defineProperty(this, "onclose", {
              set(handler) {
                closeDescriptor.set!.call(this, (event: CloseEvent) => setTimeout(() => {
                  (window as any).deliveredRoomCloses++;
                  handler?.call(this, event);
                }, delay));
              },
            });
          }
        }
      };
    }, closeDelay);
    const [a, b] = await Promise.all(contexts.map(c => c.newPage()));
    const invite = `${process.env.APP_URL || "http://127.0.0.1:4174"}/studio/${made.snapshot.design.id}#token=${encodeURIComponent(made.access.editorToken)}`;
    await Promise.all([a.goto(invite), b.goto(invite)]);
    for (const page of [a, b]) await expect(page.locator(".connection-dot.online")).toBeVisible();
    for (const [page, name] of [[a, "Alex"], [b, "Sam"]] as const) {
      await page.getByRole("button", { name: "Share", exact: true }).click();
      await page.getByLabel("Your name", { exact: true }).fill(name);
      await page.getByRole("button", { name: "Close sharing", exact: true }).click();
    }
    // Exercise a legal late-close ordering using real transports, without fake messages.
    if (closeDelay) for (const page of [a, b]) await expect.poll(() => page.evaluate(() => (window as any).deliveredRoomCloses)).toBeGreaterThan(0);
    for (const page of [a, b]) {
      await expect(page.locator(".connection-dot.online")).toBeVisible();
      await expect(page.getByTitle("Alex")).toBeVisible();
      await expect(page.getByTitle("Sam")).toBeVisible();
    }
    { await openDimensions(a); await a.getByTestId("param-diameter").fill("280"); }
    await a.getByTestId("apply-dimensions").click();
    { await openDimensions(b); await expect(b.getByTestId("param-diameter")).toHaveValue("280"); }
    // Close a real transport; no fake server messages or network responses.
    await b.evaluate(() => (window as any).roomSockets.at(-1).close());
    await expect(b.locator(".connection-dot.online")).toHaveCount(0);
    await expect(b.locator(".connection-dot.online")).toBeVisible();
    { await openDimensions(b); await b.getByTestId("param-height").fill("200"); }
    await b.getByTestId("apply-dimensions").click();
    { await openDimensions(a); await expect(a.getByTestId("param-height")).toHaveValue("200"); }
    await expect(a.locator(".connection-dot.online")).toBeVisible();
    await a.screenshot({ path: ".artifacts/collaboration-status/connected.png", fullPage: true });
    const after = await (await request.get(`/api/designs/${made.snapshot.design.id}`, { headers: { Authorization: `Bearer ${made.access.editorToken}` } })).json();
    expect(after.design.revision).toBe(2);
    expect(after.design.params).toMatchObject({ diameter: 280, height: 200, shaftDiameter: 8, rpm: 6 });
  } finally { await Promise.all(contexts.map(c => c.close())); }
});
