import { expect, test, type Page } from "@playwright/test";
import { ARM, ARM_TOP, open, pointAt, say, speak, spoken } from "./voice-tools";

// The click-to-talk mic sends what it hears by itself, with the same target rule as hold-to-talk:
// the part under the pointer at speech onset, else the selected part, else the whole design.
const mic = (page: Page) => page.getByRole("button", { name: "Speak an instruction", exact: true });
/** Clicks the mic and waits for the mocked recognizer to report that it started (it does so on a timer). */
async function listen(page: Page) {
  await mic(page).click();
  await expect(page.getByRole("button", { name: "Stop listening", exact: true })).toBeVisible();
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
}
function proposeRequests(page: Page) {
  const sent: any[] = [];
  page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/propose")) sent.push(r.postDataJSON()); });
  return sent;
}

test("the mic sends a request about the selected part without pressing Enter", async ({ page, request }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await open(page, request);
  const sent = proposeRequests(page);
  await page.getByLabel("Choose a part from the list", { exact: true }).click();
  await page.getByRole("button", { name: "Arm, front right", exact: true }).click();
  const feature = page.getByTestId("pointed-feature");
  for (let i = 0; i < 12 && (await feature.textContent()) !== "top face"; i++) await page.getByRole("button", { name: "Next feature", exact: true }).click();
  await expect(feature).toHaveText("top face");

  await listen(page);
  await speak(page, "speech");
  await expect(page.getByTestId("voice-status")).toHaveText("Listening about Arm, front right, top face.");
  await speak(page, "final", "make this 6 mm thick");

  const card = page.getByRole("region", { name: "Proposed change" });
  await expect(card).toContainText("Arm, front right: 4 → 6 mm thick");
  await expect(page.getByTestId("proposal-target")).toHaveText("Applied to: Arm, front right, top face");
  await expect(page.getByTestId("design-prompt")).toHaveValue("make this 6 mm thick");
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ prompt: "make this 6 mm thick", selection: { partIds: [ARM], surface: { featureId: "face+y" } } });
  await expect.poll(() => spoken(page)).toContain("Arm, front right: 4 to 6 millimetres thick.");
  expect(errors).toEqual([]);
});

test("\"make this 6 mm thick\" with nothing pointed at or selected asks which part, and the next words answer it", async ({ page, request }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await open(page, request);
  const sent = proposeRequests(page);
  await page.mouse.move(5, 5);
  await listen(page);
  await speak(page, "speech");
  await expect(page.getByTestId("voice-status")).toHaveText("Talking about the whole design.");
  await speak(page, "final", "make this 6 mm thick");

  // The question is on the change card, in the assistant bar and read aloud; nothing is sent yet.
  const card = page.getByRole("region", { name: "Proposed change" });
  await expect(card).toContainText("Nothing was pointed at or selected.");
  await expect(card).toContainText("Which part do you mean? Point at it and say this one, or say its name.");
  await expect(page.getByTestId("agent-reply")).toHaveText("Nothing was pointed at or selected. Which part do you mean?");
  await expect.poll(() => spoken(page)).toContain("Which part do you mean?");
  await expect(page.getByTestId("voice-status")).toHaveText("Hold Space or the mic and answer the question aloud.");
  await expect(mic(page)).toBeEnabled();
  expect(sent).toHaveLength(0);

  // Pointing at the arm's top face and saying "this one" answers it. The clicked mic keeps keyboard
  // focus, where Space would press it, so focus leaves it first.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await pointAt(page, ARM, "face+y", ARM_TOP);
  await say(page, "this one");
  await expect(card).toContainText("Arm, front right: 4 → 6 mm thick");
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ prompt: "make this 6 mm thick. this one", selection: { partIds: [ARM], surface: { featureId: "face+y" } } });
  expect(errors).toEqual([]);
});

test("the mic sends a whole-design request when nothing is pointed at or selected", async ({ page, request }) => {
  const created = await open(page, request);
  let sent: any;
  // SYNTHETIC assistant reply in the shape the provider path returns; no request leaves the machine.
  await page.route("**/propose", async route => {
    sent = route.request().postDataJSON();
    const parts = structuredClone(created.snapshot.design.customParts);
    parts.find((p: any) => p.id === "camera").size = [22, 22, 22];
    await route.fulfill({ json: { source: "ai", questions: [], explanation: "The camera is now 22 mm across. Nothing else changes.",
      command: { id: "synthetic-camera", baseRevision: 0, actor: "Maker", changes: {}, readSet: created.snapshot.design.params, customParts: parts, summary: "Make room for a bigger camera" } } });
  });
  await page.mouse.move(5, 5);
  await listen(page);
  await speak(page, "speech");
  await expect(page.getByTestId("voice-status")).toHaveText("Talking about the whole design.");
  await speak(page, "final", "Make room for a bigger camera");
  await expect(page.getByRole("region", { name: "Proposed change" })).toContainText("The camera is now 22 mm across.");
  expect(sent.prompt).toBe("Make room for a bigger camera");
  expect(sent.selection).toBeUndefined();
  await expect.poll(async () => (await spoken(page)).join(" ")).toContain("The camera is now 22 millimetres across.");
});

test("saying stop to the mic sends nothing, and closes an open question", async ({ page, request }) => {
  await open(page, request);
  const sent = proposeRequests(page);
  const card = page.getByRole("region", { name: "Proposed change" });
  await page.mouse.move(5, 5);
  await listen(page); await speak(page, "speech"); await speak(page, "final", "stop");
  await expect(mic(page)).toBeEnabled();
  await expect(card).toHaveCount(0);
  await listen(page); await speak(page, "speech"); await speak(page, "final", "make it nicer");
  await expect(card).toContainText("Which part do you mean?");
  await listen(page); await speak(page, "speech"); await speak(page, "final", "stop");
  await expect(card).toHaveCount(0);
  expect(sent).toHaveLength(0);
});
