import { describe, expect, it } from "vitest";
import { Store } from "../server/store";
import { propose } from "../server/proposals";
import { droneParts } from "../src/shared/drone";
import { deskArmParts } from "../src/shared/desk-arm";
import { createSelection } from "../src/shared/selection";
import { partFeatures } from "../src/shared/surface";
import { clarifyCandidates, isClarification, namedFeature } from "../src/lib/clarify";
import { localGroupEdit } from "../src/shared/group-edit";
import type { Part, Snapshot } from "../src/shared/types";

// Requests the local rules decide without the assistant: each case here was once decided wrongly.

function design(parts: Part[], name = "Design") {
  const store = new Store(":memory:");
  const created = store.create("custom", name, parts);
  return { store, snapshot: store.get(created.snapshot.design.id) };
}
const face = (snapshot: Snapshot, partId: string, featureId: string) => {
  const part = snapshot.derived.parts.find(p => p.id === partId)!;
  return createSelection(snapshot, [partId], "hover", partFeatures(part).find(f => f.feature.id === featureId)!.target);
};
const sizeOf = (parts: Part[] | undefined, id: string) => parts!.find(p => p.id === id)!.size;
const aiCalls = (store: Store) => (store.db.prepare("SELECT COUNT(*) AS n FROM ai_usage").get() as { n: number }).n;

describe("group thickness edits", () => {
  it("adds to or takes from the current thickness for a relative request", async () => {
    const { store, snapshot } = design(droneParts(), "Camera drone");
    const top = face(snapshot, "arm-front-left", "face+y");
    for (const [prompt, mm] of [["make these arms 2 mm thicker", 6], ["make all the arms 1 mm thinner", 3], ["make the arms thicker by 2 mm", 6],
      ["make these arms two millimetres thicker", 6], ["make these arms thicker, to 7 mm", 7]] as const) {
      const result = await propose(store, snapshot, { prompt, actor: "Maker", selection: top }, "");
      expect(result.source, prompt).toBe("local");
      expect(sizeOf(result.command.customParts, "arm-rear-right")[1], prompt).toBe(mm);
    }
    expect(aiCalls(store)).toBe(0);
  });

  it("treats every arm, each arm and all the arms as the group", async () => {
    const { store, snapshot } = design(droneParts(), "Camera drone");
    const top = face(snapshot, "arm-front-left", "face+y");
    for (const prompt of ["make every arm 6 mm thick", "make each arm 6 mm thick", "make all the arms 6 mm thick"]) {
      const result = await propose(store, snapshot, { prompt, actor: "Maker", selection: top }, "");
      expect(result.target?.label, prompt).toBe("4 arms");
    }
  });

  it("changes the thin side of parts that are thin along X or Z, not their height", async () => {
    const { store, snapshot } = design(droneParts(), "Camera drone");
    const cheek = face(snapshot, "camera-mount-left", "face+y");
    // The cheeks are thin along Z (a 3 mm wall); their length and height stay as they are.
    const [x, y, z] = sizeOf(snapshot.design.customParts, "camera-mount-left");
    expect(z).toBeLessThan(Math.min(x, y));
    const thick = await propose(store, snapshot, { prompt: "make these mounts 5 mm thick", actor: "Maker", selection: cheek }, "");
    expect(thick.source).toBe("local");
    expect(sizeOf(thick.command.customParts, "camera-mount-left")).toEqual([x, y, 5]);
    expect(sizeOf(thick.command.customParts, "camera-mount-right")).toEqual([x, y, 5]);
    const stiffer = await propose(store, snapshot, { prompt: "make both mounts stiffer", actor: "Maker", selection: cheek }, "");
    expect(sizeOf(stiffer.command.customParts, "camera-mount-left")).toEqual([x, y, Math.round(z * 1.5 * 2) / 2]);

    const panel = (id: string, x: number): Part => ({ id, name: `Side panel, ${id}`, shape: "box", size: [3, 60, 80], position: [x, 30, 0], color: "#808080", material: "PETG", process: "print" });
    const panels = design([panel("left", -50), panel("right", 50)]);
    const result = localGroupEdit(panels.snapshot, "make these panels 5 mm thick", { partId: "left" })!;
    expect(sizeOf(result.customParts, "left")).toEqual([5, 60, 80]);
    expect(sizeOf(result.customParts, "right")).toEqual([5, 60, 80]);
  });

  it("reads part names with brackets and signs without failing", async () => {
    const shelf = (id: string, name: string, y: number): Part => ({ id, name, shape: "box", size: [100, 4, 20], position: [0, y, 0], color: "#808080", material: "PETG", process: "print" });
    for (const name of ["Shelf (left side)", "Arm (front left)", "Plate +", "Bracket [a]"]) {
      const { store, snapshot } = design([shelf("a", name, 2), shelf("b", "Other", 20)]);
      const result = await propose(store, snapshot, { prompt: "make this 6 mm thick", actor: "Maker", selection: face(snapshot, "a", "face+y") }, "");
      expect(sizeOf(result.command.customParts, "a")[1], name).toBe(6);
    }
  });
});

