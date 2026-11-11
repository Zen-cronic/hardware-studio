import { afterEach, expect, test, vi } from "vitest";
import { Store } from "../server/store";
import { noChangeExplanation, propose } from "../server/proposals";
import { droneParts } from "../src/shared/drone";

// An assistant reply that holds no change must never read as if something changed.
afterEach(() => vi.unstubAllGlobals());
const reply = (proposal: unknown) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(proposal) }] }], usage: { input_tokens: 0, output_tokens: 0 } });
async function ask(answer: unknown) {
  const store = new Store(":memory:");
  try {
    const { snapshot } = store.create("custom", "Camera drone", droneParts());
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/input_tokens") ? { input_tokens: 1000 } : reply(answer)), { status: 200 })));
    const proposal = await propose(store, snapshot, { prompt: "request", actor: "Owner" }, "test-credential");
    return { proposal, snapshot };
  } finally { store.close(); }
}

test("a reply that claims a change it did not make says no change was made", async () => {
  const { proposal } = await ask({ changes: {}, customParts: [], partChanges: null, explanation: "Removed every part from the design.", questions: [] });
  expect(proposal.explanation).toBe("No change was made.");
  expect(proposal.command.changes).toEqual({});
  expect(proposal.command.customParts).toBeUndefined();
  // The studio's own follow-up still asks what to change.
  expect(proposal.questions).toEqual(["What dimensions or behavior would you like to change?"]);
});

test("a reply that explains a limit keeps that explanation after the no-change line", async () => {
  const { proposal } = await ask({ changes: {}, partChanges: null, explanation: "I can change sizes and positions but not materials.", questions: [] });
  expect(proposal.explanation).toBe("No change was made. I can change sizes and positions but not materials.");
  // The materials reply from a real run: the sentence describing the unmade change is dropped.
  expect(noChangeExplanation("The proposed change is aluminium for all four arms, keeping their dimensions, positions and holes unchanged. This edit format does not support material-only changes, so no changes have been applied."))
    .toBe("No change was made. This edit format does not support material-only changes, so no changes have been applied.");
  expect(noChangeExplanation("I can't delete parts. Removed every part from the design.")).toBe("No change was made. I can't delete parts.");
  expect(noChangeExplanation("Made the arms 3.2 mm thicker.")).toBe("No change was made.");
  expect(noChangeExplanation(undefined)).toBe("No change was made.");
});

test("a reply with a change or a question of its own is left as it is", async () => {
  const [x, , z] = droneParts().find(p => p.id === "arm-front-right")!.size, update = { id: "arm-front-right", size: [x, 6, z] };
  const changed = await ask({ changes: {}, partChanges: [update], explanation: "The front right arm is now 6 mm thick.", questions: [] });
  expect(changed.proposal.explanation).toBe("The front right arm is now 6 mm thick.");
  expect(changed.proposal.command.customParts!.find(p => p.id === "arm-front-right")!.size[1]).toBe(6);
  const question = await ask({ changes: {}, partChanges: null, explanation: "Removed every part from the design.", questions: ["Which parts should go?"] });
  expect(question.proposal.explanation).toBe("Removed every part from the design.");
  expect(question.proposal.questions).toEqual(["Which parts should go?"]);
});
