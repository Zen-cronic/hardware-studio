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
    expect(parts.filter(p => p.id.endsWith("-plate"))).toHaveLength(1);
    for (const id of ["battery", "flight-controller", "camera-mount-left", "camera-mount-right", "camera", "camera-lens", "status-light"]) expect(parts.some(p => p.id === id)).toBe(true);
    // A low rounded body the arms tuck under, not a box stacked on top: a hollow printed shell, the battery behind it.
    const shell = parts.find(p => p.id === "body-shell")!, battery = parts.find(p => p.id === "battery")!, arm = parts.find(p => p.id === "arm-front-right")!;
    expect(shell).toMatchObject({ shape: "box", edgeRadius: 12, wall: 2, process: "print" });
    expect(shell.position[1] - shell.size[1] / 2).toBeCloseTo(arm.position[1] + arm.size[1] / 2, 6);
    expect(battery.position[0] + battery.size[0] / 2).toBeCloseTo(shell.position[0] - shell.size[0] / 2, 6);
    expect(battery.position[1] - battery.size[1] / 2).toBeCloseTo(shell.position[1] - shell.size[1] / 2, 6);
    expect(parts.find(p => p.id === "camera")).toMatchObject({ shape: "ellipsoid", size: [26, 26, 26] });
    // Bought parts, never reference envelopes: they belong in the parts list and the in-room model.
    expect(parts.filter(p => p.id.startsWith("prop-") || /^motor-(front|rear)/.test(p.id) || p.id === "battery" || p.id === "flight-controller")
      .every(p => p.process === "buy" && p.role !== "reference")).toBe(true);
    expect(deriveDesign(d).bom.some(item => /Propeller/.test(item.name))).toBe(true);
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

  it("offers ducted propellers as a variant with the same arms and motors", () => {
    const ducted = droneParts({ ducts: true }), open = droneParts();
    expect(ducted.filter(p => p.id.startsWith("duct-"))).toHaveLength(4);
    expect(open.some(p => p.id.startsWith("duct-"))).toBe(false);
    for (const id of DRONE_ARM_IDS) expect(ducted.find(p => p.id === id)).toEqual(open.find(p => p.id === id));
    const d = { ...createDesign("custom", "Camera drone", ducted), id: "ducted", createdAt: "", updatedAt: "" };
    validateDesign(d);
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
