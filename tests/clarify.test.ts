import { describe, expect, it } from "vitest";
import { Store } from "../server/store";
import { propose } from "../server/proposals";
import { droneParts } from "../src/shared/drone";
import { createSelection } from "../src/shared/selection";
import { validateDesign } from "../src/shared/engine";
import { partFeatures } from "../src/shared/surface";
import { normalizeSpokenNumbers } from "../src/shared/spoken-numbers";
import { askWhichPart, clarifyCandidates, isClarification, namedFeature, resolveAnswer } from "../src/lib/clarify";

function drone() {
  const store = new Store(":memory:");
  const created = store.create("custom", "Camera drone", droneParts());
  return { store, snapshot: store.get(created.snapshot.design.id) };
}
const face = (snapshot: ReturnType<typeof drone>["snapshot"], partId: string, featureId: string) => {
  const part = snapshot.derived.parts.find(p => p.id === partId)!;
  return createSelection(snapshot, [partId], "hover", partFeatures(part).find(f => f.feature.id === featureId)!.target);
};

describe("asking which part, without the assistant", () => {
  it("asks which arm for a singular request with nothing pointed at, and not for a plural one", () => {
    const { snapshot } = drone();
    const ask = askWhichPart(snapshot, "make the arm 6 mm thick", "Maker", "q1")!;
    expect(isClarification(ask)).toBe(true);
    expect(ask.source).toBe("local");
    expect(ask.target!.partIds.sort()).toEqual(["arm-front-left", "arm-front-right", "arm-rear-left", "arm-rear-right"]);
    expect(ask.questions![0]).toBe("Which arm: front right, front left, rear left or rear right? Point at one and say this one, or say its name.");
    expect(askWhichPart(snapshot, "make the arms 6 mm thick", "Maker", "q2")).toBeNull();
    expect(askWhichPart(snapshot, "make all the arm plates 6 mm thick", "Maker", "q3")).toBeNull();
    expect(askWhichPart(snapshot, "make the battery smaller", "Maker", "q4")).toBeNull();
    // A free-form wish names no measurement: it goes to the assistant instead of a local question.
    expect(askWhichPart(snapshot, "Make room for a bigger camera", "Maker", "q5")).toBeNull();
    // Spoken number words are read as a measurement once normalised.
    expect(askWhichPart(snapshot, normalizeSpokenNumbers("make the arm six millimetres thick"), "Maker", "q6")?.questions?.[0]).toMatch(/^Which arm:/);
  });

  it("binds an answer by name, by the pointer at speech onset or by place on screen", () => {
    const { snapshot } = drone();
    const ask = askWhichPart(snapshot, "make the arm 6 mm thick", "Maker", "q1")!;
    const candidates = clarifyCandidates(snapshot, ask, "make the arm 6 mm thick");
    expect(candidates.every(c => c.featureId === "face+y")).toBe(true);
    const named = resolveAnswer(snapshot, "the front left one", candidates, null);
    expect(named).toMatchObject({ kind: "resolved", how: "words", candidate: { partId: "arm-front-left" } });
    if (named.kind === "resolved") expect(named.candidate.target.surface?.featureId).toBe("face+y");
    // Pointing at any face of the rear left arm and saying "this one" picks it, still editing its thickness.
    const pointed = resolveAnswer(snapshot, "this one", candidates, face(snapshot, "arm-rear-left", "face+z"));
    expect(pointed).toMatchObject({ kind: "resolved", how: "pointer", candidate: { partId: "arm-rear-left" } });
    if (pointed.kind === "resolved") expect(pointed.candidate.target.surface?.featureId).toBe("face+y");
    const xs: Record<string, number> = { "arm-front-right": 600, "arm-front-left": 300, "arm-rear-left": 120, "arm-rear-right": 450 };
    expect(resolveAnswer(snapshot, "the left one", candidates, null, c => ({ x: xs[c.partId], y: 100 })))
      .toMatchObject({ kind: "resolved", how: "screen", candidate: { partId: "arm-rear-left" } });
    expect(resolveAnswer(snapshot, "um", candidates, null)).toMatchObject({ kind: "unclear" });
    expect(resolveAnswer(snapshot, "never mind", candidates, null)).toEqual({ kind: "cancel" });
  });
});

describe("a named-feature conflict is answered without the assistant", () => {
  it("lists the named holes, then a spoken answer yields a measured edit with no assistant call", async () => {
    const { store, snapshot } = drone();
    const top = face(snapshot, "arm-front-right", "face+y");
    const request = "make this hole 4 mm";
    expect(namedFeature(request)).toEqual({ noun: "hole", holeNumbers: [] });
    const question = await propose(store, snapshot, { prompt: request, actor: "Maker", selection: top }, "");
    expect(isClarification(question)).toBe(true);
    expect(question.source).toBe("local");
    expect(question.target).toMatchObject({ partIds: ["arm-front-right"], featureId: "face+y" });
    const candidates = clarifyCandidates(snapshot, question, request);
    expect(candidates.map(c => c.featureId)).toEqual(["hole-0", "hole-1", "hole-2", "hole-3", "hole-4"]);
    const byNumber = resolveAnswer(snapshot, "hole 3", candidates, null);
    expect(byNumber).toMatchObject({ kind: "resolved", candidate: { featureId: "hole-2" } });
    // "This one" while pointing at hole 5 binds the pointer's own hole.
    const answer = resolveAnswer(snapshot, "this one", candidates, face(snapshot, "arm-front-right", "hole-4"));
    expect(answer).toMatchObject({ kind: "resolved", how: "pointer", candidate: { featureId: "hole-4" } });
    if (answer.kind !== "resolved") throw new Error("unresolved");
    const resolved = await propose(store, snapshot, { prompt: request, actor: "Maker", selection: answer.candidate.target }, "");
    expect(resolved.source).toBe("local");
    expect(resolved.questions).toEqual([]);
    expect(resolved.command.customParts!.find(p => p.id === "arm-front-right")!.holes![4].diameter).toBe(4);
    expect((store.db.prepare("SELECT COUNT(*) AS n FROM ai_usage").get() as { n: number }).n).toBe(0);
  });
});

