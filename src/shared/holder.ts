import type { Part, DerivedDesign, Vec3 } from "./types";
export const holderPitch: Record<number, number> = {
  6: 1,
  8: 1.25,
  10: 1.5,
  12: 1.75,
  14: 2,
  16: 2,
};
export function standardHolder(
  p: Record<string, number>,
): Omit<DerivedDesign, "bom"> {
  const w = p.jawWidth,
    o = p.opening,
    d = p.screwDiameter,
    pitch = holderPitch[d];
  const L = o + 160,
    H = Math.ceil((L / 2 + 80) * Math.sin((40 * Math.PI) / 180) + 90),
    theta = (p.angle * Math.PI) / 180;
  const parts: Part[] = [];
  const box = (
    id: string,
    name: string,
    size: Vec3,
    position: Vec3,
    material = "Steel",
    process: Part["process"] = "machine",
  ) => {
    const q: Part = {
      id,
      name,
      shape: "box",
      size,
      position,
      material,
      process,
      color: "#C8CDD1",
    };
    parts.push(q);
    return q;
  };
  const round = (
    id: string,
    name: string,
    D: number,
    bore: number,
    len: number,
    start: number,
    x: number,
    z: number,
    material = "Steel",
    process: Part["process"] = "machine",
  ) => {
    const q: Part = {
      id,
      name,
      shape: bore ? "tube" : "cylinder",
      size: [D, len, D],
      position: [x, start + len / 2, z],
      ...(bore ? { holeDiameter: bore } : {}),
      material,
      process,
      color: process === "buy" ? "#353841" : "#AEB9C6",
    };
    parts.push(q);
    return q;
  };
  const ax = (
    id: string,
    name: string,
    D: number,
    bore: number,
    len: number,
    start: number,
    y: number,
    z: number,
    material = "Steel",
    process: Part["process"] = "machine",
  ) => {
    const q = round(id, name, D, bore, len, 0, 0, 0, material, process);
    q.position = [start + len / 2, y, z];
    q.rotation = [0, 0, -Math.PI / 2];
    return q;
  };
  const az = (
    id: string,
    name: string,
    D: number,
    bore: number,
    len: number,
    start: number,
    x: number,
    y: number,
    material = "Steel",
    process: Part["process"] = "machine",
  ) => {
    const q = round(id, name, D, bore, len, 0, 0, 0, material, process);
    q.position = [x, y, start + len / 2];
    q.rotation = [Math.PI / 2, 0, 0];
    return q;
  };
  const bx = (
    id: string,
    name: string,
    t: number,
    height: number,
    width: number,
    x: number,
    y: number,
  ) => {
    const q = box(id, name, [height, t, width], [x, y, 0]);
    q.rotation = [0, 0, -Math.PI / 2];
    return q;
  };
  const base = box(
    "base",
    "Bench mounting plate — four 9 mm clearance holes",
    [180, 12, w + 100],
    [0, 6, 0],
  );
  base.holes = [-65, 65].flatMap((x) =>
    [-(w / 2 + 35), w / 2 + 35].map((z) => ({ x, z, diameter: 9 })),
  );
  for (const sign of [-1, 1]) {
    const id = sign < 0 ? "front" : "rear";
    const q = box(
      "yoke-" + id,
      "Welded steel yoke with pivot bore",
      [60, 10, H + 20],
      [0, 12 + (H + 20) / 2, sign * (w / 2 + 27)],
    );
    q.rotation = [Math.PI / 2, 0, 0];
    q.holes = [{ x: 0, z: 12 + (H + 20) / 2 - H, diameter: 8.5 }];
    az(
      "pivot-friction-" + id,
      "Cut friction washer",
      40,
      8.5,
      2,
      sign < 0 ? -w / 2 - 22 : w / 2 + 20,
      0,
      H,
      "Fibre friction sheet",
      "cut",
    );
    az(
      "pivot-washer-" + id,
      "DIN 125 M8 washer",
      16,
      8.4,
      1.6,
      sign < 0 ? -w / 2 - 33.6 : w / 2 + 32,
      0,
      H,
      "Galvanised steel",
      "buy",
    );
    const bolt = az(
      "pivot-screw-" + id,
      "DIN 912 M8 × 40 screw envelope",
      13,
      0,
      48,
      sign < 0 ? -w / 2 - 41.6 : w / 2 - 6.4,
      0,
      H,
      "Stainless steel",
      "buy",
    );
    bolt.sections =
      sign < 0
        ? [
            { height: 8, diameter: 13, bore: 0 },
            { height: 40, diameter: 8, bore: 0 },
          ]
        : [
            { height: 40, diameter: 8, bore: 0 },
            { height: 8, diameter: 13, bore: 0 },
          ];
  }
  const first = parts.length;
  const guide = box(
    "guide",
    "Welded tilting cradle plate",
    [L, 10, w + 40],
    [0, 30, 0],
  );
  for (const sign of [-1, 1]) {
    const q = box(
      "ear-" + sign,
      "Welded cradle ear — nominal M8 thread envelope",
      [50, 20, 50],
      [0, 0, sign * (w / 2 + 10)],
    );
    q.rotation = [Math.PI / 2, 0, 0];
    q.holes = [{ x: 0, z: 0, diameter: 8 }];
  }
  const fixed = bx(
    "jaw-fixed",
    "Welded fixed steel jaw",
    20,
    70,
    w,
    -o / 2 - 12,
    70,
  );
  const moving = bx(
    "jaw-moving",
    "Guided moving jaw — bushing seats and spindle journal",
    20,
    70,
    w,
    o / 2 + 12,
    70,
  );
  const nut = bx(
    "nut",
    `Welded threaded support — M${d} × ${pitch}`,
    20,
    50,
    w,
    o / 2 + 58,
    60,
  );
  const g = w / 2 - 10;
  fixed.holes = [-g, g].map((z) => ({ x: 22, z, diameter: 8.02 }));
  moving.holes = [
    ...[-g, g].map((z) => ({ x: 22, z, diameter: 10 })),
    { x: 0, z: 0, diameter: 4.2 },
  ];
  nut.holes = [
    ...[-g, g].map((z) => ({ x: 12, z, diameter: 8.02 })),
    { x: -10, z: 0, diameter: d },
  ];
  moving.motion = {
    type: "slide",
    axis: "x",
    speed: 4,
    range: Math.min(40, o - 2),
    direction: [Math.cos(theta), Math.sin(theta), 0],
  };
  for (const [i, z] of [-g, g].entries()) {
    const start = -o / 2 - 22,
      len = o + 90;
    const rod = ax(
      "rod-" + i,
      "8 mm ground guide shaft — tapped M4 ends",
      8,
      0,
      len,
      start,
      48,
      z,
    );
    rod.sections = [
      { height: 12, diameter: 8, bore: 4 },
      { height: len - 24, diameter: 8, bore: 0 },
      { height: 12, diameter: 8, bore: 4 },
    ];
    for (const side of [-1, 1]) {
      const edge = side < 0 ? start : start + len;
      ax(
        `rod-washer-${i}-${side}`,
        "Cut end-retention washer",
        14,
        4.3,
        2,
        side < 0 ? edge - 2 : edge,
        48,
        z,
        "Steel",
        "cut",
      );
      const b = ax(
        `rod-screw-${i}-${side}`,
        "DIN 912 M4 × 12 screw envelope",
        7,
        0,
        16,
        side < 0 ? edge - 6 : edge - 10,
        48,
        z,
        "Stainless steel",
        "buy",
      );
      b.sections =
        side < 0
          ? [
              { height: 4, diameter: 7, bore: 0 },
              { height: 12, diameter: 4, bore: 0 },
            ]
          : [
              { height: 12, diameter: 4, bore: 0 },
              { height: 4, diameter: 7, bore: 0 },
            ];
      const bearing = ax(
        `bushing-${i}-${side}`,
        "igus GFM-0810-10 flanged guide bushing",
        15,
        8.025,
        10,
        side < 0 ? o / 2 + 1 : o / 2 + 13,
        48,
        z,
        "iglidur G",
        "buy",
      );
      bearing.sections =
        side < 0
          ? [
              { height: 1, diameter: 15, bore: 8.025 },
              { height: 9, diameter: 10, bore: 8.025 },
            ]
          : [
              { height: 9, diameter: 10, bore: 8.025 },
              { height: 1, diameter: 15, bore: 8.025 },
            ];
      bearing.parentId = "jaw-moving";
    }
  }
  for (const [id, x] of [
    ["fixed", -o / 2 - 1],
    ["moving", o / 2 + 1],
  ] as const) {
    const q = bx(
      "pad-" + id,
      "Bonded replaceable soft jaw pad",
      2,
      28,
      w,
      x,
      91,
    );
    q.material = "Rubber";
    q.process = "cut";
    q.color = "#394A62";
    if (id === "moving") q.parentId = "jaw-moving";
  }
  const left = o / 2 + 2,
    right = o / 2 + 22;
  for (const [id, start] of [
    ["front", left - 1],
    ["rear", right],
  ] as const) {
    const q = ax(
      "thrust-" + id,
      "Cut bronze thrust washer",
      12,
      4.2,
      1,
      start,
      70,
      0,
      "Bronze",
      "cut",
    );
    q.parentId = "jaw-moving";
  }
  const spindle = ax(
    "screw",
    `Custom M${d} × ${pitch} spindle with 4 mm journal and M3 retaining thread`,
    d,
    0,
    121,
    left - 1,
    70,
    0,
  );
  spindle.sections = [
    { height: 10, diameter: 4, bore: 3 },
    { height: 12, diameter: 4, bore: 0 },
    { height: 99, diameter: d, bore: 0 },
  ];
  spindle.parentId = "jaw-moving";
  // The shared drive convention negates displacement; reverse its axis for a right-hand thread.
  spindle.motion = {
    type: "rotate",
    axis: "x",
    speed: 0,
    drivenBy: "jaw-moving",
    travelPerTurn: pitch,
    direction: [-Math.cos(theta), -Math.sin(theta), 0],
  };
  const ret = ax(
    "journal-retainer",
    "Cut journal end-retention washer",
    7,
    3.2,
    0.5,
    left - 1.5,
    70,
    0,
    "Steel",
    "cut",
  );
  ret.parentId = "screw";
  const rs = ax(
    "journal-screw",
    "DIN 912 M3 × 10 screw envelope",
    5.5,
    0,
    13,
    left - 4.5,
    70,
    0,
    "Stainless steel",
    "buy",
  );
  rs.sections = [
    { height: 3, diameter: 5.5, bore: 0 },
    { height: 10, diameter: 3, bore: 0 },
  ];
  rs.parentId = "screw";
  const handle = ax(
    "handle",
    "Welded steel handwheel",
    40,
    d,
    10,
    o / 2 + 112,
    70,
    0,
  );
  handle.parentId = "screw";
  // Transform the complete cradle about the retained Z-axis pivot. Intrinsic XYZ order matters.
  for (const q of parts.slice(first)) {
    const [x, y, z] = q.position;
    q.position = [
      x * Math.cos(theta) - y * Math.sin(theta),
      H + x * Math.sin(theta) + y * Math.cos(theta),
      z,
    ];
    const r = q.rotation || [0, 0, 0];
    q.rotation = r[0] ? [r[0], theta, 0] : [0, 0, r[2] + theta];
  }
  return {
    parts,
    metrics: [
      { label: "Clear jaw opening", value: o, unit: "mm" },
      { label: "Screw pitch", value: pitch, unit: "mm/turn" },
      { label: "Guide shaft length", value: o + 90, unit: "mm" },
      { label: "Pivot centre height", value: H, unit: "mm" },
      {
        label: "Preview closing travel",
        value: Math.min(40, o - 2),
        unit: "mm",
      },
    ],
    connections: [
      {
        from: "handle",
        to: "screw",
        description:
          "Welded handwheel rotates and translates the custom spindle.",
      },
      {
        from: "screw",
        to: "nut",
        description: `Right-hand M${d} × ${pitch} screw through stationary matched thread; threads are nominal envelopes.`,
      },
      {
        from: "screw",
        to: "jaw-moving",
        description:
          "Reduced journal, bronze washers and M3 retainer push/pull the jaw while allowing spindle rotation.",
      },
      {
        from: "jaw-moving",
        to: "rod-0",
        description:
          "Four press-fit guide bushings keep the jaw aligned on two retained shafts.",
      },
    ],
    steps: [
      {
        id: "base",
        title: "Secure the welded yoke",
        instruction:
          "Weld both yoke plates to the mounting plate, then finish aligned pivot bores. The four 9 mm base holes require reviewed M8 through-bolts, backing plates and a suitable bench; fastener length depends on your bench.",
        partIds: ["base", "yoke-front", "yoke-rear"],
        check:
          "Review welds and bench attachment before applying a load; bench fasteners are not supplied in this assembly.",
      },
      {
        id: "tilt",
        title: "Retain and set the tilt",
        instruction:
          "Weld the cradle ears, fixed jaw and threaded support to the platform before final machining. Fit both friction washers, M8 washers and M8 × 40 bolts. Set the angle and tighten both sides using a reviewed torque.",
        partIds: [
          "guide",
          "ear--1",
          "ear-1",
          "pivot-screw-front",
          "pivot-screw-rear",
        ],
        check:
          "Verify pivot retention and holding under a measured lightweight load. No holding torque or machining-load rating is established.",
      },
      {
        id: "jaws",
        title: "Fit the guided jaw",
        instruction:
          "Press a GFM-0810-10 bushing into each end of both moving-jaw guide bores. Install the ground 8 mm shafts through the fixed jaw, moving jaw and end support; retain all four ends with cut washers and M4 × 12 screws. Bond the soft pads.",
        partIds: ["jaw-fixed", "jaw-moving", "rod-0", "rod-1"],
        check:
          "Check housing/shaft tolerances, parallelism and free sliding. Bearing bore uses the supplier minimum installed clearance; nominal CAD does not prove a press fit.",
      },
      {
        id: "screw",
        title: "Capture the swivel spindle",
        instruction: `Machine the custom right-hand M${d} × ${pitch} spindle and matching fixed-support thread. Fit the 4 mm journal through the jaw with two bronze washers; secure its end washer using an M3 × 10 screw and a reviewed locking method. Weld the handwheel before final finishing.`,
        partIds: [
          "screw",
          "nut",
          "handle",
          "journal-retainer",
          "journal-screw",
        ],
        check:
          "The shoulder carries closing load; the small retainer carries retraction only. Check end play, lubrication and thread engagement throughout travel.",
      },
      {
        id: "fit",
        title: "Try a lightweight workpiece",
        instruction:
          "Set the tilt, gently close on a test piece, and check pads, guides, screw retention and bench mounting. The animation follows screw pitch and stops with a 2 mm minimum gap; it is not a force simulation.",
        partIds: ["jaw-fixed", "jaw-moving", "pad-fixed", "pad-moving"],
        check:
          "Record slip and deformation under a measured load. Do not use this unvalidated prototype for powered machining.",
      },
    ],
    warnings: [
      "Version2 is a nominal light-duty prototype. No jaw-force, weld, screw-buckling, friction-lock or bench-load rating is established. Not validated for powered machining.",
      "Custom spindle, threaded support, welded cradle/yoke, ground shafts with tapped ends and cut washers require fabrication. Bought fasteners and igus bushings have supplier links; the spindle is not a stock bought part.",
      "Threaded features use major-diameter envelopes, not helical threads or tap-drill dimensions. Select tolerance class, finish and locking method before manufacture; metric coarse sizes are 6, 8, 10, 12, 14 or 16 mm.",
      "GFM-0810-10 is 8 mm nominal ID, 10 mm OD, 15 mm flange, 10 mm overall length and 1 mm flange. Model bore8.025mm is the supplier minimum installed value, not an unpressed measurement. Verify 10 mm housing and 8 mm shaft tolerances.",
      "Tilt bolts have nominal 26.4 mm ear engagement path including 20 mm threaded ear and 6.4 mm inward protrusion. Both friction locks need tested torque and retention. Bench-specific M8 fasteners/backing plates are required but not selected.",
      "Preview is kinematic only: opening resizes the frame and shafts; motion closes at4mm/s along the tilted guides, rotating the spindle by the specified pitch. It does not predict grip or material deformation.",
    ],
  };
}
