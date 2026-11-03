import { it, expect } from "vitest";
import {
  createDesign,
  deriveDesign,
  validateDesign,
  readSetFor,
} from "../src/shared/engine";
import { productForDesign } from "../src/shared/catalog";
import { Store } from "../server/store";
it("versions supported planters without changing saved legacy ranges, edits or forks", () => {
  const d = createDesign("planter");
  expect(d.mechanismVersion).toBe(2);
  expect(
    productForDesign(d).parameters.find((p) => p.key === "reservoirHeight")
      ?.min,
  ).toBe(60);
  d.params.reservoirHeight = 40;
  expect(() => validateDesign(d)).toThrow("60");
  delete d.mechanismVersion;
  expect(() => validateDesign(d)).not.toThrow();
  const old = deriveDesign(d);
  expect(old.parts).toHaveLength(17);
  const store = new Store(":memory:");
  try {
    store.insert({ design: d, derived: old, history: [] });
    const next = store.apply(d.id, {
      id: crypto.randomUUID(),
      baseRevision: 0,
      actor: "Test",
      changes: { pots: 4 },
      readSet: readSetFor(d, { pots: 4 }),
    });
    expect(next.design.mechanismVersion).toBeUndefined();
    expect(next.derived.parts).toHaveLength(20);
    expect(store.fork(d.id).snapshot.derived).toEqual(next.derived);
  } finally {
    store.close();
  }
});
it("adds supported draining cups and dedicated open water connections through parameter extremes", () => {
  for (const pots of [1, 3, 5])
    for (const potDiameter of [60, 105.5, 150])
      for (const reservoirHeight of [60, 120]) {
        const d = createDesign("planter");
        Object.assign(d.params, { pots, potDiameter, reservoirHeight });
        const q = deriveDesign(d),
          by = (id: string) => q.parts.find((p) => p.id === id)!;
        expect(q.parts.filter((p) => /^pot-\d+$/.test(p.id))).toHaveLength(
          pots,
        );
        expect(
          q.connections.filter((c) => /^pot-\d+$/.test(c.to)),
        ).toHaveLength(pots);
        expect(by("pump").size).toEqual([23.9, 46, 23.9]);
        for (let i = 0; i < pots; i++) {
          const cup = by("pot-" + i),
            outlet = by("outlet-" + i);
          expect(cup.sections![0].bore).toBe(4);
          expect(cup.size[0]).toBe(potDiameter);
          const top = cup.position[1] + cup.size[1] / 2;
          expect(outlet.position[1] - outlet.size[1] / 2 - top).toBeCloseTo(7);
          expect(
            by("shelf").holes!.some(
              (h) =>
                h.x === cup.position[0] &&
                h.z === 0 &&
                h.diameter === potDiameter - 7,
            ),
          ).toBe(true);
        }
        expect(q.bom.some((b) => b.id === "pump-outlet")).toBe(false);
        expect(q.bom.find((b) => b.id === "pump")?.sourceUrl).toBe(
          "https://www.adafruit.com/product/4546",
        );
        expect(q.bom.every((b) => by(b.id).role !== "reference")).toBe(true);
      }
});
it("changes schedule intent without inventing flow or changing manufactured parts", () => {
  const d = createDesign("planter"),
    before = deriveDesign(d);
  d.params.waterMinutes = 20;
  const after = deriveDesign(d);
  expect(after.bom).toEqual(before.bom);
  expect(after.parts.filter((p) => p.role !== "reference")).toEqual(
    before.parts.filter((p) => p.role !== "reference"),
  );
  expect(after.parts.find((p) => p.id === "water")?.motion?.speed).toBe(1 / 3);
  expect(after.metrics.find((m) => m.label === "Daily run time")?.value).toBe(
    20,
  );
  expect(after.warnings.join(" ")).toContain("does not predict flow");
});
