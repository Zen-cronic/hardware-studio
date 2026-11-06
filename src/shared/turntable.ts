import type { Part, DerivedDesign } from "./types";

// Nominal reference interfaces. Supplier models are clearance envelopes, not replicas.
export function standardTurntable(
  p: Record<string, number>,
): Omit<DerivedDesign, "bom"> {
  const h = p.height,
    base = Math.max(110, p.diameter * 0.78),
    postR = base / 2 - 8;
  const parts: Part[] = [];
  const round = (
    id: string,
    name: string,
    od: number,
    bore: number,
    height: number,
    bottom: number,
    process: Part["process"] = "machine",
    material = "Aluminium",
    x = 0,
    z = 0,
  ): Part => {
    const part: Part = {
      id,
      name,
      shape: bore ? "tube" : "cylinder",
      size: [od, height, od],
      position: [x, bottom + height / 2, z],
      ...(bore ? { holeDiameter: bore } : {}),
      process,
      material,
      color: process === "buy" ? "#353841" : "#C8CDD1",
    };
    parts.push(part);
    return part;
  };
  const pattern = (
    radius: number,
    count: number,
    diameter: number,
    offset = 0,
  ) =>
    Array.from({ length: count }, (_, i) => ({
      x: Math.cos((i * 2 * Math.PI) / count + offset) * radius,
      z: Math.sin((i * 2 * Math.PI) / count + offset) * radius,
      diameter,
    }));
  const tieHoles = pattern(postR, 3, 4.5);
  const bearingHoles = pattern(15, 3, 3.4, Math.PI / 3);
  const spin = (part: Part) => {
    part.motion = { type: "rotate", axis: "y", speed: p.rpm };
    return part;
  };
  const bolt = (
    id: string,
    diameter: number,
    length: number,
    top: number,
    x: number,
    z: number,
  ) => {
    // Threadless nominal shank and head; nuts are separate envelope parts.
    round(
      id,
      `M${diameter} × ${length} screw shank envelope`,
      diameter,
      0,
      length,
      top - length,
      "buy",
      "Steel",
      x,
      z,
    );
    round(
      id + "-head",
      `M${diameter} screw head envelope`,
      diameter * 2,
      0,
      diameter,
      top,
      "buy",
      "Steel",
      x,
      z,
    );
  };
  const floor = round("base-floor", "Base plate", base, 0, 4, 0);
  floor.holes = tieHoles;
  const motorPlate = round(
    "motor-plate",
    "Motor mounting plate",
    base,
    12.5,
    4,
    h - 97,
  );
  motorPlate.holes = [...tieHoles, ...pattern(15.5, 6, 3.4)];
  round(
    "motor",
    "Pololu 4756 motor body envelope",
    37,
    0,
    73,
    h - 170,
    "buy",
    "12 V encoded gearmotor",
  );
  round(
    "motor-pilot",
    "Motor pilot envelope",
    12,
    6,
    1.6,
    h - 97,
    "buy",
    "Integral motor feature",
  );
  spin(
    round(
      "motor-shaft",
      "6 mm D-shaft clearance envelope",
      6,
      0,
      16,
      h - 97,
      "buy",
      "Integral motor feature",
    ),
  );
  pattern(15.5, 6, 3).forEach((q, i) =>
    bolt(`motor-screw-${i}`, 3, 6, h - 93, q.x, q.z),
  );
  const coupling = spin(
    round(
      "coupling",
      "Ruland PCMR25-8-6-SS clearance envelope",
      31.8,
      6,
      31.8,
      h - 89,
      "buy",
      "Stainless coupling",
    ),
  );
  coupling.sections = [
    { height: 14.7, diameter: 31.8, bore: 6 },
    { height: 17.1, diameter: 31.8, bore: 8 },
  ];
  // One turned spindle and flange, so torque transfer does not depend on an unmodelled hub screw.
  const spindle = spin(
    round(
      "shaft",
      "One-piece 8 mm spindle and platter flange",
      40,
      0,
      85,
      h - 70,
      "machine",
      "Steel",
    ),
  );
  spindle.sections = [
    { height: 80, diameter: 8, bore: 0 },
    { height: 5, diameter: 40, bore: 0 },
  ];
  spindle.holes = bearingHoles;
  for (const [label, bottom] of [
    ["lower", h - 42],
    ["upper", h - 14],
  ] as const) {
    const shoulder = round(
      `${label}-support`,
      `${label} bearing shoulder plate`,
      base,
      18,
      3,
      bottom - 3,
    );
    shoulder.holes = [...tieHoles, ...bearingHoles];
    const seat = round(
      `${label}-seat`,
      `${label} 608 bearing seat`,
      36,
      22.1,
      7,
      bottom,
    );
    seat.holes = bearingHoles;
    round(
      `${label}-bearing`,
      `${label} 608 bearing envelope (8 × 22 × 7)`,
      22,
      8,
      7,
      bottom,
      "buy",
      "Bearing steel",
    );
    const retainer = round(
      `${label}-retainer`,
      `${label} outer-race retaining plate`,
      36,
      18,
      3,
      bottom + 7,
    );
    retainer.holes = bearingHoles;
    bearingHoles.forEach((q, i) => {
      bolt(`${label}-screw-${i}`, 3, 16, bottom + 10, q.x, q.z);
      round(
        `${label}-nut-${i}`,
        "M3 nut envelope",
        6,
        3,
        3,
        bottom - 6,
        "buy",
        "Steel",
        q.x,
        q.z,
      );
    });
  }
  spin(
    round("lower-inner-spacer", "Lower inner-race spacer", 11, 8.1, 4, h - 46),
  );
  spin(
    round(
      "collar",
      "Ruland MCL-8-A clamp clearance envelope",
      22.4,
      8,
      9,
      h - 55,
      "buy",
      "Aluminium collar",
    ),
  );
  spin(
    round("upper-inner-spacer", "Upper inner-race spacer", 11, 8.1, 17, h - 7),
  );
  const platter = spin(
    round("platter", "Rotating platter", p.diameter, 8.5, 8, h + 15),
  );
  platter.holes = bearingHoles;
  const cover = spin(
    round(
      "platter-cover",
      "Removable recessed platter cover",
      p.diameter,
      45,
      5.5,
      h + 23,
      "print",
      "PETG",
    ),
  );
  cover.sections = [
    { height: 3.5, diameter: p.diameter, bore: 45 },
    { height: 2, diameter: p.diameter, bore: 0 },
  ];
  bearingHoles.forEach((q, i) => {
    // These fasteners rotate about the assembly axis, not around their own centres.
    bolt(`platter-screw-${i}`, 3, 16, h + 23, q.x, q.z);
    round(
      `platter-nut-${i}`,
      "M3 platter nut envelope",
      6,
      3,
      3,
      h + 7,
      "buy",
      "Steel",
      q.x,
      q.z,
    );
    for (const id of [
      `platter-screw-${i}`,
      `platter-screw-${i}-head`,
      `platter-nut-${i}`,
    ])
      parts.find((q) => q.id === id)!.parentId = "platter";
  });
  tieHoles.forEach((q, i) => {
    for (const [name, bottom, top] of [
      ["lower", 4, h - 97],
      ["middle", h - 93, h - 45],
      ["upper", h - 42, h - 17],
    ] as const)
      round(
        `post-${name}-${i}`,
        `${name} frame spacer`,
        10,
        4.5,
        top - bottom,
        bottom,
        "machine",
        "Aluminium",
        q.x,
        q.z,
      );
    round(
      `tie-${i}`,
      "M4 threaded tie rod envelope",
      4,
      0,
      h - 7,
      -3,
      "buy",
      "Steel",
      q.x,
      q.z,
    );
    round(
      `tie-bottom-nut-${i}`,
      "M4 base nut envelope",
      8,
      4,
      3,
      -3,
      "buy",
      "Steel",
      q.x,
      q.z,
    );
    round(
      `tie-top-nut-${i}`,
      "M4 top nut envelope",
      8,
      4,
      4,
      h - 14,
      "buy",
      "Steel",
      q.x,
      q.z,
    );
    const a = (i * 2 * Math.PI) / 3 + Math.PI / 3;
    round(
      `foot-${i}`,
      "Adhesive rubber foot",
      16,
      0,
      6,
      -6,
      "buy",
      "Rubber",
      Math.cos(a) * postR,
      Math.sin(a) * postR,
    );
  });
  parts.push({
    id: "product",
    name: "Reference product",
    shape: "box",
    size: [p.diameter * 0.28, 65, p.diameter * 0.19],
    position: [0, h + 61, 0],
    color: "#B74C60",
    material: "Reference envelope",
    role: "reference",
    process: "buy",
    motion: { type: "rotate", axis: "y", speed: p.rpm },
  });
  return {
    parts,
    metrics: [
      { label: "Spindle", value: 8, unit: "mm" },
      { label: "Bearing spacing", value: 28, unit: "mm" },
      { label: "Motor plate height", value: h - 97, unit: "mm" },
      {
        label: "Peripheral speed",
        value: Math.round(((Math.PI * p.diameter * p.rpm) / 60) * 100) / 100,
        unit: "mm/s",
      },
      {
        label: "Inertia estimate",
        value:
          Math.round(0.5 * p.payload * (p.diameter / 2000) ** 2 * 10000 * 100) /
          100,
        unit: "×10⁻⁴ kg m²",
      },
    ],
    connections: [
      {
        from: "motor",
        to: "coupling",
        description:
          "Pololu 4756: 6 mm D shaft; separate 6-to-8 mm clamp coupling. Verify clamping on the D flat.",
      },
      {
        from: "coupling",
        to: "shaft",
        description:
          "Separate 8 mm spindle; shafts do not touch inside the coupling.",
      },
      {
        from: "lower-support",
        to: "lower-bearing",
        description:
          "608 outer race sits on an 18 mm opening, inside a 22.1 mm nominal seat and bolted retainer.",
      },
      {
        from: "upper-support",
        to: "upper-bearing",
        description:
          "Second 608 support is 28 mm above the first; inner-race spacer carries the flange.",
      },
      {
        from: "shaft",
        to: "platter",
        description:
          "Integral 40 mm spindle flange and three M3 bolts on a 30 mm pitch circle.",
      },
    ],
    steps: [
      {
        id: "support",
        title: "Assemble the frame",
        instruction:
          "Stack the base, three lower spacers, motor plate, middle spacers, lower shoulder plate, upper spacers and upper shoulder plate on M4 tie rods. Fit nuts and adhesive feet; check parallelism.",
        partIds: [
          "base-floor",
          "motor-plate",
          "lower-support",
          "upper-support",
          "post-lower-0",
          "post-middle-0",
          "post-upper-0",
          "tie-0",
        ],
        check: "Plates are parallel and rods clear the drive.",
      },
      {
        id: "drive",
        title: "Install the motor and coupling",
        instruction:
          "Mount the Pololu 4756 under the motor plate with six M3 × 6 screws: 4 mm plate leaves 2 mm nominal gearbox entry, below the manufacturer's 3 mm maximum. Leave the coupling loose until spindle alignment is checked.",
        partIds: [
          "motor",
          "motor-pilot",
          "motor-shaft",
          "coupling",
          "motor-plate",
        ],
        check:
          "Verify screw entry, lead clearance and coupling engagement against current supplier drawings.",
      },
      {
        id: "bearings",
        title: "Support and retain the spindle",
        instruction:
          "Fit each 608 bearing into its seat, between its shoulder and retaining plate. Use three M3 × 16 bolts and nuts per cartridge. Insert the one-piece spindle from above with the upper spacer; fit the lower spacer and clamp collar from below. Set measured end play without unintended preload.",
        partIds: [
          "shaft",
          "lower-bearing",
          "upper-bearing",
          "lower-seat",
          "upper-seat",
          "lower-retainer",
          "upper-retainer",
          "collar",
          "lower-inner-spacer",
          "upper-inner-spacer",
        ],
        check:
          "Confirm race contact, seat fit, coaxiality and free rotation by hand before power.",
      },
      {
        id: "platter",
        title: "Bolt on the platter",
        instruction:
          "Fit the platter over the integral flange. Install three M3 × 16 bolts and nuts on the 30 mm pitch circle. Fit the removable recessed cover over the screw heads, review its retention, then check balance and full-rotation clearance.",
        partIds: [
          "shaft",
          "platter",
          "platter-cover",
          "platter-screw-0",
          "platter-nut-0",
        ],
        check:
          "No contact between rotating flange/fasteners and stationary retainers.",
      },
      {
        id: "power",
        title: "Review controls before powered testing",
        instruction:
          "Select a fused 12 V supply, motor driver and encoder controller separately. Route and secure leads outside the swept volume. Test unloaded at low speed only after mechanical and electrical review.",
        partIds: ["motor", "coupling", "shaft", "platter"],
        check:
          "The speed is a visualization target, not demonstrated closed-loop control.",
      },
    ],
    warnings: [
      "Standard-parts reference v2. Purchased parts are nominal clearance envelopes; threads, bearing internals and clamp slots are not replicated.",
      "Open frame: moving parts are exposed. Guarding, wiring, driver, supply, fuse, emergency stop and physical testing remain unresolved; do not power this model as supplied.",
      "The printed cover has a 3.5 mm underside recess over the fastener heads. Confirm its retention and stiffness before placing a product. Bearing fit/end play and load capacity require engineering review. A 22.1 mm seat is a nominal review dimension, not a specified tolerance or guaranteed fit.",
      "Motor shaft is shown as a conservative 6 mm cylinder, not its D flat. Coupling engagement and clamping need supplier confirmation; no purchase recommendation or rated payload is claimed.",
    ],
  };
}
