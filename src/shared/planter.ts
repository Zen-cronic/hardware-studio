import type { Part, DerivedDesign, Vec3 } from "./types";

export function standardPlanter(
  p: Record<string, number>,
): Omit<DerivedDesign, "bom"> {
  const n = p.pots,
    d = p.potDiameter,
    h = p.reservoirHeight,
    pitch = d + 20,
    L = n * pitch + 100,
    W = d + 80;
  const cupHeight = d * 0.65,
    H = h + cupHeight + 10,
    M = H + 35,
    z = -(d - 14) / 4,
    px = -L / 2 + 40,
    pz = z - 19.275;
  const xs = Array.from(
    { length: n },
    (_, i) => -L / 2 + 80 + pitch / 2 + i * pitch,
  );
  const parts: Part[] = [];
  const box = (
    id: string,
    name: string,
    size: Vec3,
    position: Vec3,
    process: Part["process"] = "machine",
    material = "Polypropylene",
  ) => {
    const q: Part = {
      id,
      name,
      size,
      position,
      shape: "box",
      color: "#C8DDD2",
      material,
      process,
    };
    parts.push(q);
    return q;
  };
  const round = (
    id: string,
    name: string,
    diameter: number,
    bore: number,
    length: number,
    bottom: number,
    x: number,
    z: number,
    process: Part["process"] = "machine",
    material = "Polypropylene",
  ) => {
    const q: Part = {
      id,
      name,
      shape: bore ? "tube" : "cylinder",
      size: [diameter, length, diameter],
      position: [x, bottom + length / 2, z],
      ...(bore ? { holeDiameter: bore } : {}),
      color: process === "buy" ? "#39484D" : "#C8DDD2",
      material,
      process,
    };
    parts.push(q);
    return q;
  };
  const screw = (
    id: string,
    diameter: number,
    seat: number,
    x: number,
    z: number,
  ) => {
    const q = round(
      id,
      `DIN 912 M${diameter} × 12 screw envelope`,
      diameter === 3 ? 5.5 : 7,
      0,
      12 + diameter,
      seat - 12,
      x,
      z,
      "buy",
      "Stainless steel",
    );
    q.sections = [
      { height: 12, diameter, bore: 0 },
      { height: diameter, diameter: diameter === 3 ? 5.5 : 7, bore: 0 },
    ];
    return q;
  };
  box("reservoir", "Heat-welded reservoir floor", [L, 6, W], [0, 3, 0], "cut");
  box(
    "wall-front",
    "Heat-welded front wall",
    [L, h, 4],
    [0, 6 + h / 2, -W / 2 + 2],
    "cut",
  );
  box(
    "wall-back",
    "Heat-welded rear wall",
    [L, h, 4],
    [0, 6 + h / 2, W / 2 - 2],
    "cut",
  );
  box(
    "wall-left",
    "Heat-welded left wall",
    [4, h, W - 8],
    [-L / 2 + 2, 6 + h / 2, 0],
    "cut",
  );
  box(
    "wall-right",
    "Heat-welded right wall",
    [4, h, W - 8],
    [L / 2 - 2, 6 + h / 2, 0],
    "cut",
  );
  const supports = [
    [-L / 2 + 12, -W / 2 + 12],
    [-L / 2 + 12, W / 2 - 12],
    [L / 2 - 12, -W / 2 + 12],
    [L / 2 - 12, W / 2 - 12],
  ];
  for (const [i, [x, z]] of supports.entries()) {
    round(
      `support-${i}`,
      "Welded shelf post — M4 thread envelope",
      12,
      4,
      H - 10,
      6,
      x,
      z,
    );
    screw(`shelf-screw-${i}`, 4, H, x, z);
  }
  const shelf = box(
    "shelf",
    "Removable cup support plate",
    [L - 8, 4, W - 8],
    [0, H - 2, 0],
  );
  shelf.holes = [
    ...xs.map((x) => ({ x, z: 0, diameter: d - 7 })),
    ...supports.map(([x, z]) => ({ x, z, diameter: 4.5 })),
    { x: px, z, diameter: 10 },
    { x: px + 18, z: z + 10, diameter: 8 },
  ];
  // Pump uses a conservative purchased envelope; internal impeller and exact revision are not modeled.
  const pump = round(
    "pump",
    "Adafruit 4546 pump body envelope",
    23.9,
    0,
    46,
    0,
    px,
    pz,
    "buy",
    "3 V submersible pump",
  );
  pump.position = [px, 24, pz];
  pump.rotation = [Math.PI / 2, 0, 0];
  round(
    "pump-outlet",
    "Integral pump outlet envelope",
    7.45,
    5,
    9.75,
    35.95,
    px,
    z,
    "buy",
    "Pump integral outlet",
  );
  const cage = box(
    "pump-cradle",
    "Welded pump cage support",
    [36, 20, 36],
    [px, 24, pz],
  );
  cage.rotation = [Math.PI / 2, 0, 0];
  const pattern = [
    [-14, -8],
    [-14, 8],
    [14, -8],
    [14, 8],
  ];
  cage.holes = [
    { x: 0, z: 0, diameter: 24.5 },
    ...pattern.map(([x, z]) => ({ x, z, diameter: 6.2 })),
  ];
  const liner = round(
    "pump-liner",
    "Pump cage liner — verify measured fit",
    24.5,
    23.9,
    20,
    0,
    px,
    pz,
    "cut",
    "Silicone sleeve",
  );
  liner.position = [px, 24, pz];
  liner.rotation = [Math.PI / 2, 0, 0];
  for (const [i, sign] of [-1, 1].entries()) {
    const cap = box(
      `pump-cap-${i}`,
      "Pump retaining plate with intake/wire opening",
      [36, 2, 24],
      [px, 24, pz + sign * 24],
    );
    cap.rotation = [Math.PI / 2, 0, 0];
    cap.holes = [
      { x: 0, z: 0, diameter: 16 },
      ...pattern.map(([x, z]) => ({ x, z, diameter: 3.4 })),
    ];
    for (const [j, [x, qz]] of pattern.entries()) {
      const q = screw(`pump-screw-${i}-${j}`, 3, 0, 0, 0);
      q.position = [px + x, 24 - qz, pz + sign * 20.5];
      q.rotation = [(sign * Math.PI) / 2, 0, 0];
    }
  }
  for (const [i, [x, qz]] of pattern.entries()) {
    const rod = round(
      `pump-spacer-${i}`,
      "Pump cage spacer — M3 thread envelope",
      6,
      3,
      46,
      0,
      px + x,
      pz,
    );
    rod.position = [px + x, 24 - qz, pz];
    rod.rotation = [Math.PI / 2, 0, 0];
  }
  const inletBottom = 37.7,
    inletTop = M - 2,
    inletLength = inletTop - inletBottom;
  const inlet = round(
    "inlet",
    "Adafruit 4545 inlet hose — fitted pump end",
    9.45,
    6,
    inletLength,
    inletBottom,
    px,
    z,
    "buy",
    "PVC tubing",
  );
  inlet.sections = [
    { height: 8, diameter: 9.45, bore: 7.45 },
    { height: inletLength - 8, diameter: 8, bore: 6 },
  ];
  const lid = box(
    "manifold-lid",
    "Welded drilled manifold lower plate",
    [L - 24, 4, 16],
    [0, M + 2, z],
  );
  lid.holes = [px, ...xs].map((x) => ({ x, z: 0, diameter: 6 }));
  const manifold = box(
    "manifold",
    "Manifold channel body",
    [L - 24, 12, 16],
    [0, M + 10, z],
  );
  manifold.channel = { width: 8, depth: 8 };
  for (const [i, sign] of [-1, 1].entries()) {
    box(
      `manifold-cap-${i}`,
      "Welded manifold end cap",
      [4, 16, 16],
      [sign * (L / 2 - 10), M + 8, z],
    );
    box(
      `manifold-support-${i}`,
      "Welded manifold support",
      [8, 35, 12],
      [sign * (L / 2 - 16), H + 17.5, z],
    );
  }
  const tail = (id: string, x: number) => {
    const q = round(id, "Welded hollow hose tail", 10, 4, 14, M - 10, x, z);
    q.sections = [
      { height: 8, diameter: 6, bore: 4 },
      { height: 2, diameter: 10, bore: 4 },
      { height: 4, diameter: 6, bore: 4 },
    ];
    return q;
  };
  tail("inlet-tail", px);
  for (const [i, x] of xs.entries()) {
    const cup = round(
      `pot-${i}`,
      `Draining plant cup ${i + 1}`,
      d,
      4,
      cupHeight + 3,
      H - cupHeight,
      x,
      0,
      "print",
      "PETG",
    );
    cup.sections = [
      { height: 3, diameter: d - 8, bore: 4 },
      { height: cupHeight - 3, diameter: d - 8, bore: d - 14 },
      { height: 3, diameter: d, bore: d - 14 },
    ];
    tail(`outlet-tail-${i}`, x);
    round(
      `outlet-${i}`,
      `Adafruit 4545 outlet hose ${i + 1}`,
      8,
      6,
      23,
      H + 10,
      x,
      z,
      "buy",
      "PVC tubing",
    );
    const plant = round(
      `plant-${i}`,
      `Plant space ${i + 1}`,
      d * 0.35,
      0,
      d * 0.6,
      H + 3,
      x,
      d * 0.14,
      "buy",
      "Reference envelope",
    );
    plant.color = "#6D9872";
    plant.role = "reference";
  }
  const water = box(
    "water",
    "Illustrative working water band",
    [L - 8, h - 50, W - 8],
    [0, (42 + h - 8) / 2, 0],
    "buy",
    "Reference envelope",
  );
  water.color = "#6EA6BA";
  water.role = "reference";
  water.motion = {
    type: "flow",
    axis: "y",
    speed: p.waterMinutes / 60,
    range: 2,
  };
  const connections = [
    {
      from: "pump",
      to: "inlet",
      description:
        "Integral 7.45 mm outlet to supplier-paired 6 mm ID hose; fitted-end expansion shown, retention and actual dimensions need checking.",
    },
    {
      from: "inlet",
      to: "inlet-tail",
      description:
        "8 mm nominal insertion over the custom 6 mm tail; verify wet fit and restraint.",
    },
    {
      from: "inlet-tail",
      to: "manifold",
      description:
        "Open 4 mm bore through lower plate into the welded 8 × 8 mm header passage.",
    },
    ...xs.flatMap((_, i) => [
      {
        from: "manifold",
        to: `outlet-tail-${i}`,
        description: "Open bore to each downward hose tail.",
      },
      {
        from: `outlet-tail-${i}`,
        to: `outlet-${i}`,
        description:
          "8 mm nominal hose insertion; measure each outlet flow separately.",
      },
      {
        from: `outlet-${i}`,
        to: `pot-${i}`,
        description:
          "Hose ends 7 mm above the rim; 4 mm cup drain returns water to the reservoir.",
      },
    ]),
  ];
  return {
    parts,
    connections,
    metrics: [
      {
        label: "Gross working water",
        value: Math.round(((L - 8) * (W - 8) * (h - 50)) / 1e4) / 100,
        unit: "L",
      },
      {
        label: "Tube cut allowance",
        value: Math.round(inletLength + n * 23),
        unit: "mm",
      },
      { label: "Daily run time", value: p.waterMinutes, unit: "min" },
      { label: "Watering outlets", value: n },
      {
        label: "Header above low water",
        value: Math.round((M + 12 - 42) * 100) / 100,
        unit: "mm",
      },
    ],
    steps: [
      {
        id: "reservoir",
        title: "Weld and leak-test the reservoir",
        instruction:
          "Cut polypropylene sheet and heat-weld the floor/wall seams. Weld the four posts and pump cradle without penetrating the floor. Keep the fill line 14 mm below the rim and mark a 42 mm low-water datum above the bottom of the assembly.",
        partIds: [
          "reservoir",
          "wall-front",
          "wall-back",
          "wall-left",
          "wall-right",
        ],
        check:
          "Verify welded seams and floor flatness in a separate leak test; no powered electronics during this test.",
      },
      {
        id: "pump",
        title: "Retain the pump and route its hose",
        instruction:
          "Measure the delivered pump before making the cage. Fit its liner and four spacers, close both retaining plates with M3 × 12 screws, and leave intake/wire openings clear. Fit the supplier-paired hose over the outlet; the model shows an expanded end, not a rigid 6 mm slip fit.",
        partIds: [
          "pump",
          "pump-cradle",
          "pump-liner",
          "pump-cap-0",
          "pump-cap-1",
          "inlet",
        ],
        check:
          "Pump cannot escape axially; intake stays open. Check actual pump revision, hose strain and retention before a wet test.",
      },
      {
        id: "cups",
        title: "Seat the draining cups",
        instruction:
          "Fasten the removable shelf using four M4 × 12 screws. Each cup body clears the plate by 0.5 mm radially and its rim seats on the top. Keep the central 4 mm drain clear; select a medium screen after checking root and media size.",
        partIds: ["shelf", ...xs.map((_, i) => `pot-${i}`)],
        check:
          "Cup rim bears on the shelf, drain stays above the reservoir and media cannot wash into the pump.",
      },
      {
        id: "water",
        title: "Close and support the manifold",
        instruction:
          "Heat-weld the drilled lower plate, channel body, end caps and hollow tails into a sealed header. Weld the end supports to the shelf and lower plate. Fit each outlet hose 8 mm onto its tail and keep its lower end 7 mm above the cup rim.",
        partIds: [
          "manifold",
          "manifold-lid",
          "manifold-cap-0",
          "manifold-cap-1",
          ...xs.map((_, i) => `outlet-${i}`),
        ],
        check:
          "Leak-test the header and every joint; verify all passages and outlet air gaps. Equal geometry does not prove equal flow.",
      },
      {
        id: "schedule",
        title: "Calibrate watering and protection",
        instruction:
          "Use a reviewed 3 V pump driver, protected supply and dry-run/timeout/leak stop. Keep controls dry, make a drip loop and route the cable through the spare shelf opening. Collect each outlet separately before choosing daily runtime.",
        partIds: ["pump", "water"],
        check:
          "Pump stays submerged at the marked low level. Record delivered volumes, overflow behavior and shutdown; no unattended long-term-use claim.",
      },
    ],
    warnings: [
      "Standard-parts planter v2 is a nominal prototype. Reservoir and manifold are fabricated from welded polypropylene; long panels are not desktop-print jobs. Weld strength, watertightness and creep need testing.",
      "Supplier pump page and drawing differ: cage reserves 46 × 23.9 mm. Measure the actual body, outlet, intake and wire exit before fabrication. The pump envelope omits internal impeller/flow details; the outlet is included with the pump in the BOM.",
      "Adafruit 4546 is a 3 V hobby pump that must stay submerged; the supplier does not recommend long-term installations. Pump and 4545 PVC hose are not drinking-water equipment. No food-contact or unattended-operation claim.",
      "Nominal hose ends show expansion at the 7.45 mm pump port and contact at custom 6 mm tails. Fit, clamps/restraint, bend/creep and leak performance are not proven. Hose allowance excludes commissioning spare.",
      "Gross working water is the volume between 42 mm and the fill datum before solid displacement; the moving water band only illustrates activity. The model does not predict flow distribution, plant demand, delivered volume or hydraulic performance.",
      "Select media screens, dry-run/level/leak sensing, driver/protection, supply, cable bushing and strain relief before operation. These are integration items, not installed electronics or working firmware. Nominal thread bores are not tap drills.",
    ],
  };
}
