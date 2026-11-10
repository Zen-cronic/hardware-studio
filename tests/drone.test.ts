import { describe, expect, it } from "vitest";
import { Euler, Vector3 } from "three";
import { createDesign, deriveDesign, validateDesign } from "../src/shared/engine";
import { DRONE_ARM_IDS, DRONE_ARM_THICKNESS_MM, DRONE_WHEELBASE_MM, droneParts, withDroneArmThickness } from "../src/shared/drone";
import { applySemanticEdit, createSelection } from "../src/shared/selection";
import { partFeatures } from "../src/shared/surface";

const design = () => ({ ...createDesign("custom", "Camera drone", droneParts()), id: "drone", createdAt: "", updatedAt: "" });

describe("camera drone starter", () => {
  it("is a valid editable custom design with the declared parts", () => {
    const d = design();
    validateDesign(d);
    const parts = deriveDesign(d).parts;
    const count = (prefix: string) => parts.filter(p => p.id.startsWith(prefix)).length;
    expect(count("arm-")).toBe(4);
    expect(count("motor-mount-")).toBe(4);
    expect(parts.filter(p => /^motor-(front|rear)/.test(p.id))).toHaveLength(4);
    expect(count("prop-")).toBe(4);
    expect(count("leg-")).toBe(4);
    expect(parts.filter(p => p.id.endsWith("-plate"))).toHaveLength(2);
    for (const id of ["battery", "flight-controller", "camera-mount-left", "camera-mount-right"]) expect(parts.some(p => p.id === id)).toBe(true);
    expect(parts.filter(p => p.id.startsWith("prop-")).every(p => p.role === "reference")).toBe(true);
    expect(parts.filter(p => /^motor-(front|rear)/.test(p.id) || p.id === "battery" || p.id === "flight-controller").every(p => p.process === "buy")).toBe(true);
  });

  it("places four motors on a 250 mm wheelbase, with arms on the diagonals pointing at them", () => {
    const parts = droneParts();
    const motors = parts.filter(p => /^motor-(front|rear)/.test(p.id));
    const diagonal = Math.hypot(motors[0].position[0] - motors[2].position[0], motors[0].position[2] - motors[2].position[2]);
    expect(diagonal).toBeCloseTo(DRONE_WHEELBASE_MM, 0);
    for (const id of DRONE_ARM_IDS) {
      const arm = parts.find(p => p.id === id)!;
      expect(arm.size[1]).toBe(DRONE_ARM_THICKNESS_MM);
      expect(Math.abs(arm.rotation![1]) % (Math.PI / 2)).toBeCloseTo(Math.PI / 4, 6);
      // The motor sits over the arm's middle motor hole.
      const tipHole = arm.holes!.find(h => h.diameter === 7)!;
      const world = new Vector3(tipHole.x, 0, tipHole.z).applyEuler(new Euler(...arm.rotation!)).add(new Vector3(...arm.position));
      const motor = motors.find(m => m.id === id.replace("arm-", "motor-"))!;
      expect(world.x).toBeCloseTo(motor.position[0], 1);
      expect(world.z).toBeCloseTo(motor.position[2], 1);
      // Every hole is a pointable feature of the arm.
      expect(partFeatures(arm).filter(f => f.feature.kind === "hole")).toHaveLength(5);
    }
  });

  it("thickens the arms 4 to 6 mm through a spoken-style edit and through the version helper", () => {
    const d = design();
    const snapshot = { design: d, derived: deriveDesign(d), history: [], role: "editor" as const };
    const selection = createSelection(snapshot, ["arm-front-right"], "click");
    const preview = applySemanticEdit(snapshot, selection, { type: "dimension", axis: "y", value: 6 });
    expect(preview.command.customParts!.find(p => p.id === "arm-front-right")!.size).toEqual([109, 6, 14]);
    const thick = withDroneArmThickness(d.customParts!, 6);
    validateDesign({ ...d, customParts: thick });
    expect(thick.filter(p => (DRONE_ARM_IDS as readonly string[]).includes(p.id)).map(p => p.size[1])).toEqual([6, 6, 6, 6]);
  });
});