describe("spoken and typed numbers on the server", () => {
  it("keeps a typed minus sign for a catalog value", async () => {
    const store = new Store(":memory:");
    const snapshot = store.get(store.create("holder").snapshot.design.id);
    const result = await propose(store, snapshot, { prompt: "set the work angle to -20", actor: "Maker" }, "");
    expect(result.command.changes.angle).toBe(-20);
  });

  it("keeps a leading point and the diameter mark when pointing at a feature", async () => {
    const { store, snapshot } = design(deskArmParts(), "Arm");
    const thin = await propose(store, snapshot, { prompt: "make this 0.8 mm thick", actor: "Maker", selection: face(snapshot, "upper-arm", "face+y") }, "");
    const dot = await propose(store, snapshot, { prompt: "make this .8 mm thick", actor: "Maker", selection: face(snapshot, "upper-arm", "face+y") }, "");
    expect(sizeOf(thin.command.customParts, "upper-arm")[1]).toBe(0.8);
    // ".8" is never read as 8 mm: it is either 0.8 mm or a question.
    expect(dot.command.customParts?.find(p => p.id === "upper-arm")?.size[1] ?? 0.8).toBe(0.8);
    const diameter = await propose(store, snapshot, { prompt: "make this hole Ø8", actor: "Maker", selection: face(snapshot, "upper-arm", "hole-0") }, "");
    expect(diameter.explanation).not.toMatch(/hole 8/);
    expect(diameter.command.customParts?.find(p => p.id === "upper-arm")?.holes?.[0].diameter).toBe(8);
  });

  it("leaves counts and weights in words, so they are never read as millimetres or hole numbers", async () => {
    const { store, snapshot } = design(deskArmParts(), "Arm");
    const hole = face(snapshot, "upper-arm", "hole-0"), top = face(snapshot, "upper-arm", "face+y");
    const end = await propose(store, snapshot, { prompt: "make the hole at one end bigger", actor: "Maker", selection: hole }, "");
    expect(end.command.customParts).toBeUndefined();
    const eight = await propose(store, snapshot, { prompt: "make this hole eight", actor: "Maker", selection: hole }, "");
    expect(eight.explanation).not.toMatch(/hole 8/);
    expect(eight.command.customParts).toBeUndefined();
    const kilos = await propose(store, snapshot, { prompt: "make this thicker so it can carry two kilos", actor: "Maker", selection: top }, "");
    expect(kilos.command.customParts).toBeUndefined();
  });
});

describe("which hole", () => {
  it("offers every hole as an answer for a size with a decimal point", () => {
    expect(namedFeature("make the hole 4.5 mm")).toEqual({ noun: "hole", holeNumbers: [] });
    expect(namedFeature("make hole 4 5 mm wide")?.holeNumbers).toEqual([4]);
  });

  it("asks which hole only when the request has answers, and never for several holes", async () => {
    const { store, snapshot } = design(droneParts(), "Camera drone");
    const top = face(snapshot, "arm-front-left", "face+y");
    for (const prompt of ["make the hole 4.5 mm", "make hole 8 mm", "make the hole 3.2 mm"]) {
      const question = await propose(store, snapshot, { prompt, actor: "Maker", selection: top }, "");
      expect(question.questions?.[0], prompt).toMatch(/^Which hole\?/);
      const candidates = clarifyCandidates(snapshot, question, prompt);
      expect(candidates.length, prompt).toBe(snapshot.design.customParts!.find(p => p.id === "arm-front-left")!.holes!.length);
    }
    for (const prompt of ["make all the holes on this arm 3.5 mm", "make both holes 4 mm", "make these holes 3 mm"]) {
      const result = await propose(store, snapshot, { prompt, actor: "Maker", selection: top }, "");
      expect(result.questions?.[0] ?? "", prompt).not.toMatch(/^Which hole\?/);
      if (isClarification(result)) expect(result.source).toBe("local");
    }
  });
});
