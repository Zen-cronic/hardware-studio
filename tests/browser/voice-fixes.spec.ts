import { expect, test } from "@playwright/test";
import { droneParts } from "../../src/shared/drone";
import { open, say, spoken } from "./voice-tools";

// Voice edges: Space without speech recognition, typed requests after a spoken one, "stop",
// and the speaking state when nothing can be spoken.

test("without speech recognition, Space shows the dock hint and no error", async ({ page, request }) => {
  await page.addInitScript(() => { delete (window as any).SpeechRecognition; delete (window as any).webkitSpeechRecognition; });
  const created = await (await request.post("/api/designs", { data: { kind: "custom", name: "Camera drone", customParts: droneParts() } })).json();
  await page.goto(`/studio/${created.snapshot.design.id}#token=${encodeURIComponent(created.access.editorToken)}`);
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.down("Space"); await page.keyboard.up("Space");
  await expect(page.getByTestId("agent-reply")).toHaveText("Voice needs a browser with speech recognition. You can type instead.");
  await expect(page.getByTestId("agent-dock")).toHaveAttribute("data-phase", "idle");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a typed request after a spoken one that made no proposal is not read aloud", async ({ page, request }) => {
  await open(page, request);
  // Nothing pointed at and "it" in the words: the studio asks for a target, no proposal.
  await say(page, "make it nicer");
  await expect(page.getByText("No part was targeted.", { exact: false })).toBeVisible();
  const before = (await spoken(page)).length;
  const prompt = page.getByTestId("design-prompt");
  await prompt.fill("");
  await prompt.pressSequentially("Make the battery longer");
  await page.getByTestId("propose-change").click();
  await expect(page.getByRole("region", { name: "Proposed change" })).toBeVisible();
  await page.waitForTimeout(500);
  expect((await spoken(page)).length).toBe(before);
});

test("saying stop while a question is read stops it, closes the question and sends nothing", async ({ page, request }) => {
  await open(page, request);
  // A long reading: each line lasts until it is cancelled.
  await page.evaluate(() => {
    const w = window as any, synth = w.speechSynthesis;
    synth.speak = (u: any) => { w.__spoken.push(u.text); w.__pending = [...(w.__pending || []), u]; setTimeout(() => u.onstart?.(), 10); };
    synth.cancel = () => { const queued = w.__pending || []; w.__pending = []; for (const u of queued) u.onend?.(); };
  });
  const agent = page.locator('[data-companion="agent"]').first();
  // Nothing pointed at, one of four arms: the studio asks which arm and reads the question.
  await say(page, "make the arm 6 mm thick");
  await expect(page.getByRole("region", { name: "Proposed change" })).toContainText("Which arm");
  await expect(agent).toHaveClass(/is-speaking/);
  const requests: string[] = [];
  page.on("request", r => { if (r.method() === "POST" && r.url().includes("/propose")) requests.push(r.url()); });
  await say(page, "stop");
  await expect(agent).not.toHaveClass(/is-speaking/);
  await expect(page.getByRole("region", { name: "Proposed change" })).toHaveCount(0);
  expect(requests).toEqual([]);
});
