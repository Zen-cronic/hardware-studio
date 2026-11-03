import type { Part, DerivedDesign, Vec3 } from "./types";

export function standardLamp(
  p: Record<string, number>,
): Omit<DerivedDesign, "bom"> {
  const link = p.reach / 2,
    theta = (p.angle * Math.PI) / 180,
    x = Math.sin(theta) * link,
    y = Math.cos(theta) * link,
    elbowY = 70 + y,
    hx = x + link,
    H = elbowY - 35;
  const parts: Part[] = [];
  const box = (
    id: string,
    name: string,
    size: Vec3,
    position: Vec3,
    material = "Aluminium",
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
    d: number,
    bore: number,
    height: number,
    bottom: number,
    x: number,
    z: number,
    material = "Steel",
    process: Part["process"] = "machine",
  ) => {
    const q: Part = {
      id,
      name,
      shape: bore ? "tube" : "cylinder",
      size: [d, height, d],
      position: [x, bottom + height / 2, z],
      ...(bore ? { holeDiameter: bore } : {}),
      material,
      process,
      color: process === "buy" ? "#353841" : "#C8CDD1",
    };
    parts.push(q);
    return q;
  };
  const axial = (
    id: string,
    name: string,
    d: number,
    bore: number,
    h: number,
    start: number,
    x: number,
    y: number,
    material = "Steel",
    process: Part["process"] = "buy",
  ) => {
    const q = round(id, name, d, bore, h, 0, x, 0, material, process);
    q.position = [x, y, start + h / 2];
    q.rotation = [Math.PI / 2, 0, 0];
    return q;
  };
  const screwY = (
    id: string,
    d: number,
    length: number,
    seat: number,
    x: number,
    z: number,
  ) => {
    const head = d === 6 ? 10 : 5.5,
      q = round(
        id,
        `DIN 912 M${d} × ${length} screw envelope`,
        head,
        0,
        length + d,
        seat - length,
        x,
        z,
        "Stainless steel",
        "buy",
      );
    q.sections = [
      { height: length, diameter: d, bore: 0 },
      { height: d, diameter: head, bore: 0 },
    ];
    return q;
  };
  const joint = (id: string, px: number, py: number, lowCenter: number) => {
    // Two 6 mm plates separated by a 2 mm friction washer; two 1.6 mm outer washers.
    const outer = lowCenter - 3;
    axial(
      `${id}-friction`,
      "Cut friction washer",
      20,
      6.5,
      2,
      lowCenter + 3,
      px,
      py,
      "Fibre friction sheet",
      "cut",
    );
    axial(
      `${id}-washer-front`,
      "DIN 125 M6 washer",
      12,
      6.4,
      1.6,
      outer - 1.6,
      px,
      py,
    );
    axial(
      `${id}-washer-rear`,
      "DIN 125 M6 washer",
      12,
      6.4,
      1.6,
      lowCenter + 11,
      px,
      py,
    );
    const bolt = axial(
      `${id}-screw`,
      "HPC HPCCM6-25 screw envelope",
      10,
      0,
      31,
      outer - 7.6,
      px,
      py,
      "Stainless steel",
    );
    bolt.sections = [
      { height: 6, diameter: 10, bore: 0 },
      { height: 25, diameter: 6, bore: 0 },
    ];
    axial(
      `${id}-nut`,
      "DIN 934 M6 nut — hex clearance envelope",
      20 / Math.sqrt(3),
      6,
      5,
      lowCenter + 12.6,
      px,
      py,
    );
  };
  const pad = round(
    "base-pad",
    "Bonded anti-slip base pad",
    p.baseDiameter,
    0,
    2,
    0,
    0,
    0,
    "Rubber",
    "cut",
  );
  pad.color = "#353841";
  const base = round(
    "base",
    "Weighted steel base — M6 thread envelopes",
    p.baseDiameter,
    0,
    20,
    2,
    0,
    0,
  );
  base.holes = [-15, 15].map((x) => ({ x, z: 0, diameter: 6 }));
  const foot = box(
    "base-foot",
    "Welded upright foot",
    [40, 6, 40],
    [0, 25, 0],
    "Steel",
  );
  foot.holes = [-15, 15].map((x) => ({ x, z: 0, diameter: 6.5 }));
  for (const [i, dx] of [-15, 15].entries())
    screwY(`base-screw-${i}`, 6, 16, 28, dx, 0);
  const upright = box(
    "pivot-lower",
    "Welded base upright",
    [24, 6, 57],
    [0, 56.5, -8],
    "Steel",
  );
  upright.rotation = [Math.PI / 2, 0, 0];
  upright.holes = [{ x: 0, z: -13.5, diameter: 6.5 }];
  const lower = box(
    "lower-arm",
    "Lower link with pivot clearances",
    [link + 24, 6, 24],
    [x / 2, 70 + y / 2, 0],
  );
  lower.rotation = [Math.PI / 2, Math.PI / 2 - theta, 0];
  lower.holes = [-link / 2, link / 2].map((x) => ({ x, z: 0, diameter: 6.5 }));
  const upper = box(
    "upper-arm",
    "Upper link with pivot clearances",
    [link + 24, 6, 24],
    [x + link / 2, elbowY, 8],
  );
  upper.rotation = [Math.PI / 2, 0, 0];
  upper.holes = [-link / 2, link / 2].map((x) => ({ x, z: 0, diameter: 6.5 }));
  joint("base-joint", 0, 70, -8);
  joint("elbow-joint", x, elbowY, 0);
  const lug = box(
    "head-lug",
    "Welded head mounting lug",
    [24, 6, 43],
    [hx, elbowY - 9.5, 16],
  );
  lug.rotation = [Math.PI / 2, 0, 0];
  lug.holes = [{ x: 0, z: -9.5, diameter: 6.5 }];
  joint("head-joint", hx, elbowY, 8);
  const pattern = Array.from({ length: 3 }, (_, i) => ({
    x: 34.5 * Math.cos((i * 2 * Math.PI) / 3),
    z: 34.5 * Math.sin((i * 2 * Math.PI) / 3),
    diameter: 3.4,
  }));
  const cap = round(
    "head-cap",
    "Welded aluminium head cap with cable exit",
    74,
    8,
    4,
    H,
    hx,
    0,
    "Aluminium",
  );
  cap.holes = [
    ...pattern,
    ...[-10, 10].map((x) => ({ x, z: 0, diameter: 3.4 })),
  ];
  const shade = round(
    "shade",
    "Hollow light housing",
    74,
    64,
    18,
    H - 18,
    hx,
    0,
    "Aluminium",
  );
  shade.holes = pattern;
  const retainer = round(
    "diffuser-retainer",
    "Diffuser retaining ring — M3 thread envelopes",
    74,
    58,
    3,
    H - 21,
    hx,
    0,
    "Aluminium",
  );
  retainer.holes = pattern.map((h) => ({ ...h, diameter: 3 }));
  pattern.forEach((h, i) =>
    screwY(`housing-screw-${i}`, 3, 25, H + 4, hx + h.x, h.z),
  );
  const spreader = round(
    "spreader",
    "LED spreader — M3 thread envelopes",
    50,
    8,
    3,
    H - 3,
    hx,
    0,
    "Aluminium",
  );
  spreader.holes = [-10, 10].map((x) => ({ x, z: 0, diameter: 3 }));
  for (const [i, dx] of [-10, 10].entries())
    screwY(`spreader-screw-${i}`, 3, 6, H + 4, hx + dx, 0);
  round(
    "thermal-pad",
    "Die-cut 3M 8810 thermal adhesive",
    44.5,
    31.75,
    0.25,
    H - 3.25,
    hx,
    0,
    "3M 8810 tape",
    "cut",
  );
  const led = round(
    "led",
    "Adafruit 2855 RGBW ring envelope",
    44.5,
    31.75,
    3.25,
    H - 6.5,
    hx,
    0,
    "5 V RGBW LED module",
    "buy",
  );
  const light =
    "#" +
    [
      Math.round(90 + (165 * p.brightness) / 100),
      Math.round(85 + (158 * p.brightness) / 100),
      Math.round(65 + (111 * p.brightness) / 100),
    ]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
  led.color = light;
  const diffuser = round(
    "diffuser",
    "Retained opal diffuser",
    63,
    0,
    2,
    H - 18,
    hx,
    0,
    "Opal polycarbonate",
    "cut",
  );
  diffuser.color = light;
  const grossMass =
    Math.PI * ((p.baseDiameter * p.baseDiameter) / 4 - 18) * 20 * 7.85e-6;
  return {
    parts,
    metrics: [
      {
        label: "Horizontal reach",
        value: Math.round(hx * 100) / 100,
        unit: "mm",
      },
      {
        label: "Cable allowance",
        value: Math.round(p.reach + 300),
        unit: "mm",
      },
      { label: "Light setting", value: p.brightness, unit: "%" },
      {
        label: "Base mass estimate",
        value: Math.round(grossMass * 100) / 100,
        unit: "kg",
      },
      {
        label: "Reach / base",
        value: Math.round((p.reach / p.baseDiameter) * 100) / 100,
        unit: "ratio",
      },
    ],
    connections: [
      {
        from: "base",
        to: "lower-arm",
        description:
          "Bolted foot and welded upright; M6 retained friction joint.",
      },
      {
        from: "lower-arm",
        to: "upper-arm",
        description:
          "Aligned 6.5 mm clearances, 2 mm friction washer, M6 × 25 bolt and nut.",
      },
      {
        from: "upper-arm",
        to: "head-lug",
        description: "Retained friction joint to welded head cap.",
      },
      {
        from: "head-cap",
        to: "led",
        description:
          "Spreader and die-cut 3M 8810 bond; cable exits through 8 mm hole. Inspect actual board contact and add strain relief.",
      },
      {
        from: "led",
        to: "diffuser",
        description:
          "5 V integrated-driver white channel; lower retaining ring captures the diffuser.",
      },
    ],
    steps: [
      {
        id: "base",
        title: "Prepare the base and bracket",
        instruction:
          "Weld the upright to its foot with the pivot datum controlled. Bolt the foot to the weighted steel base using M6 × 16 screws, then bond the anti-slip pad. Nominal M6 holes are thread envelopes, not tap drills.",
        partIds: ["base", "base-foot", "pivot-lower"],
        check:
          "Inspect weld, thread engagement and base support before attaching arms.",
      },
      {
        id: "arms",
        title: "Fit the retained friction joints",
        instruction:
          "Place each 2 mm friction washer between adjacent 6 mm plates. Add a 1.6 mm steel washer outside each plate, pass the M6 × 25 bolt through, and fit its matched M6 nut. Support the head while adjusting; review locking and preload.",
        partIds: [
          "lower-arm",
          "upper-arm",
          "base-joint-screw",
          "elbow-joint-screw",
          "head-joint-screw",
        ],
        check:
          "All three joints rotate without interference and retain the head at the chosen pose; holding torque is not established by CAD.",
      },
      {
        id: "light",
        title: "Build the hollow light housing",
        instruction:
          "Weld the head lug to the cap. Fasten the spreader below the cap with two M3 × 6 screws. Prepare and bond the LED back with the annular 3M 8810 pad. Seat the opal diffuser on the lower retaining ring and secure the housing with three M3 × 25 screws.",
        partIds: [
          "head-lug",
          "head-cap",
          "shade",
          "spreader",
          "thermal-pad",
          "led",
          "diffuser",
          "diffuser-retainer",
        ],
        check:
          "Confirm board orientation, adhesive contact, insulation, screw entry and diffuser retention. The LED component details are an envelope.",
      },
      {
        id: "cable",
        title: "Route and commission the light",
        instruction:
          "Route flexible low-voltage wiring externally with slack at all three joints. Use a reviewed bushing and strain relief at the 8 mm cap hole. Connect the RGBW-compatible controller and protected regulated 5 V supply using the supplier guide.",
        partIds: ["head-cap", "led"],
        check:
          "Measure illumination, full-range cable clearance, joint holding, balance and temperatures before prolonged use.",
      },
    ],
    warnings: [
      "Standard-parts lamp v2 uses nominal purchased envelopes and manufactured links/brackets/housing; socket recesses, threads and LED component details are omitted.",
      "Welds, friction preload, nut locking, stiffness and wear require physical review. The reach/base ratio and base-mass estimate do not establish stability or holding capacity.",
      "Adafruit 2855 uses 5 V and an integrated digital RGBW driver. No mains wiring, external constant-current LED driver, firmware, measured brightness or thermal certification is supplied.",
      "3M 8810 requires compatible clean substrates, pressure and verified adhesion. Inspect actual PCB solder joints and dielectric separation; contact faces do not prove thermal performance.",
      "Cable clips, selected bushing/strain relief, controller, protected supply and electrical protection remain integration items; the cable allowance is a routing estimate, not an installed harness.",
    ],
  };
}
