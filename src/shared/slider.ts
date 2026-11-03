import type { Part, DerivedDesign, Vec3 } from "./types";

// Purchased interfaces are nominal clearance envelopes; custom parts are explicit.
export function standardSlider(
  p: Record<string, number>,
): Omit<DerivedDesign, "bom"> {
  const travel = p.travel,
    spacing = p.railSpacing;
  const railLength = Math.ceil((travel + 100) / 25) * 25 + 20;
  const centres = railLength + 140,
    left = -centres / 2,
    right = centres / 2;
  const parts: Part[] = [];
  const box = (
    id: string,
    name: string,
    size: Vec3,
    position: Vec3,
    process: Part["process"] = "machine",
    material = "Aluminium",
  ) => {
    const q: Part = {
      id,
      name,
      shape: "box",
      size,
      position,
      process,
      material,
      color: process === "buy" ? "#353841" : "#C8CDD1",
    };
    parts.push(q);
    return q;
  };
  const round = (
    id: string,
    name: string,
    diameter: number,
    bore: number,
    height: number,
    bottom: number,
    x = 0,
    z = 0,
    process: Part["process"] = "machine",
    material = "Steel",
  ) => {
    const q: Part = {
      id,
      name,
      shape: bore ? "tube" : "cylinder",
      size: [diameter, height, diameter],
      position: [x, bottom + height / 2, z],
      ...(bore ? { holeDiameter: bore } : {}),
      process,
      material,
      color: process === "buy" ? "#353841" : "#C8CDD1",
    };
    parts.push(q);
    return q;
  };
  const bolt = (
    id: string,
    d: number,
    length: number,
    seat: number,
    x: number,
    z: number,
    parentId?: string,
  ) => {
    const head = d === 3 ? 5.5 : 8;
    const q = round(
      id,
      `M${d} × ${length} socket screw envelope`,
      head,
      0,
      length + d,
      seat - length,
      x,
      z,
      "buy",
    );
    q.sections = [
      { height: length, diameter: d, bore: 0 },
      { height: d, diameter: head, bore: 0 },
    ];
    if (parentId) q.parentId = parentId;
    return q;
  };
  const attached = (q: Part) => {
    q.parentId = "carriage";
    return q;
  };
  const grid = (x: number, z: number, diameter: number) =>
    [-1, 1].flatMap((a) =>
      [-1, 1].map((b) => ({ x: a * x, z: b * z, diameter })),
    );
  const railHoles = Array.from(
    { length: (railLength - 20) / 25 + 1 },
    (_, i) => ({ x: -railLength / 2 + 10 + i * 25, z: 0, diameter: 3.5 }),
  );
  const base = box(
    "base",
    "Slider plate — Ø3 holes are M3 thread envelopes",
    [centres + 90, 8, spacing + 50],
    [0, 54, 0],
  );
  base.holes = [
    ...railHoles.flatMap((h) =>
      [-spacing / 2, spacing / 2].map((z) => ({ ...h, z, diameter: 3 })),
    ),
    { x: left, z: 0, diameter: 23 },
    ...grid(15.5, 15.5, 3.4).map((h) => ({ ...h, x: h.x + left })),
  ];
  for (const [name, z] of [
    ["front", -spacing / 2],
    ["rear", spacing / 2],
  ] as const) {
    const riser = box(
      `riser-${name}`,
      `${name} rail mounting riser`,
      [railLength, 6, 20],
      [0, 61, z],
    );
    riser.holes = railHoles;
    const rail = box(
      `rail-${name}`,
      `HIWIN MGNR12R ${name} rail envelope`,
      [railLength, 8, 12],
      [0, 68, z],
      "buy",
      "Bearing steel",
    );
    rail.holes = railHoles.map((h) => ({
      ...h,
      counterbore: { diameter: 6, depth: 4.5 },
    }));
    railHoles.forEach((h, i) =>
      bolt(`rail-screw-${name}-${i}`, 3, 16, 67.5, h.x, z),
    );
    const block = attached(
      box(
        `block-${name}`,
        `HIWIN MGN12H ${name} guide envelope`,
        [45.4, 10, 27],
        [0, 72, z],
        "buy",
        "Bearing steel",
      ),
    );
    block.channel = { width: 12.2, depth: 5.2 };
    block.holes = grid(10, 10, 3);
  }
  const carriage = box(
    "carriage",
    "Camera carriage plate",
    [85, 5, spacing + 35],
    [0, 79.5, 0],
  );
  carriage.motion = { type: "slide", axis: "x", speed: p.speed, range: travel };
  const guideHoles = [-spacing / 2, spacing / 2].flatMap((z) =>
    grid(10, 10, 3.4).map((h) => ({
      ...h,
      z: h.z + z,
      counterbore: { diameter: 6, depth: 3 },
    })),
  );
  carriage.holes = [...guideHoles, { x: 0, z: 0, diameter: 6.6 }];
  guideHoles.forEach((h, i) =>
    bolt(`guide-screw-${i}`, 3, 5, 79, h.x, h.z, "carriage"),
  );
  const camera = attached(
    box(
      "camera",
      "Camera footprint",
      [60, 50, p.cameraWidth],
      [0, 107, 0],
      "buy",
      "Reference envelope",
    ),
  );
  camera.color = "#B74C60";
  const cameraScrew = attached(
    round(
      "camera-screw",
      "Custom 1/4-20 camera screw; 4 mm projection",
      12,
      0,
      13,
      73,
    ),
  );
  cameraScrew.sections = [
    { height: 4, diameter: 12, bore: 0 },
    { height: 9, diameter: 6.35, bore: 0 },
  ];
  // Clamp lies forward along X, leaving the camera screw head accessible.
  for (const [name, z, xs] of [
    ["inner", 7.295, [15, 35]],
    ["outer", 12.795, [20, 30]],
  ] as const) {
    const jaw = attached(
      box(
        `belt-clamp-${name}`,
        `${name} belt jaw — M3 thread envelopes`,
        [30, 9.85, 4],
        [25, 72.075, z],
      ),
    );
    jaw.holes = xs.map((x) => ({ x: x - 25, z: 0, diameter: 3 }));
    xs.forEach((x, i) => {
      carriage.holes!.push({
        x,
        z,
        diameter: 3.4,
        counterbore: { diameter: 6, depth: 3 },
      });
      bolt(`clamp-screw-${name}-${i}`, 3, 12, 79, x, z, "carriage");
    });
  }
  const motor = box(
    "drive",
    "Pololu 2267 stepper body envelope",
    [42.3, 38, 42.3],
    [left, 31, 0],
    "buy",
    "Bipolar stepper",
  );
  const shaft = round(
    "drive-shaft",
    "5 mm D-shaft clearance envelope",
    5,
    0,
    24,
    50,
    left,
    0,
    "buy",
    "Integral motor feature",
  );
  grid(15.5, 15.5, 3).forEach((h, i) =>
    bolt(`motor-screw-${i}`, 3, 10, 58, left + h.x, h.z),
  );
  const driven = (q: Part) => {
    q.motion = {
      type: "rotate",
      axis: "y",
      speed: 0,
      drivenBy: "carriage",
      travelPerTurn: 60,
    };
    return q;
  };
  driven(shaft);
  const pulley = driven(
    round(
      "drive-pulley",
      "Misumi GPA30GT2060-A-P5 envelope",
      24,
      5,
      10.3,
      65,
      left,
      0,
      "buy",
      "Aluminium pulley",
    ),
  );
  pulley.sections = [
    { height: 1.65, diameter: 24, bore: 5 },
    { height: 7, diameter: 18.59, bore: 5 },
    { height: 1.65, diameter: 24, bore: 5 },
  ];
  const belt = round(
    "belt",
    "6 mm 2GT belt loop clearance envelope",
    21.59,
    18.59,
    6,
    67.15,
    0,
    0,
    "buy",
    "2GT belt",
  );
  belt.loopSpan = centres;
  belt.size[0] += centres;
  // Oversized clearance holes allow at most +/-2 mm longitudinal adjustment.
  const tension = box(
    "tension-plate",
    "Idler plate — M5 centre-thread envelope",
    [50, 6, 50],
    [right, 61, 0],
  );
  tension.holes = [{ x: 0, z: 0, diameter: 5 }, ...grid(18, 18, 7)];
  grid(18, 18, 3).forEach((h, i) => {
    base.holes!.push({ x: right + h.x, z: h.z, diameter: 3 });
    round(
      `tension-washer-${i}`,
      "Wide tension-plate retaining washer",
      12,
      3.4,
      1,
      64,
      right + h.x,
      h.z,
    );
    bolt(`tension-screw-${i}`, 3, 12, 65, right + h.x, h.z);
  });
  const axle = round(
    "idler-axle",
    "Custom 5 mm idler axle with M5 lower thread",
    8,
    0,
    21.3,
    58,
    right,
  );
  axle.sections = [
    { height: 18.3, diameter: 5, bore: 0 },
    { height: 3, diameter: 8, bore: 0 },
  ];
  for (const [name, bottom] of [
    ["lower", 64],
    ["upper", 75.3],
  ] as const)
    round(
      `idler-spacer-${name}`,
      `${name} idler inner-race spacer`,
      6.5,
      5.1,
      1,
      bottom,
      right,
    );
  const idler = driven(
    round(
      "idler",
      "Misumi AGTFW30GT2060 body envelope",
      24,
      7,
      10.3,
      65,
      right,
      0,
      "buy",
      "Aluminium pulley",
    ),
  );
  idler.sections = [
    { height: 1.65, diameter: 24, bore: 8 },
    { height: 0.85, diameter: 18.59, bore: 8 },
    { height: 5.3, diameter: 18.59, bore: 7 },
    { height: 0.85, diameter: 18.59, bore: 8 },
    { height: 1.65, diameter: 24, bore: 8 },
  ];
  for (const [name, bottom] of [
    ["lower", 65],
    ["upper", 72.8],
  ] as const)
    round(
      `idler-bearing-${name}`,
      `${name} 675ZZ bearing included with idler`,
      8,
      5,
      2.5,
      bottom,
      right,
      0,
      "buy",
      "Bearing steel",
    );
  for (const sign of [-1, 1])
    for (const side of [-1, 1]) {
      const x = sign * (travel / 2 + 46.5),
        z = side * (spacing / 2 + 15),
        id = `stop-${sign}-${side}`;
      base.holes!.push({ x, z, diameter: 4.5 });
      round(id, "Carriage travel stop post", 8, 4.5, 24, 58, x, z);
      bolt(id + "-screw", 4, 40, 82, x, z);
      round(id + "-nut", "M4 nut envelope", 8, 4, 3.2, 46.8, x, z, "buy");
    }
  for (const sign of [-1, 1])
    for (const side of [-1, 1]) {
      const x = sign * (centres / 2 + 25),
        z = side * (spacing / 2 + 17),
        id = `foot-${sign}-${side}`;
      base.holes!.push({ x, z, diameter: 4.5 });
      round(id, "M4-tapped support foot — nominal bore", 16, 4, 50, 0, x, z);
      bolt(id + "-screw", 4, 16, 58, x, z);
    }
  return {
    parts,
    metrics: [
      { label: "Rail cut length", value: railLength, unit: "mm" },
      { label: "Rail mounting pitch", value: 25, unit: "mm" },
      { label: "Pulley centre distance", value: centres, unit: "mm" },
      { label: "Belt pitch length", value: 2 * centres + 60, unit: "mm" },
      { label: "Travel per pulley turn", value: 60, unit: "mm" },
      {
        label: "One-way travel",
        value: Math.round((travel / p.speed) * 100) / 100,
        unit: "s",
      },
    ],
    connections: [
      {
        from: "drive",
        to: "drive-pulley",
        description:
          "5 mm shaft; nominal 9 mm axial overlap. Confirm D-flat/set-screw engagement and pilot clearance.",
      },
      {
        from: "drive-pulley",
        to: "belt",
        description:
          "30 teeth × 2 mm pitch = 60 mm per revolution; smooth envelope omits the tooth profile.",
      },
      {
        from: "belt",
        to: "belt-clamp-inner",
        description:
          "Join and clamp belt ends at the carriage; verify tooth inserts, belt thickness and pull-out strength.",
      },
      {
        from: "carriage",
        to: "block-front",
        description:
          "Eight M3 × 5 screws seat in counterbores, leaving 3 mm nominal guide-block engagement.",
      },
      {
        from: "idler",
        to: "tension-plate",
        description:
          "Two 675ZZ bearings on a stationary 5 mm axle; loosen four clamp screws to adjust within ±2 mm, then retighten.",
      },
    ],
    steps: [
      {
        id: "frame",
        title: "Mount the guides",
        instruction: `Support the mounting plate on four feet. Fit the two risers and ${railLength} mm MGNR12R rails with M3 × 16 screws at 25 mm pitch and 10 mm end distances. Align the rails at ${spacing} mm centres before tightening.`,
        partIds: [
          "base",
          "riser-front",
          "riser-rear",
          "rail-front",
          "rail-rear",
        ],
        check:
          "Measure parallelism, screw entry and rail seating; purchased raceways are not replicated.",
      },
      {
        id: "carriage",
        title: "Attach the camera carriage",
        instruction:
          "Slide one MGN12H block onto each rail. Use eight M3 × 5 screws in the recessed plate holes: 3 mm nominal thread engagement stays below the 3.5 mm catalogue depth. Install the travel stops.",
        partIds: [
          "carriage",
          "block-front",
          "block-rear",
          "stop--1--1",
          "stop-1-1",
        ],
        check:
          "The unloaded carriage moves freely over the entire requested travel and reaches both stop pairs.",
      },
      {
        id: "drive",
        title: "Fit the motor and belt",
        instruction:
          "Fit the Pololu 2267 beneath the plate with four M3 × 10 screws (2 mm nominal motor entry). Position the 30-tooth pulley 15 mm above the motor face. Route the 6 mm 2GT belt around the matching idler.",
        partIds: ["drive", "drive-shaft", "drive-pulley", "belt", "idler"],
        check:
          "Confirm shaft engagement, pilot protrusion, pulley alignment and actual belt clearance from current supplier drawings.",
      },
      {
        id: "tension",
        title: "Join the belt and set tension",
        instruction:
          "Fit the custom axle, inner-race spacers and idler to its adjustable plate. Join the belt ends in the carriage jaws with suitable tooth inserts; the smooth jaw/loop envelopes do not reproduce teeth. Loosen the four wide-washer clamp screws, move the idler plate no more than 2 mm along X, set manufacturer-specified tension and retighten.",
        partIds: [
          "tension-plate",
          "idler-axle",
          "idler-spacer-lower",
          "idler-spacer-upper",
          "belt-clamp-inner",
          "belt-clamp-outer",
        ],
        check:
          "Verify washer coverage, bearing inner-race contact, belt joint retention and free return-run clearance.",
      },
      {
        id: "camera",
        title: "Mount the camera and review controls",
        instruction:
          "Fit the custom 1/4-20 screw with 4 mm projection only after measuring the camera socket and checking that it will not bottom out. Select a current-limited bipolar stepper driver, protected supply and separate end-limit sensors; test unloaded after mechanical/electrical review.",
        partIds: ["camera-screw", "carriage", "drive"],
        check:
          "Camera thread depth, load, guarding, homing, acceleration and electrical ratings remain physical review items.",
      },
    ],
    warnings: [
      "Standard-parts slider v2: purchased envelopes omit raceways, bearing internals, D-flats, threads and tooth profiles. Custom parts still require fabrication tolerances.",
      "Belt/jaw thickness and tooth inserts need confirmation against the selected 6 mm 2GT belt. The smooth 1.5 mm radial belt envelope is not an ordering specification.",
      "The tension plate allows at most ±2 mm longitudinal adjustment under the wide washers. Confirm actual belt length, tension and fastener torque; no stock availability is asserted.",
      "The 5 mm idler axle and 1/4-20 camera screw are custom turned parts. Confirm inner-race spacer contact, axle retention and camera thread engagement before fabrication.",
      "Travel speed and coupled pulley motion are visualization targets. Motor torque, load capacity, control firmware, limit sensors and physical operation are not verified.",
    ],
  };
}
