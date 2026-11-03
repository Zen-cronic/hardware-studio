import type { Part, DerivedDesign, Vec3 } from "./types";

// Nominal purchased interfaces plus explicitly manufactured frame/roller parts.
export function standardConveyor(
  p: Record<string, number>,
): Omit<DerivedDesign, "bom"> {
  const l = p.length,
    w = p.beltWidth,
    C = l - 60,
    axisY = 60,
    front = -w / 2,
    rear = w / 2,
    rpm = (p.speed * 60) / (Math.PI * 40);
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
    d: number,
    bore: number,
    h: number,
    bottom: number,
    x: number,
    z: number,
    process: Part["process"] = "machine",
    material = "Steel",
  ) => {
    const q: Part = {
      id,
      name,
      shape: bore ? "tube" : "cylinder",
      size: [d, h, d],
      position: [x, bottom + h / 2, z],
      ...(bore ? { holeDiameter: bore } : {}),
      process,
      material,
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
    zStart: number,
    x: number,
    y: number,
    process: Part["process"] = "machine",
    material = "Steel",
  ) => {
    const q = round(id, name, d, bore, h, 0, x, 0, process, material);
    q.position = [x, y, zStart + h / 2];
    q.rotation = [Math.PI / 2, 0, 0];
    return q;
  };
  const plate = (
    id: string,
    name: string,
    dx: number,
    dy: number,
    thick: number,
    x: number,
    y: number,
    z: number,
  ) => {
    const q = box(id, name, [dx, thick, dy], [x, y, z]);
    q.rotation = [Math.PI / 2, 0, 0];
    return q;
  };
  const pattern = (r: number, n: number, d: number) =>
    Array.from({ length: n }, (_, i) => ({
      x: r * Math.cos((i * 2 * Math.PI) / n),
      z: r * Math.sin((i * 2 * Math.PI) / n),
      diameter: d,
    }));
  const spin = (q: Part) => {
    q.motion = { type: "rotate", axis: "z", speed: -rpm };
    return q;
  };
  const boltY = (
    id: string,
    d: number,
    length: number,
    seat: number,
    x: number,
    z: number,
    parentId?: string,
  ) => {
    const q = round(
      id,
      `M${d} × ${length} screw envelope`,
      d === 3 ? 5.5 : 8,
      0,
      length + d,
      seat - length,
      x,
      z,
      "buy",
    );
    q.sections = [
      { height: length, diameter: d, bore: 0 },
      { height: d, diameter: d === 3 ? 5.5 : 8, bore: 0 },
    ];
    if (parentId) q.parentId = parentId;
    return q;
  };
  const boltZ = (
    id: string,
    d: number,
    length: number,
    seat: number,
    x: number,
    y: number,
    sign: number,
  ) => {
    const q = boltY(id, d, length, 0, 0, 0);
    q.position = [x, y, seat - (sign * (length - d)) / 2];
    q.rotation = [(sign * Math.PI) / 2, 0, 0];
    return q;
  };
  const base = box(
    "base",
    "Welded-frame base plate",
    [l + 20, 6, w + 170],
    [0, 11, -15],
  );
  const rails: Part[] = [];
  for (const [name, z] of [
    ["front", front - 16],
    ["rear", rear + 16],
  ] as const) {
    const rail = plate(
      `frame-${name}`,
      `${name} welded side plate — Ø3 holes are M3 thread envelopes`,
      l,
      66,
      7,
      0,
      47,
      z,
    );
    rail.holes = [];
    rails.push(rail);
  }
  for (const [beamIndex, x] of [-C / 2 + 45, C / 2 - 45].entries()) {
    const beam = box(
      `bed-beam-${beamIndex}`,
      "Crossbeam — M4 thread envelope",
      [12, w + 25, 8],
      [x, 74, 0],
    );
    beam.rotation = [Math.PI / 2, 0, 0];
    beam.holes = [{ x: 0, z: 0, diameter: 4 }];
    for (const [i, sign] of [-1, 1].entries()) {
      rails[i].holes!.push({ x, z: -27, diameter: 4.5 });
      boltZ(
        `bed-screw-${beamIndex}-${sign}`,
        4,
        12,
        sign * (w / 2 + 19.5),
        x,
        74,
        sign,
      );
    }
  }
  box("bed", "Upper-run support bed", [C - 42, 2, w - 4], [0, 79, 0]);
  const belt = axial(
    "belt",
    "Smooth conveyor belt — nominal 2 mm envelope",
    44,
    40,
    w,
    -w / 2,
    0,
    axisY,
    "buy",
    "Conveyor belting",
  );
  belt.loopSpan = C;
  belt.size[0] = C + 44;
  for (const [name, x] of [
    ["in", -C / 2],
    ["out", C / 2],
  ] as const) {
    const start = front - (name === "out" ? 62 : 43),
      end = rear + 43;
    const roller = spin(
      axial(
        `roller-${name}`,
        `${name} one-piece turned roller and 8 mm journals`,
        40,
        0,
        end - start,
        start,
        x,
        axisY,
      ),
    );
    roller.sections = [
      { height: front - 2 - start, diameter: 8, bore: 0 },
      { height: w + 4, diameter: 40, bore: 0 },
      { height: end - (rear + 2), diameter: 8, bore: 0 },
    ];
    for (const [i, sign] of [-1, 1].entries()) {
      const label = `${name}-${sign}`,
        nominal = (distance: number) => sign * (w / 2 + distance);
      // Frame is the stationary backing. Cartridge moves at most +/-1 mm on the idler.
      rails[i].holes!.push({ x, z: -13, diameter: 18 });
      for (const h of pattern(15, 3, 3))
        rails[i].holes!.push({ x: x + h.x, z: -13 + h.z, diameter: 3 });
      const disks: [string, string, number, number][] = [
        ["shoulder", "outer-race shoulder", 18, 3],
        ["seat", "608 bearing seat", 22.1, 7],
        ["retainer", "outer-race retainer", 18, 3],
      ];
      let distance = 19.5;
      for (const [id, title, bore, height] of disks) {
        const q = axial(
          `${label}-${id}`,
          `${label} ${title}`,
          36,
          bore,
          height,
          Math.min(nominal(distance), nominal(distance + height)),
          x,
          axisY,
        );
        q.holes = pattern(15, 3, name === "in" ? 5.5 : 3.4);
        distance += height;
      }
      axial(
        `${label}-bearing`,
        "608 bearing envelope (8 × 22 × 7)",
        22,
        8,
        7,
        Math.min(nominal(22.5), nominal(29.5)),
        x,
        axisY,
        "buy",
        "Bearing steel",
      );
      spin(
        axial(
          `${label}-inner-spacer`,
          "Roller shoulder to bearing inner-race spacer",
          12,
          8.1,
          20.5,
          Math.min(nominal(2), nominal(22.5)),
          x,
          axisY,
        ),
      );
      spin(
        axial(
          `${label}-outer-spacer`,
          "Bearing inner-race to collar spacer",
          12,
          8.1,
          4.5,
          Math.min(nominal(29.5), nominal(34)),
          x,
          axisY,
        ),
      );
      spin(
        axial(
          `${label}-collar`,
          "Ruland MCL-8-A clamp envelope",
          22.4,
          8,
          9,
          Math.min(nominal(34), nominal(43)),
          x,
          axisY,
          "buy",
          "Aluminium collar",
        ),
      );
      pattern(15, 3, 3).forEach((h, k) => {
        axial(
          `${label}-washer-${k}`,
          "Wide bearing-cartridge retaining washer",
          9,
          3.4,
          1,
          Math.min(nominal(32.5), nominal(33.5)),
          x + h.x,
          axisY - h.z,
        );
        boltZ(
          `${label}-screw-${k}`,
          3,
          20,
          nominal(33.5),
          x + h.x,
          axisY - h.z,
          sign,
        );
      });
    }
  }
  // Drive face points toward +Z. The motor itself is outside the belt/frame.
  const driveX = C / 2,
    face = front - 87.8;
  const motorPlate = plate(
    "motor-plate",
    "Welded drive mounting plate",
    52,
    72,
    4,
    driveX,
    50,
    face + 2,
  );
  motorPlate.holes = [
    { x: 0, z: -10, diameter: 12.5 },
    ...pattern(15.5, 6, 3.4).map((h) => ({ ...h, z: h.z - 10 })),
  ];
  axial(
    "motor",
    "Pololu 4756 motor clearance envelope",
    37,
    0,
    73,
    face - 73,
    driveX,
    axisY,
    "buy",
    "12 V encoded gearmotor",
  );
  axial(
    "motor-pilot",
    "Integral motor pilot envelope",
    12,
    6,
    1.6,
    face,
    driveX,
    axisY,
    "buy",
    "Integral motor feature",
  );
  spin(
    axial(
      "motor-shaft",
      "6 mm D-shaft clearance envelope",
      6,
      0,
      16,
      face,
      driveX,
      axisY,
      "buy",
      "Integral motor feature",
    ),
  );
  pattern(15.5, 6, 3).forEach((h, i) =>
    boltZ(`motor-screw-${i}`, 3, 6, face + 4, driveX + h.x, axisY - h.z, 1),
  );
  const coupling = spin(
    axial(
      "coupling",
      "Ruland PCMR25-8-6-SS envelope",
      25.4,
      6,
      31.8,
      front - 79.8,
      driveX,
      axisY,
      "buy",
      "Stainless coupling",
    ),
  );
  coupling.sections = [
    { height: 14.7, diameter: 25.4, bore: 6 },
    { height: 17.1, diameter: 25.4, bore: 8 },
  ];
  // Gate uses a documented stepper and a bolted 5 mm hub, rather than a floating blade.
  const gx = l / 2 - 55,
    gz = front + 8;
  const post = box(
    "gate-post",
    "Gate support post",
    [22, 110, 14],
    [gx, 69, gz - 53],
  );
  post.holes = [-6, 6].map((x) => ({ x, z: 0, diameter: 4.5 }));
  const top = box(
    "gate-mount",
    "Gate actuator mounting plate",
    [60, 4, 88],
    [gx, 126, gz - 26],
  );
  top.holes = [
    { x: 0, z: 26, diameter: 23 },
    ...[-1, 1].flatMap((a) =>
      [-1, 1].map((b) => ({ x: a * 15.5, z: 26 + b * 15.5, diameter: 3.4 })),
    ),
    ...[-6, 6].map((x) => ({ x, z: -27, diameter: 4.5 })),
  ];
  for (const dx of [-6, 6]) {
    base.holes ??= [];
    base.holes.push({ x: gx + dx, z: gz - 53 + 15, diameter: 4 });
    boltY(`gate-post-screw-${dx}`, 4, 120, 128, gx + dx, gz - 53);
  }
  box(
    "gate-motor",
    "Pololu 2267 gate stepper envelope",
    [42.3, 38, 42.3],
    [gx, 147, gz],
    "buy",
    "Bipolar stepper",
  );
  const gateShaft = round(
    "gate-shaft",
    "Integral 5 mm D-shaft envelope",
    5,
    0,
    24,
    104,
    gx,
    gz,
    "buy",
    "Integral motor feature",
  );
  for (const a of [-1, 1])
    for (const b of [-1, 1]) {
      // Inverted M3 screws seat on underside of the 4 mm plate, 2 mm into motor.
      const q = boltY(`gate-motor-screw-${a}-${b}`, 3, 6, 0, 0, 0);
      q.rotation = [Math.PI, 0, 0];
      q.position = [gx + a * 15.5, 125.5, gz + b * 15.5];
    }
  const hub = round(
    "diverter",
    "Pololu 1998 5 mm gate hub envelope",
    19,
    5,
    5,
    103,
    gx,
    gz,
    "buy",
    "Aluminium hub",
  );
  hub.holes = pattern(6.35, 4, 3);
  hub.motion = { type: "pivot", axis: "y", speed: 0.7, range: Math.PI / 3 };
  gateShaft.parentId = "diverter";
  const gateLength = w / 2 + 30,
    gateOffset = gateLength / 2 - 10;
  const arm = box(
    "gate-arm",
    "Welded gate arm plate",
    [gateLength, 3, 24],
    [gx - gateOffset, 109.5, gz],
  );
  arm.parentId = "diverter";
  arm.holes = [
    { x: gateOffset, z: 0, diameter: 5.5 },
    ...pattern(6.35, 4, 3.4).map((h) => ({ ...h, x: h.x + gateOffset })),
  ];
  const blade = box(
    "gate-blade",
    "Welded gate blade",
    [gateLength - 22, 23, 3],
    [gx - (gateLength + 2) / 2, 96.5, gz],
  );
  blade.parentId = "diverter";
  pattern(6.35, 4, 3).forEach((h, i) =>
    boltY(`gate-arm-screw-${i}`, 3, 8, 111, gx + h.x, gz + h.z, "diverter"),
  );
  // Sensor sits outside the rear frame on a bolted post and welded angle cradle.
  const sx = -l / 2 + p.sensorPosition,
    sz = rear + 24;
  const spost = box(
    "sensor-post",
    "Sensor support post",
    [22, 76, 14],
    [sx, 52, rear + 60],
  );
  spost.holes = [-6, 6].map((x) => ({ x, z: 0, diameter: 4.5 }));
  const foot = box(
    "sensor-platform",
    "Sensor platform with welded side cradle",
    [30, 4, 70],
    [sx, 92, rear + 35],
  );
  foot.holes = [-6, 6].map((x) => ({ x, z: 25, diameter: 4.5 }));
  for (const dx of [-6, 6]) {
    base.holes ??= [];
    base.holes.push({ x: sx + dx, z: rear + 75, diameter: 4 });
    boltY(`sensor-post-screw-${dx}`, 4, 86, 94, sx + dx, rear + 60);
  }
  const cradle = box(
    "sensor-bracket",
    "Welded sensor side plate",
    [31, 3, 26],
    [sx - 6.9, 109.5, sz],
  );
  cradle.rotation = [0, 0, -Math.PI / 2];
  cradle.holes = [-12.7, 12.7].map((x) => ({ x, z: -7, diameter: 3.4 }));
  const sensor = box(
    "sensor",
    "Omron E3Z-D62 sensor envelope",
    [31, 10.8, 20],
    [sx, 109.5, sz],
    "buy",
    "Diffuse NPN photoelectric sensor",
  );
  sensor.rotation = [0, 0, -Math.PI / 2];
  sensor.holes = [-12.7, 12.7].map((x) => ({ x, z: -7, diameter: 3 }));
  for (const [sensorIndex, dy] of [-12.7, 12.7].entries()) {
    const q = boltY(`sensor-screw-${sensorIndex}`, 3, 12, 0, 0, 0);
    q.rotation = [0, 0, Math.PI / 2];
    q.position = [sx - 3.9, 109.5 + dy, sz - 7];
  }
  const parcel = box(
    "parcel",
    "Sample object",
    [25, 25, 25],
    [-l / 2 + 50, 94.5, 0],
    "buy",
    "Reference envelope",
  );
  parcel.color = "#B74C60";
  parcel.motion = { type: "slide", axis: "x", speed: p.speed, range: l - 100 };
  const delay = (l - 55 - p.sensorPosition) / p.speed;
  return {
    parts,
    metrics: [
      {
        label: "Sensor-to-gate delay",
        value: Math.round(delay * 100) / 100,
        unit: "s",
      },
      {
        label: "Belt loop estimate",
        value: Math.round((2 * C + Math.PI * 42) * 100) / 100,
        unit: "mm",
      },
      {
        label: "Roller speed",
        value: Math.round(rpm * 100) / 100,
        unit: "rpm",
      },
      { label: "Sensor offset", value: p.sensorPosition, unit: "mm" },
      { label: "Idler adjustment limit", value: 1, unit: "mm" },
    ],
    connections: [
      {
        from: "motor",
        to: "coupling",
        description:
          "6 mm D shaft to 8 mm roller journal; check clamp suitability and shaft penetration.",
      },
      {
        from: "roller-out",
        to: "belt",
        description:
          "40 mm roller sets nominal surface speed; crown, friction, tracking and tension require physical review.",
      },
      {
        from: "sensor",
        to: "diverter",
        description: `Nominal detection-to-gate delay ${delay.toFixed(2)} s; real reflectance, timing and actuation are not simulated.`,
      },
      {
        from: "gate-motor",
        to: "diverter",
        description:
          "5 mm shaft with Pololu 1998 hub, four M3 screws and included set screw; independent bipolar stepper driver and homing required.",
      },
    ],
    steps: [
      {
        id: "frame",
        title: "Prepare the frame and bed",
        instruction:
          "Weld the base, two side plates and motor mounting plate as a reviewed fixture. Machine final bearing/bolt datums after controlling weld distortion. Fit the two crossbeams and upper-run bed.",
        partIds: ["base", "frame-front", "frame-rear", "motor-plate", "bed"],
        check:
          "Frame is square and the bed supports the upper run without rubbing rollers or the return run.",
      },
      {
        id: "rollers",
        title: "Retain the rollers and bearings",
        instruction:
          "Fit each one-piece turned roller with inner-race spacers and 608 bearings. Sandwich each outer race between its shoulder and retaining plates; secure with wide washers and M3 × 20 screws. Set end play with the outer spacers and clamp collars.",
        partIds: ["roller-in", "roller-out", "in--1-bearing", "out-1-bearing"],
        check:
          "Both rollers turn freely; measured fits, parallelism and axial end play are acceptable.",
      },
      {
        id: "belt",
        title: "Fit and track the belt",
        instruction:
          "Install a supplier-selected belt around both rollers. Loosen both infeed cartridges and move them equally by no more than 1 mm along X, then retighten. The smooth 2 mm model does not specify belt stock, splice or recommended tension.",
        partIds: ["belt", "in--1-seat", "in-1-seat", "bed"],
        check:
          "Confirm washer coverage, tracking, crown/profile and tension with the actual belt supplier.",
      },
      {
        id: "drive",
        title: "Connect the conveyor drive",
        instruction:
          "Mount the Pololu 4756 with M3 × 6 screws through the 4 mm plate (2 mm nominal gearbox entry). Align the 6-to-8 mm coupling without forcing the shafts together; verify D-flat clamping.",
        partIds: ["motor", "motor-plate", "coupling", "roller-out"],
        check:
          "Neither shaft exceeds 14.7 mm coupling penetration; leads and rotating parts remain clear.",
      },
      {
        id: "sensor",
        title: "Mount the sensor and gate",
        instruction:
          "Bolt the sensor post/platform and gate post/plate to the base. Weld the sensor side cradle to its platform, then install the E3Z-D62 with two M3 screws. Mount the downward-facing 2267 stepper, 5 mm hub and bolted gate arm. Weld the blade to the arm before final alignment.",
        partIds: [
          "sensor",
          "sensor-bracket",
          "sensor-platform",
          "gate-motor",
          "diverter",
          "gate-arm",
          "gate-blade",
        ],
        check:
          "Verify sensor lens/cable clearance, hub set screw, gate sweep and unloaded movement.",
      },
      {
        id: "controls",
        title: "Review control and stop behavior",
        instruction:
          "Select protected supplies, a DC H-bridge, bipolar gate driver, encoder interface and isolated/level-compatible NPN sensor input. Establish gate home/limits and a deliberate stop function before powered tests.",
        partIds: ["motor", "sensor", "gate-motor"],
        check:
          "Measured belt speed, sensing reliability and actuator response validate the delay before moving objects.",
      },
    ],
    warnings: [
      "Standard-parts conveyor v2 uses nominal purchased envelopes and custom welded/turned parts; threads, clamp slots, teeth and internal bearing features are omitted.",
      "Frame and gate welds require joint preparation, distortion control and strength review; touching CAD faces do not prove a structural joint.",
      "Idler cartridges allow at most ±1 mm X adjustment with wide washers. No belt stock, splice, tension, crown or tracking performance is selected or verified.",
      "Gate/parcel animation illustrates control intent, not a physics or sensor model. Electrical drivers, protection, gate homing, cable routing and achievable speed remain unverified.",
      "Sensor lens/adjuster protrusions and cables are omitted. Nominal M3/M4 holes represent threads, not tap-drill dimensions. Confirm current supplier geometry and measured fits before fabrication.",
    ],
  };
}
