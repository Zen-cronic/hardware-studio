import { afterEach, expect, it, vi } from "vitest";
import { createDesign, DesignError } from "../src/shared/engine";
import type { Part } from "../src/shared/types";
import { Store } from "../server/store";
import { propose } from "../server/proposals";
const part: Part = {
  id: "body",
  name: "Body",
  shape: "box",
  size: [20, 10, 20],
  position: [0, 5, 0],
  color: "#AABBCC",
  material: "PETG",
  process: "print",
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it.each([
  { material: "" },
  { material: "  " },
  { rotation: null },
  { rotation: 0 },
  { rotation: false },
])("rejects geometry that the CAD contract cannot export: %j", (patch) => {
  expect(() =>
    createDesign("custom", "Invalid contract", [{ ...part, ...patch } as Part]),
  ).toThrow(DesignError);
});
it("rejects a malformed part with a controlled validation error", () => {
  expect(() =>
    createDesign("custom", "Malformed", [null as unknown as Part]),
  ).toThrow(DesignError);
});
it("blocks unpriced model overrides before spending or calling a provider", async () => {
  const store = new Store(":memory:");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("OPENAI_MODEL", "unpriced-model");
  try {
    const { snapshot } = store.create("turntable");
    await expect(
      propose(
        store,
        snapshot,
        { prompt: "diameter 260", actor: "Maker" },
        "synthetic-key",
      ),
    ).rejects.toMatchObject({ code: "AI_MODEL_UNPRICED" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      store.db.prepare("SELECT COUNT(*) AS n FROM ai_usage").get(),
    ).toEqual({ n: 0 });
  } finally {
    store.close();
  }
});
it.each([
  [undefined, undefined],
  [-1, 10],
  [NaN, 1],
  [100, Infinity],
  ["100", 20],
])("keeps the reservation when usage cannot be priced: %j", (input, output) => {
  const store = new Store(":memory:");
  try {
    store.reserveAi("request");
    store.recordAi("request", input, output);
    expect(
      store.db.prepare("SELECT status,reserved,spent FROM ai_usage").get(),
    ).toEqual({ status: "unpriced", reserved: 1, spent: 0 });
  } finally {
    store.close();
  }
});

it("rejects a scale-only proposal after its source custom assembly changes", () => {
  const store = new Store(":memory:");
  try {
    const { snapshot } = store.create("custom", "Source", [part]);
    store.apply(snapshot.design.id, {
      id: "replace",
      actor: "Bea",
      baseRevision: 0,
      changes: {},
      readSet: { scale: 1 },
      customParts: [{ ...part, size: [40, 10, 40] }],
    });
    expect(() =>
      store.apply(snapshot.design.id, {
        id: "stale-scale",
        actor: "Alex",
        baseRevision: 0,
        changes: { scale: 2 },
        readSet: { scale: 1 },
      }),
    ).toThrow(/changed/);
    expect(store.get(snapshot.design.id).design.params.scale).toBe(1);
    expect(store.get(snapshot.design.id).design.customParts?.[0].size).toEqual([
      40, 10, 40,
    ]);
  } finally {
    store.close();
  }
});
