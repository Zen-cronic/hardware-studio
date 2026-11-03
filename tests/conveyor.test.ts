import { it, expect } from "vitest";
import { Euler, Quaternion, Vector3 } from "three";
import { createDesign, deriveDesign, readSetFor } from "../src/shared/engine";
import { motionPose } from "../src/lib/motion";
import { Store } from "../server/store";
it("new conveyors use supported geometry while legacy saved designs and forks retain their original parts", () => {
  const d = createDesign("conveyor");
  expect(d.mechanismVersion).toBe(2);
  expect(deriveDesign(d).parts.find((p) => p.id === "belt")?.loopSpan).toBe(
    440,
  );
  delete d.mechanismVersion;
  const old = deriveDesign(d);
  expect(old.parts).toHaveLength(9);
  expect(old.parts.find((p) => p.id === "belt")?.shape).toBe("box");
  const store = new Store(":memory:");
  try {
    store.insert({ design: d, derived: old, history: [] });
    const next = store.apply(d.id, {
      id: crypto.randomUUID(),
      baseRevision: 0,
      actor: "Test",
      changes: { length: 650 },
      readSet: readSetFor(d, { length: 650 }),
    });
    expect(next.design.mechanismVersion).toBeUndefined();
    expect(next.derived.parts.find((p) => p.id === "belt")?.size).toEqual([
      620, 5, 120,
    ]);
    expect(store.fork(d.id).snapshot.derived).toEqual(next.derived);
  } finally {
    store.close();
  }
});
it("dimension changes retain continuous belt, journal and sensor/gate dependencies", () => {
  for (const length of [250, 500, 653.5, 900])
    for (const beltWidth of [70, 120, 200])
      for (const sensorPosition of [30, Math.min(780, length - 70)]) {
        const d = createDesign("conveyor");
        Object.assign(d.params, { length, beltWidth, sensorPosition });
        const q = deriveDesign(d);
        const by = (id: string) => q.parts.find((p) => p.id === id)!;
        expect(q.parts).toHaveLength(102);
        expect(by("belt").loopSpan).toBe(length - 60);
        expect(by("belt").size[1]).toBe(beltWidth);
        expect(by("sensor").position[0]).toBe(-length / 2 + sensorPosition);
        expect(
          q.metrics.find((m) => m.label === "Sensor-to-gate delay")?.value,
        ).toBeCloseTo(
          Math.round(((length - 55 - sensorPosition) / d.params.speed) * 100) /
            100,
        );
        expect(
          q.bom.some((b) =>
            ["parcel", "motor-shaft", "motor-pilot", "gate-shaft"].includes(
              b.id,
            ),
          ),
        ).toBe(false);
        expect(q.bom.find((b) => b.id === "diverter")?.specification).toContain(
          "two-pack",
        );
        expect(
          q.steps.every((s) =>
            s.partIds.every((id) => q.parts.some((p) => p.id === id)),
          ),
        ).toBe(true);
      }
});
it("tilted rollers rotate about the fixed world shaft axis, without tumbling their journals", () => {
  const d = createDesign("conveyor"),
    parts = deriveDesign(d).parts;
  for (const id of ["roller-in", "roller-out", "motor-shaft", "coupling"]) {
    const p = parts.find((x) => x.id === id)!;
    for (const t of [0.25, 1, 2, 8]) {
      const pose = motionPose(p, parts, t),
        q = new Quaternion().setFromEuler(new Euler(...pose.rotation));
      const shaft = new Vector3(0, 1, 0).applyQuaternion(q);
      expect(shaft.distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-8);
      const angle = (-d.params.speed * t) / 20;
      const radial = new Vector3(1, 0, 0).applyQuaternion(q);
      expect(
        radial.distanceTo(new Vector3(Math.cos(angle), Math.sin(angle), 0)),
      ).toBeLessThan(1e-8);
    }
  }
  // Negative control: adding a Z Euler angle after the X alignment tilts the shaft.
  expect(
    new Vector3(0, 1, 0)
      .applyEuler(new Euler(Math.PI / 2, 0, 1))
      .distanceTo(new Vector3(0, 0, 1)),
  ).toBeGreaterThan(0.5);
});
it("gate blade, bolted arm and shaft rotate together around the actual attached hub", () => {
  const parts = deriveDesign(createDesign("conveyor")).parts,
    hub = parts.find((p) => p.id === "diverter")!,
    parcel = parts.find((p) => p.id === "parcel")!;
  const time = (hub.position[0] - parcel.position[0]) / parcel.motion!.speed;
  expect(motionPose(hub, parts, time).rotation[1]).toBeCloseTo(Math.PI / 3);
  for (const p of parts.filter((p) => p.parentId === "diverter")) {
    const pose = motionPose(p, parts, time);
    expect(
      new Vector3(...pose.position).distanceTo(new Vector3(...hub.position)),
    ).toBeCloseTo(
      new Vector3(...p.position).distanceTo(new Vector3(...hub.position)),
      7,
    );
  }
});