describe("demo requests decided locally", () => {
  it("moves all four drone arms together for an explicit thickness or a stiffer request", async () => {
    const { store, snapshot } = drone();
    const top = face(snapshot, "arm-front-right", "face+y");
    for (const [prompt, expected] of [["make these arms 6 mm thick", "All 4 arms go from 4 mm to 6 mm thick. Length, width and holes stay the same."],
      ["Make these arms stiffer", "All 4 arms go from 4 mm to 6 mm thick. A thicker arm bends less under the same load. Length, width and holes stay the same. Check it before you apply it."],
      ["make all 4 arms 6 mm thick", undefined]] as const) {
      const result = await propose(store, snapshot, { prompt, actor: "Maker", selection: top }, "");
      expect(result.source).toBe("local");
      if (expected) expect(result.explanation).toBe(expected);
      expect(result.target).toEqual({ partIds: ["arm-front-right", "arm-front-left", "arm-rear-left", "arm-rear-right"], label: "4 arms" });
      const changed = result.command.customParts!.filter((p, i) => JSON.stringify(p) !== JSON.stringify(snapshot.design.customParts![i]));
      expect(changed.map(p => p.id).sort()).toEqual(["arm-front-left", "arm-front-right", "arm-rear-left", "arm-rear-right"]);
      expect(changed.every(p => p.size[1] === 6 && p.size[0] === 109 && p.size[2] === 14 && p.holes!.length === 5)).toBe(true);
      validateDesign({ ...snapshot.design, customParts: result.command.customParts }); // The proposal applies as is.
    }
    // One arm, pointed at, stays a one-part edit.
    const fresh = drone();
    const single = await propose(fresh.store, fresh.snapshot, { prompt: "make this arm 6 mm thick", actor: "Maker", selection: face(fresh.snapshot, "arm-front-right", "face+y") }, "");
    expect(single.target?.partIds).toEqual(["arm-front-right"]);
    expect((store.db.prepare("SELECT COUNT(*) AS n FROM ai_usage").get() as { n: number }).n).toBe(0);
  });

  it("reads spoken number words on the server before the local rules", async () => {
    const { store, snapshot } = drone();
    const top = face(snapshot, "arm-front-right", "face+y");
    const group = await propose(store, snapshot, { prompt: "make these arms six millimetres thick", actor: "Maker", selection: top }, "");
    expect(group).toMatchObject({ source: "local", target: { label: "4 arms" } });
    const single = await propose(store, snapshot, { prompt: "make this arm five point five millimeters thick", actor: "Maker", selection: top }, "");
    expect(single.source).toBe("local");
    expect(single.command.customParts!.find(p => p.id === "arm-front-right")!.size[1]).toBe(5.5);
    expect((store.db.prepare("SELECT COUNT(*) AS n FROM ai_usage").get() as { n: number }).n).toBe(0);
  });

  it("asks which hole on the camera arm link, then 'this one' sets that hole without the assistant", async () => {
    const store = new Store(":memory:");
    const created = store.create("custom", "Articulated camera arm", (await import("../src/shared/desk-arm")).deskArmParts());
    const snapshot = store.get(created.snapshot.design.id);
    const request = "make the hole 8 mm";
    const question = await propose(store, snapshot, { prompt: request, actor: "Maker", selection: face(snapshot, "upper-arm", "face+y") }, "");
    expect(question).toMatchObject({ source: "local", explanation: "Upper arm link has 2 holes.", questions: ["Which hole? Point at it and say this one, or say the left one or the right one."] });
    const candidates = clarifyCandidates(snapshot, question, request);
    expect(candidates.map(c => c.featureId)).toEqual(["hole-0", "hole-1"]);
    const answer = resolveAnswer(snapshot, "this one", candidates, face(snapshot, "upper-arm", "hole-0"));
    if (answer.kind !== "resolved") throw new Error("unresolved");
    const resolved = await propose(store, snapshot, { prompt: request, actor: "Maker", selection: answer.candidate.target }, "");
    expect(resolved.source).toBe("local");
    expect(resolved.target?.label).toBe("Upper arm link, Ø6.4 mm hole 1");
    expect(resolved.command.customParts!.find(p => p.id === "upper-arm")!.holes![0].diameter).toBe(8);
    expect((store.db.prepare("SELECT COUNT(*) AS n FROM ai_usage").get() as { n: number }).n).toBe(0);
  });
});
