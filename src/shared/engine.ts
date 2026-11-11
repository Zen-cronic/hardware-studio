import { standardHolder, holderPitch } from "./holder";
import { standardPlanter } from "./planter";
import { standardLamp } from "./lamp";
import { standardConveyor } from "./conveyor";
import { standardSlider } from "./slider";
import { standardTurntable } from "./turntable";
import { defaultParams, getProduct, productForDesign } from "./catalog";
import { applyLook } from "./looks";
import type {
  Design,
  ProductKind,
  Part,
  Vec3,
  DerivedDesign,
  BomItem,
  AssemblyStep,
  Metric,
  Connection,
} from "./types";
export class DesignError extends Error {
  constructor(
    message: string,
    public code = "INVALID_DESIGN",
    public conflicts: string[] = [],
  ) {
    super(message);
  }
}
export function createDesign(
  kind: ProductKind,
  name?: string,
  customParts?: Part[],
): Design {
  const now = new Date().toISOString();
  const d: Design = {
    id: crypto.randomUUID(),
    kind,
    name: name?.trim().slice(0, 120) || getProduct(kind).name,
    revision: 0,
    ...([
      "turntable",
      "slider",
      "conveyor",
      "lamp",
      "planter",
      "holder",
    ].includes(kind)
      ? { mechanismVersion: 2 as const }
      : {}),
    params: defaultParams(kind),
    createdAt: now,
    updatedAt: now,
  };
  if (kind === "custom")
    d.customParts = customParts?.length
      ? structuredClone(customParts)
      : [
          {
            id: "base",
            name: "Base",
            shape: "box",
            size: [120, 12, 80],
            position: [0, 6, 0],
            color: "#CFD3D8",
            material: "PETG",
            process: "print",
          },
        ];
  validateDesign(d);
  return d;
}
const groups: Partial<Record<ProductKind, string[][]>> = {
  turntable: [["diameter", "shaftDiameter"]],
  slider: [["railSpacing", "cameraWidth"]],
  conveyor: [["length", "sensorPosition"]],
  lamp: [["reach", "baseDiameter"]],
  holder: [["jawWidth", "opening", "screwDiameter"]],
};
export function readDependencies(
  kind: ProductKind,
  changes: Record<string, number>,
): string[] {
  const keys = new Set(Object.keys(changes));
  for (const g of groups[kind] || [])
    if (g.some((k) => keys.has(k))) g.forEach((k) => keys.add(k));
  return [...keys];
}
export function readSetFor(
  design: Design,
  changes: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    readDependencies(design.kind, changes).map((k) => [k, design.params[k]]),
  );
}
export function validateParts(
  parts: Part[],
  maximum = 256,
  minimumDimension = 0.25,
): void {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > maximum)
    throw new DesignError(`Use between 1 and ${maximum} parts.`);
  const ids = new Set<string>();
  for (const part of parts) {
    if (!part || typeof part !== "object" || Array.isArray(part))
      throw new DesignError("Each part must be an object.");
    if (
      typeof part.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,60}$/.test(part.id) ||
      ids.has(part.id)
    )
      throw new DesignError("Parts need unique simple identifiers.");
    ids.add(part.id);
    if (
      typeof part.name !== "string" ||
      !part.name.trim() ||
      part.name.length > 120
    )
      throw new DesignError("Each part needs a short name.");
    if (!["box", "cylinder", "tube", "ellipsoid"].includes(part.shape))
      throw new DesignError("Use box, cylinder, tube or ellipsoid geometry.");
    if (
      !Array.isArray(part.size) ||
      part.size.length !== 3 ||
      part.size.some(
        (n) => !Number.isFinite(n) || n < minimumDimension || n > 5000,
      )
    )
      throw new DesignError(
        `Part dimensions must be between ${minimumDimension} and 5000 mm.`,
      );
    if (
      !Array.isArray(part.position) ||
      part.position.length !== 3 ||
      part.position.some((n) => !Number.isFinite(n) || Math.abs(n) > 10000)
    )
      throw new DesignError(
        "Part positions are outside the supported workspace.",
      );
    if (
      part.rotation !== undefined &&
      (!Array.isArray(part.rotation) ||
        part.rotation.length !== 3 ||
        part.rotation.some(
          (n) => !Number.isFinite(n) || Math.abs(n) > Math.PI * 4,
        ))
    )
      throw new DesignError("Part rotations must be finite radians.");
    if (part.loopSpan !== undefined) {
      if (
        part.shape !== "tube" ||
        !Number.isFinite(part.loopSpan) ||
        part.loopSpan < 0.5 ||
        Math.abs(part.size[0] - part.size[2] - part.loopSpan) > 1e-6 ||
        part.sections !== undefined ||
        part.holes !== undefined ||
        part.channel !== undefined
      )
        throw new DesignError(
          "A loop requires tube geometry, matching span and no additional features.",
        );
    }
    if (
      part.shape !== "box" &&
      part.loopSpan === undefined &&
      Math.abs(part.size[0] - part.size[2]) > 1e-8
    )
      throw new DesignError(
        "Cylinder and tube diameters must match on X and Z.",
      );
    if (
      part.shape === "ellipsoid" &&
      (part.holeDiameter !== undefined ||
        part.sections !== undefined ||
        part.holes !== undefined ||
        part.loopSpan !== undefined)
    )
      throw new DesignError(
        "An ellipsoid is a plain rounded solid: no bore, sections or holes.",
      );
    if (part.edgeRadius !== undefined) {
      const smallest = Math.min(...part.size);
      if (
        part.shape !== "box" ||
        !Number.isFinite(part.edgeRadius) ||
        part.edgeRadius < 0.2 ||
        part.edgeRadius > smallest / 2 - 0.05 ||
        part.holes !== undefined ||
        part.channel !== undefined
      )
        throw new DesignError(
          "Rounded edges need a box, a radius under half its smallest side, and no holes or channel.",
        );
    }
    if (
      part.wall !== undefined &&
      (part.edgeRadius === undefined ||
        !Number.isFinite(part.wall) ||
        part.wall < 0.5 ||
        part.wall >= part.edgeRadius ||
        part.wall > Math.min(...part.size) / 2 - 0.5)
    )
      throw new DesignError(
        "A hollow shell needs rounded edges and a wall thinner than the edge radius.",
      );
    if (
      part.role !== undefined &&
      !["component", "reference"].includes(part.role)
    )
      throw new DesignError("Part role must be component or reference.");
    if (
      part.shape === "tube" &&
      (!Number.isFinite(part.holeDiameter) ||
        part.holeDiameter! <= 0 ||
        part.holeDiameter! >= part.size[2] - 0.5)
    )
      throw new DesignError("A tube needs a smaller, positive bore.");
    if (part.sections !== undefined) {
      if (
        part.shape === "box" ||
        !Array.isArray(part.sections) ||
        !part.sections.length ||
        part.sections.length > 16 ||
        part.sections.some(
          (s) =>
            !s ||
            !Number.isFinite(s.height) ||
            s.height < 0.5 ||
            !Number.isFinite(s.diameter) ||
            s.diameter < 0.5 ||
            s.diameter > part.size[0] ||
            !Number.isFinite(s.bore) ||
            s.bore < 0 ||
            s.bore >= s.diameter - 0.5,
        ) ||
        Math.abs(
          part.sections.reduce((n, s) => n + s.height, 0) - part.size[1],
        ) > 1e-6 ||
        Math.abs(
          Math.max(...part.sections.map((s) => s.diameter)) - part.size[0],
        ) > 1e-6 ||
        part.sections.some(
          (s, i, a) =>
            i > 0 &&
            Math.min(s.diameter, a[i - 1].diameter) <=
              Math.max(s.bore, a[i - 1].bore) + 0.5,
        )
      )
        throw new DesignError(
          "Axial sections must form one connected solid within the part dimensions.",
        );
    }
    if (part.channel !== undefined) {
      const c = part.channel;
      if (
        part.shape !== "box" ||
        !c ||
        !Number.isFinite(c.width) ||
        !Number.isFinite(c.depth) ||
        c.width < 0.5 ||
        c.width > part.size[2] - 1 ||
        c.depth < 0.5 ||
        c.depth > part.size[1] - 0.5
      )
        throw new DesignError(
          "An underside channel must leave connected side walls and a roof.",
        );
    }
    if (part.holes !== undefined) {
      if (!Array.isArray(part.holes) || part.holes.length > 128)
        throw new DesignError("Too many through holes.");
      const sections = part.sections || [
        {
          diameter: part.size[0],
          bore: part.shape === "tube" ? part.holeDiameter! : 0,
        },
      ];
      for (const [i, h] of part.holes.entries()) {
        if (
          !h ||
          ![h.x, h.z, h.diameter].every(Number.isFinite) ||
          h.diameter < 0.5
        )
          throw new DesignError("Invalid through hole.");
        if (h.counterbore !== undefined) {
          const c = h.counterbore;
          if (
            part.shape !== "box" ||
            !c ||
            !Number.isFinite(c.diameter) ||
            !Number.isFinite(c.depth) ||
            c.diameter < h.diameter + 0.5 ||
            c.depth < 0.5 ||
            c.depth > part.size[1] - 0.5
          )
            throw new DesignError(
              "A counterbore needs a larger diameter and a positive floor in a box part.",
            );
        }
        const radius = Math.hypot(h.x, h.z),
          hr = (h.counterbore?.diameter ?? h.diameter) / 2;
        if (part.channel && Math.abs(h.z) - hr < part.channel.width / 2 + 0.25)
          throw new DesignError(
            "Holes must stay outside the underside channel.",
          );
        if (
          part.shape === "box"
            ? Math.abs(h.x) + hr > part.size[0] / 2 - 0.25 ||
              Math.abs(h.z) + hr > part.size[2] / 2 - 0.25
            : sections.some(
                (s) =>
                  radius - hr < s.diameter / 2 + 0.25 &&
                  (radius + hr > s.diameter / 2 - 0.25 ||
                    (s.bore > 0 && radius - hr < s.bore / 2 + 0.25)),
              ) || !sections.some((s) => radius + hr < s.diameter / 2)
        )
          throw new DesignError(
            "Through holes must stay inside every section wall.",
          );
        if (
          part.holes
            .slice(0, i)
            .some(
              (j) =>
                Math.hypot(h.x - j.x, h.z - j.z) <
                ((h.counterbore?.diameter ?? h.diameter) +
                  (j.counterbore?.diameter ?? j.diameter)) /
                  2 +
                  0.25,
            )
        )
          throw new DesignError("Through holes must not overlap.");
      }
    }
    if (
      !/^#[0-9a-f]{6}$/i.test(part.color) ||
      !["print", "machine", "buy", "cut"].includes(part.process) ||
      typeof part.material !== "string" ||
      !part.material.trim() ||
      part.material.length > 80
    )
      throw new DesignError("Part material, process or colour is invalid.");
    if (
      part.motion &&
      (!["rotate", "slide", "pivot", "flow"].includes(part.motion.type) ||
        !["x", "y", "z"].includes(part.motion.axis) ||
        !Number.isFinite(part.motion.speed) ||
        Math.abs(part.motion.speed) > 1000 ||
        (part.motion.range !== undefined &&
          (!Number.isFinite(part.motion.range) ||
            Math.abs(part.motion.range) > 5000)))
    )
      throw new DesignError("Part motion is invalid.");
  }
  for (const part of parts) {
    const m = part.motion;
    if (
      m?.direction !== undefined &&
      (!Array.isArray(m.direction) ||
        m.direction.length !== 3 ||
        !m.direction.every(Number.isFinite) ||
        Math.abs(Math.hypot(...m.direction) - 1) > 1e-6 ||
        !["slide", "rotate"].includes(m.type))
    )
      throw new DesignError(
        "Directional motion requires a unit vector and slide or rotate type.",
      );
    if (m && (m.drivenBy !== undefined || m.travelPerTurn !== undefined)) {
      const leader = parts.find((p) => p.id === m.drivenBy);
      if (
        m.type !== "rotate" ||
        !Number.isFinite(m.travelPerTurn) ||
        m.travelPerTurn! <= 0 ||
        !leader ||
        leader.id === part.id ||
        leader.parentId ||
        leader.motion?.type !== "slide" ||
        leader.motion.drivenBy
      )
        throw new DesignError(
          "A driven rotation requires an independent sliding part and positive travel per turn.",
        );
    }
  }
  for (const part of parts)
    if (part.parentId) {
      if (!ids.has(part.parentId))
        throw new DesignError("A parent part is missing.");
      let cur: Part | undefined = part;
      const seen = new Set<string>();
      while (cur?.parentId) {
        if (seen.has(cur.id))
          throw new DesignError("Part hierarchy cannot contain a cycle.");
        seen.add(cur.id);
        cur = parts.find((p) => p.id === cur?.parentId);
      }
    }
}
export function validateDesign(d: Design): void {
  if (
    d.mechanismVersion !== undefined &&
    (!["turntable", "slider", "conveyor", "lamp", "planter", "holder"].includes(
      d.kind,
    ) ||
      d.mechanismVersion !== 2)
  )
    throw new DesignError("Unsupported mechanism version.");
  const def = productForDesign(d);
  if (!d.params || typeof d.params !== "object" || Array.isArray(d.params))
    throw new DesignError("Parameters must be an object.");
  for (const k of Object.keys(d.params))
    if (!def.parameters.some((p) => p.key === k))
      throw new DesignError("Unknown parameter: " + k);
  for (const p of def.parameters) {
    const v = d.params[p.key];
    if (!Number.isFinite(v) || v < p.min || v > p.max)
      throw new DesignError(
        p.label +
          " must be between " +
          p.min +
          " and " +
          p.max +
          " " +
          p.unit +
          ".",
      );
  }
  const p = d.params;
  if (d.kind === "turntable" && p.shaftDiameter > p.diameter / 5)
    throw new DesignError("The shaft is too large for this platter.");
  if (d.kind === "slider" && p.cameraWidth > p.railSpacing - 10)
    throw new DesignError(
      "Allow at least 10 mm between camera width and rail spacing.",
    );
  if (d.kind === "conveyor" && p.sensorPosition > p.length - 70)
    throw new DesignError(
      "Keep the sensor at least 70 mm before the end of the conveyor.",
    );
  if (d.kind === "lamp" && p.reach > p.baseDiameter * 3)
    throw new DesignError(
      "Increase the base diameter or shorten the arm before continuing.",
    );
  if (
    d.kind === "holder" &&
    (p.opening > p.jawWidth * 2.5 || p.screwDiameter > p.jawWidth / 4)
  )
    throw new DesignError(
      "The jaw opening or screw is too large for this jaw width.",
    );
  if (
    d.kind === "holder" &&
    d.mechanismVersion === 2 &&
    !holderPitch[p.screwDiameter]
  )
    throw new DesignError(
      "Choose a standard coarse screw diameter: 6, 8, 10, 12, 14 or 16 mm.",
    );
  if (d.kind === "planter" && !Number.isInteger(p.pots))
    throw new DesignError("Choose a whole number of pots.");
  if (d.kind === "custom") {
    validateParts(d.customParts || [], 100, 0.5);
    validateParts(
      (d.customParts || []).map((part) => ({
        ...part,
        size: part.size.map((v) => v * p.scale) as Vec3,
        position: part.position.map((v) => v * p.scale) as Vec3,
        sections: part.sections?.map((s) => ({
          height: s.height * p.scale,
          diameter: s.diameter * p.scale,
          bore: s.bore * p.scale,
        })),
        channel: part.channel
          ? {
              width: part.channel.width * p.scale,
              depth: part.channel.depth * p.scale,
            }
          : undefined,
        holes: part.holes?.map((h) => ({
          x: h.x * p.scale,
          z: h.z * p.scale,
          diameter: h.diameter * p.scale,
          ...(h.counterbore
            ? {
                counterbore: {
                  diameter: h.counterbore.diameter * p.scale,
                  depth: h.counterbore.depth * p.scale,
                },
              }
            : {}),
        })),
        motion: part.motion?.drivenBy
          ? {
              ...part.motion,
              travelPerTurn: part.motion.travelPerTurn! * p.scale,
            }
          : part.motion,
        loopSpan:
          part.loopSpan === undefined ? undefined : part.loopSpan * p.scale,
        edgeRadius:
          part.edgeRadius === undefined ? undefined : part.edgeRadius * p.scale,
        wall: part.wall === undefined ? undefined : part.wall * p.scale,
        holeDiameter:
          part.holeDiameter === undefined
            ? undefined
            : part.holeDiameter * p.scale,
      })),
      100,
      0.5,
    );
  }
}
const metal = "#C8CDD1",
  dark = "#353841",
  light = "#E8E9EB",
  red = "#B74C60",
  green = "#528265";
const box = (
  id: string,
  name: string,
  size: Vec3,
  position: Vec3,
  color = metal,
  material = "Aluminium 6061",
  process: Part["process"] = "machine",
): Part => ({
  id,
  name,
  shape: "box",
  size,
  position,
  color,
  material,
  process,
});
const cylinder = (
  id: string,
  name: string,
  diameter: number,
  height: number,
  position: Vec3,
  color = metal,
  material = "Aluminium 6061",
  process: Part["process"] = "machine",
): Part => ({
  id,
  name,
  shape: "cylinder",
  size: [diameter, height, diameter],
  position,
  color,
  material,
  process,
});
const tube = (
  id: string,
  name: string,
  diameter: number,
  bore: number,
  height: number,
  position: Vec3,
  color = metal,
  material = "Aluminium 6061",
  process: Part["process"] = "machine",
): Part => ({
  ...cylinder(id, name, diameter, height, position, color, material, process),
  shape: "tube",
  holeDiameter: bore,
});
const round = (n: number) => Math.round(n * 100) / 100;
function step(
  id: string,
  title: string,
  instruction: string,
  partIds: string[],
  check: string,
): AssemblyStep {
  return { id, title, instruction, partIds, check };
}
// Supplier discovery links verified against official catalogs on 2026-11-02.
// They are comparison starting points, never a stock, price or fit guarantee.
function sourceFor(p: Part): string | undefined {
  if (p.process === "print") return "https://www.hubs.com/3d-printing/fdm/";
  if (p.process === "machine" || p.process === "cut")
    return p.shape === "box"
      ? "https://www.hubs.com/cnc-machining/"
      : "https://www.hubs.com/cnc-machining/cnc-turning-service/";
  const name = (p.name + " " + p.material).toLowerCase();
  if (name.includes("stepper"))
    return "https://www.pololu.com/category/87/stepper-motors";
  if (name.includes("motor") && name.includes("driver"))
    return "https://www.pololu.com/category/11/brushed-dc-motor-drivers";
  if (name.includes("motor"))
    return "https://www.pololu.com/category/51/pololu-metal-dc-gearmotors";
  if (name.includes("rubber"))
    return "https://www.mcmaster.com/products/rubber-bumpers/";
  if (name.includes("bearing"))
    return "https://www.mcmaster.com/products/steel-ball-bearings/";
  if (name.includes("lead screw"))
    return "https://www.mcmaster.com/products/lead-screws-and-nuts/";
  if (name.includes("sensor"))
    return "https://www.digikey.ca/en/products/category/industrial-sensors/2114";
  if (name.includes("pump")) return "https://www.adafruit.com/product/4547";
  return undefined;
}
function bom(parts: Part[]): BomItem[] {
  return parts
    .filter((p) => p.role !== "reference")
    .map((p) => ({
      id: p.id,
      name: p.name,
      quantity: 1,
      material: p.material,
      process: p.process,
      specification:
        (p.loopSpan !== undefined
          ? `${round(p.size[0])} × ${round(p.size[1])} × ${round(p.size[2])} mm / loop centres ${round(p.loopSpan)} mm / bend OD ${round(p.size[2])} / ID ${round(p.holeDiameter!)} mm / smooth clearance envelope, teeth omitted`
          : p.shape === "box"
            ? p.size.map(round).join(" × ") +
              " mm" +
              (p.edgeRadius
                ? ` / edges rounded, ${round(p.edgeRadius)} mm radius`
                : "") +
              (p.wall ? ` / hollow shell, ${round(p.wall)} mm wall` : "")
            : p.shape === "ellipsoid"
              ? p.size[0] === p.size[1]
                ? `${round(p.size[0])} mm ball`
                : `${round(p.size[0])} mm diameter × ${round(p.size[1])} mm rounded solid`
            : round(p.size[0]) +
              " mm diameter × " +
              round(p.size[1]) +
              " mm" +
              (p.holeDiameter
                ? " / bore " + round(p.holeDiameter) + " mm"
                : "")) +
        (p.sections
          ? " / axial sections bottom→top: " +
            p.sections
              .map((s) => `${s.height} high / Ø${s.diameter} / bore ${s.bore}`)
              .join("; ")
          : "") +
        (p.holes?.length
          ? " / through holes X/Z/Ø: " +
            p.holes
              .map(
                (h) =>
                  `${round(h.x)}/${round(h.z)}/${h.diameter}${h.counterbore ? `; counterbore Ø${h.counterbore.diameter} × ${h.counterbore.depth} deep from +Y` : ""}`,
              )
              .join("; ")
          : "") +
        (p.channel
          ? ` / underside channel: ${p.channel.width} wide × ${p.channel.depth} deep, full X length`
          : "") +
        (p.process === "buy"
          ? " / selection envelope; confirm actual fit and ratings"
          : ""),
      sourceUrl: sourceFor(p),
    }));
}

export function deriveDesign(d: Design): DerivedDesign {
  validateDesign(d);
  const p = d.params;
  let parts: Part[] = [],
    steps: AssemblyStep[] = [],
    metrics: Metric[] = [],
    connections: Connection[] = [];
  const warnings: string[] = [
    "Dimensions describe a reviewable prototype. Check material, tolerances, fastening and load requirements before fabrication.",
  ];
  switch (d.kind) {
    case "turntable": {
      if (d.mechanismVersion === 2) {
        const standard = standardTurntable(p);
        parts = standard.parts;
        steps = standard.steps;
        metrics = standard.metrics;
        connections = standard.connections;
        warnings.push(...standard.warnings);
        break;
      }
      warnings.push(
        "Legacy conceptual drive: arbitrary motor and bearing envelopes. Create a new turntable for the supported 8 mm spindle assembly.",
      );
      const radius = p.diameter / 2,
        baseD = p.diameter * 0.78;
      parts = [
        tube(
          "base",
          "Drive enclosure wall",
          baseD,
          baseD - 8,
          p.height,
          [0, p.height / 2, 0],
          light,
          "PETG",
          "print",
        ),
        cylinder(
          "motor",
          "Geared DC motor",
          32,
          35,
          [0, p.height - 12, 0],
          dark,
          "Purchased motor",
          "buy",
        ),
        tube(
          "hub",
          "Drive hub",
          p.shaftDiameter * 3,
          p.shaftDiameter + 0.2,
          18,
          [0, p.height + 9, 0],
        ),
        tube(
          "platter",
          "Rotating platter",
          p.diameter,
          p.shaftDiameter + 0.2,
          8,
          [0, p.height + 22, 0],
          metal,
        ),
        box(
          "product",
          "Reference product",
          [p.diameter * 0.28, 65, p.diameter * 0.19],
          [0, p.height + 58.5, 0],
          red,
          "Reference envelope",
          "buy",
        ),
      ];
      parts.push(
        cylinder(
          "base-floor",
          "Enclosure floor",
          baseD - 8,
          4,
          [0, 2, 0],
          light,
          "PETG",
          "print",
        ),
      );
      const hubD = p.shaftDiameter * 3,
        bearingBore = hubD + 0.4,
        bearingD = hubD + 18,
        bridgeLength = (baseD - 12 - hubD - 2) / 2;
      parts.push(
        cylinder(
          "shaft",
          "Motor output shaft",
          p.shaftDiameter,
          22,
          [0, p.height + 10, 0],
          metal,
          "Motor shaft envelope",
          "buy",
        ),
        tube(
          "drive-bearing",
          "Hub support bearing",
          bearingD,
          bearingBore,
          8,
          [0, p.height + 3, 0],
          dark,
          "Purchased bearing",
          "buy",
        ),
        box(
          "bridge-left",
          "Left bearing support",
          [bridgeLength, 6, 30],
          [-(hubD + 2 + bridgeLength) / 2, p.height - 3, 0],
          metal,
        ),
        box(
          "bridge-right",
          "Right bearing support",
          [bridgeLength, 6, 30],
          [(hubD + 2 + bridgeLength) / 2, p.height - 3, 0],
          metal,
        ),
        box(
          "control-panel",
          "Control mounting panel",
          [42, 20, 3],
          [0, p.height * 0.45, baseD / 2 + 1],
          dark,
          "PETG",
          "print",
        ),
        cylinder(
          "speed-knob",
          "Speed control knob",
          16,
          9,
          [-11, p.height * 0.45, baseD / 2 + 7],
          metal,
          "PETG",
          "print",
        ),
        cylinder(
          "power-switch",
          "Power switch envelope",
          9,
          6,
          [12, p.height * 0.45, baseD / 2 + 5],
          red,
          "Low-voltage switch",
          "buy",
        ),
      );
      for (const id of ["speed-knob", "power-switch"])
        parts.find((part) => part.id === id)!.rotation = [Math.PI / 2, 0, 0];
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3;
        parts.push(
          tube(
            "mount-" + i,
            "Motor mount spacer " + (i + 1),
            8,
            3.4,
            Math.max(5, p.height - 34),
            [
              Math.cos(a) * 23,
              4 + Math.max(5, p.height - 34) / 2,
              Math.sin(a) * 23,
            ],
            metal,
          ),
        );
      }

      parts[3].motion = { type: "rotate", axis: "y", speed: p.rpm };
      parts[4].motion = { type: "rotate", axis: "y", speed: p.rpm };
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3;
        parts.push(
          cylinder(
            "foot-" + i,
            "Rubber foot " + (i + 1),
            18,
            6,
            [Math.cos(a) * baseD * 0.35, -3, Math.sin(a) * baseD * 0.35],
            dark,
            "Rubber",
            "buy",
          ),
        );
      }
      metrics = [
        { label: "Hub bore", value: round(p.shaftDiameter + 0.2), unit: "mm" },
        {
          label: "Peripheral speed",
          value: round((Math.PI * p.diameter * p.rpm) / 60),
          unit: "mm/s",
        },
        {
          label: "Inertia estimate",
          value: round(0.5 * p.payload * (radius / 1000) ** 2 * 10000),
          unit: "×10⁻⁴ kg m²",
        },
      ];
      connections = [
        {
          from: "drive-bearing",
          to: "hub",
          description:
            "Select a bearing for the " +
            round(bearingBore) +
            " mm support bore, then revise the mating fits to its datasheet.",
        },
        {
          from: "bridge-left",
          to: "drive-bearing",
          description:
            "Split supports retain the bearing with shaft clearance; review fasteners.",
        },
        {
          from: "control-panel",
          to: "motor",
          description:
            "Speed control and switch need a correctly rated low-voltage driver.",
        },
        {
          from: "motor",
          to: "hub",
          description:
            "Shaft " +
            p.shaftDiameter +
            " mm into hub bore " +
            round(p.shaftDiameter + 0.2) +
            " mm; review set-screw and keying.",
        },
        {
          from: "hub",
          to: "platter",
          description: "Concentric drive attachment; add reviewed fasteners.",
        },
      ];
      connections.sort((a, b) =>
        a.from === "motor" ? -1 : b.from === "motor" ? 1 : 0,
      );
      steps = [
        step(
          "support",
          "Prepare the base",
          "Fit the enclosure floor, feet and motor spacers. Review the fastener and wire openings before fabrication.",
          [
            "base",
            "base-floor",
            "foot-0",
            "foot-1",
            "foot-2",
            "mount-0",
            "mount-1",
            "mount-2",
          ],
          "All feet sit flat.",
        ),
        step(
          "drive",
          "Fit the drive",
          "Mount the motor, split bearing supports and selected bearing. Slide the hub over the shaft and confirm the bore before fixing it.",
          [
            "motor",
            "shaft",
            "hub",
            "drive-bearing",
            "bridge-left",
            "bridge-right",
          ],
          "The hub rotates freely without slipping.",
        ),
        step(
          "platter",
          "Attach the platter",
          "Centre the platter on the hub. Add balanced, reviewed fasteners.",
          ["platter", "hub"],
          "The platter clears the enclosure throughout a full turn.",
        ),
        step(
          "power",
          "Check the motion",
          "Fit the controls to a reviewed panel, connect a correctly rated fused low-voltage motor driver with power off, then test slowly without a payload.",
          ["control-panel", "speed-knob", "power-switch", "motor", "platter"],
          "No rubbing, loose wires or visible wobble.",
        ),
      ];
      break;
    }
    case "slider": {
      if (d.mechanismVersion === 2) {
        const standard = standardSlider(p);
        parts = standard.parts;
        steps = standard.steps;
        metrics = standard.metrics;
        connections = standard.connections;
        warnings.push(...standard.warnings);
        validateParts(parts, 256);
        break;
      }
      warnings.push(
        "Legacy conceptual slider. Create a new slider for dimensioned guide, mounting and belt-drive interfaces.",
      );
      const l = p.travel + 120,
        w = p.railSpacing;
      parts = [
        box(
          "left-end",
          "Left end support",
          [28, 45, w + 35],
          [-l / 2, 22.5, 0],
          dark,
          "PETG",
          "print",
        ),
        box(
          "right-end",
          "Right end support",
          [28, 45, w + 35],
          [l / 2, 22.5, 0],
          dark,
          "PETG",
          "print",
        ),
        box("rail-front", "Front linear rail", [l, 12, 12], [0, 27, -w / 2]),
        box("rail-rear", "Rear linear rail", [l, 12, 12], [0, 27, w / 2]),
        box(
          "belt",
          "Timing belt",
          [l, 3, 8],
          [0, 15, 0],
          dark,
          "GT2 belt",
          "buy",
        ),
        box("carriage", "Camera carriage", [85, 12, w + 20], [0, 42, 0], metal),
        box(
          "camera",
          "Camera footprint",
          [60, 50, p.cameraWidth],
          [0, 73, 0],
          red,
          "Reference envelope",
          "buy",
        ),
        box(
          "drive",
          "Stepper motor",
          [42, 42, 42],
          [-l / 2 - 25, 25, 0],
          dark,
          "NEMA 17 motor",
          "buy",
        ),
      ];
      for (const id of ["carriage", "camera"])
        parts.find((x) => x.id === id)!.motion = {
          type: "slide",
          axis: "x",
          speed: p.speed,
          range: p.travel,
        };
      metrics = [
        { label: "Rail cut length", value: l, unit: "mm" },
        { label: "Belt loop estimate", value: 2 * l + 100, unit: "mm" },
        {
          label: "One-way travel",
          value: round(p.travel / p.speed),
          unit: "s",
        },
        {
          label: "Side clearance",
          value: round((w - p.cameraWidth) / 2),
          unit: "mm",
        },
      ];
      connections = [
        {
          from: "drive",
          to: "belt",
          description:
            "Drive pulley engages belt; select matching tooth pitch.",
        },
        {
          from: "belt",
          to: "carriage",
          description: "Belt clamp moves carriage between the travel limits.",
        },
      ];
      steps = [
        step(
          "frame",
          "Align the rails",
          "Fit parallel rails between end supports. Check the " +
            w +
            " mm spacing.",
          ["rail-front", "rail-rear", "left-end", "right-end"],
          "Carriage slides freely without binding.",
        ),
        step(
          "belt",
          "Route the belt",
          "Route the loop around a matched drive pulley and idler, then tension it.",
          ["belt", "drive"],
          "Belt runs straight and cannot rub the supports.",
        ),
        step(
          "camera",
          "Mount the camera",
          "Secure a suitable camera plate and check the footprint clearance.",
          ["carriage", "camera"],
          "Camera is retained throughout travel.",
        ),
        step(
          "limits",
          "Check the limits",
          "Home at low speed and place hard stops outside the commanded travel.",
          ["carriage", "left-end", "right-end"],
          "The carriage stops before either end support.",
        ),
      ];
      break;
    }
    case "conveyor": {
      if (d.mechanismVersion === 2) {
        const standard = standardConveyor(p);
        parts = standard.parts;
        steps = standard.steps;
        metrics = standard.metrics;
        connections = standard.connections;
        warnings.push(...standard.warnings);
        validateParts(parts, 256);
        break;
      }
      warnings.push(
        "Legacy conceptual conveyor. Create a new conveyor for supported rollers, a continuous belt and attached drive/control interfaces.",
      );
      const l = p.length,
        w = p.beltWidth;
      parts = [
        box("frame-front", "Front frame", [l, 24, 15], [0, 30, -w / 2 - 12]),
        box("frame-rear", "Rear frame", [l, 24, 15], [0, 30, w / 2 + 12]),
        box(
          "belt",
          "Conveyor belt",
          [l - 30, 5, w],
          [0, 45, 0],
          dark,
          "Urethane belt",
          "buy",
        ),
        cylinder("roller-in", "Infeed roller", 32, w, [-l / 2 + 18, 34, 0]),
        cylinder("roller-out", "Outfeed roller", 32, w, [l / 2 - 18, 34, 0]),
        box(
          "sensor",
          "Optical sensor",
          [18, 22, 18],
          [-l / 2 + p.sensorPosition, 64, -w / 2 + 12],
          red,
          "Photoelectric sensor",
          "buy",
        ),
        box(
          "sensor-bracket",
          "Sensor bracket",
          [18, 50, 8],
          [-l / 2 + p.sensorPosition, 40, -w / 2 - 13],
          metal,
        ),
        box(
          "diverter",
          "Sorting gate",
          [60, 15, 8],
          [l / 2 - 55, 56, 0],
          metal,
        ),
        box(
          "parcel",
          "Sample object",
          [25, 25, 25],
          [-l / 2 + 50, 60, 0],
          red,
          "Reference envelope",
          "buy",
        ),
      ];
      parts[3].rotation = [Math.PI / 2, 0, 0];
      parts[4].rotation = [Math.PI / 2, 0, 0];
      parts[3].motion = {
        type: "rotate",
        axis: "z",
        speed: (p.speed * 60) / (Math.PI * 32),
      };
      parts[4].motion = {
        type: "rotate",
        axis: "z",
        speed: (p.speed * 60) / (Math.PI * 32),
      };
      parts[7].motion = {
        type: "pivot",
        axis: "y",
        speed: 0.7,
        range: Math.PI / 3,
      };
      parts[8].motion = {
        type: "slide",
        axis: "x",
        speed: p.speed,
        range: l - 100,
      };
      metrics = [
        {
          label: "Sensor-to-gate delay",
          value: round((l - 55 - p.sensorPosition) / p.speed),
          unit: "s",
        },
        {
          label: "Belt loop estimate",
          value: round(2 * (l - 36) + Math.PI * 32),
          unit: "mm",
        },
        { label: "Sensor offset", value: p.sensorPosition, unit: "mm" },
      ];
      connections = [
        {
          from: "sensor",
          to: "diverter",
          description:
            "After detection wait " +
            round((l - 55 - p.sensorPosition) / p.speed) +
            " seconds at the selected belt speed; calibrate with the real actuator.",
        },
      ];
      steps = [
        step(
          "frame",
          "Build the frame",
          "Align the side rails and rollers. Set the width for the selected belt.",
          ["frame-front", "frame-rear", "roller-in", "roller-out"],
          "Both rollers turn freely and stay parallel.",
        ),
        step(
          "belt",
          "Track the belt",
          "Install the belt and adjust tension gradually.",
          ["belt", "roller-in", "roller-out"],
          "The belt stays centred at slow speed.",
        ),
        step(
          "sensor",
          "Place the sensor",
          "Mount the sensor " + p.sensorPosition + " mm from the entrance.",
          ["sensor", "sensor-bracket"],
          "A sample object triggers a reliable detection.",
        ),
        step(
          "gate",
          "Calibrate the sorting gate",
          "Connect the sensor and actuator with power off. Test the calculated delay with empty lightweight samples.",
          ["sensor", "diverter", "parcel"],
          "The gate moves after detection and clears the sample.",
        ),
      ];
      break;
    }
    case "lamp": {
      if (d.mechanismVersion === 2) {
        const standard = standardLamp(p);
        parts = standard.parts;
        steps = standard.steps;
        metrics = standard.metrics;
        connections = standard.connections;
        warnings.push(...standard.warnings);
        validateParts(parts, 256, 0.25);
        break;
      }
      warnings.push(
        "Legacy conceptual lamp. Create a new lamp for retained joints and a hollow light housing.",
      );
      const r = p.reach,
        theta = (p.angle * Math.PI) / 180,
        link = r / 2,
        x = Math.sin(theta) * link,
        y = Math.cos(theta) * link;
      parts = [
        cylinder("base", "Weighted base", p.baseDiameter, 18, [0, 9, 0], metal),
        cylinder("pivot-lower", "Lower pivot", 26, 30, [0, 40, 0], dark),
        box(
          "lower-arm",
          "Lower arm",
          [16, link, 16],
          [x / 2, 40 + y / 2, 0],
          metal,
        ),
        cylinder("pivot-upper", "Elbow pivot", 24, 28, [x, 40 + y, 0], dark),
        box(
          "upper-arm",
          "Upper arm",
          [14, link, 14],
          [x + link / 2, 40 + y, 0],
          metal,
        ),
        cylinder(
          "shade",
          "LED shade",
          65,
          35,
          [x + link, 40 + y - 10, 0],
          light,
          "PETG",
          "print",
        ),
        cylinder(
          "led",
          "LED diffuser",
          56,
          3,
          [x + link, 40 + y - 29, 0],
          "#FFF3B0",
          "12V LED module",
          "buy",
        ),
      ];
      parts[1].rotation = [Math.PI / 2, 0, 0];
      parts[2].rotation = [0, 0, -theta];
      parts[3].rotation = [Math.PI / 2, 0, 0];
      parts[4].rotation = [0, 0, -Math.PI / 2];
      parts[6].color =
        "#" +
        [
          Math.round(90 + (165 * p.brightness) / 100),
          Math.round(85 + (158 * p.brightness) / 100),
          Math.round(65 + (111 * p.brightness) / 100),
        ]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("");
      metrics = [
        { label: "Horizontal reach", value: round(x + link), unit: "mm" },
        { label: "Cable allowance", value: round(r + 250), unit: "mm" },
        { label: "Light setting", value: p.brightness, unit: "%" },
        {
          label: "Reach / base",
          value: round(r / p.baseDiameter),
          unit: "ratio",
        },
      ];
      warnings.push(
        "Balance and LED temperature require physical checks; the reach/base check is a geometric guardrail, not a stability certificate.",
      );
      connections = [
        {
          from: "base",
          to: "lower-arm",
          description: "Friction pivot with mechanical stop.",
        },
        {
          from: "lower-arm",
          to: "upper-arm",
          description: "Elbow pivot with cable slack.",
        },
        {
          from: "upper-arm",
          to: "led",
          description: "Low-voltage cable through protected clips.",
        },
      ];
      steps = [
        step(
          "base",
          "Prepare the base",
          "Install the lower pivot in a sufficiently weighted base.",
          ["base", "pivot-lower"],
          "The base stays flat at the chosen reach.",
        ),
        step(
          "arms",
          "Connect the arms",
          "Fit the elbow and tighten friction washers gradually.",
          ["lower-arm", "pivot-upper", "upper-arm"],
          "Joints hold position without pinching the cable.",
        ),
        step(
          "light",
          "Fit the light",
          "Install the LED and diffuser in a heat-appropriate shade.",
          ["shade", "led"],
          "LED module temperature rating matches the housing.",
        ),
        step(
          "cable",
          "Route and test",
          "Leave the specified cable slack and connect an isolated low-voltage supply.",
          ["base", "led"],
          "Full motion does not pull or pinch the cable.",
        ),
      ];
      break;
    }
    case "planter": {
      if (d.mechanismVersion === 2) {
        const standard = standardPlanter(p);
        parts = standard.parts;
        steps = standard.steps;
        metrics = standard.metrics;
        connections = standard.connections;
        warnings.push(...standard.warnings);
        validateParts(parts);
        break;
      }
      warnings.push(
        "Legacy conceptual planter. Create a new planter for supported cups, drainage and a connected water path.",
      );
      const pitch = p.potDiameter + 20,
        l = p.pots * pitch + 20,
        h = p.reservoirHeight;
      parts = [
        box(
          "reservoir",
          "Reservoir floor",
          [l, 4, p.potDiameter + 35],
          [0, 2, 0],
          light,
          "PETG",
          "print",
        ),
        box(
          "water",
          "Usable water envelope",
          [l - 12, h * 0.65, p.potDiameter + 23],
          [0, h * 0.4, 0],
          "#6EA6BA",
          "Reference envelope",
          "buy",
        ),
        box(
          "pump",
          "Low-voltage pump",
          [25, 24, 25],
          [-l / 2 + 25, 18, 0],
          dark,
          "Submersible pump",
          "buy",
        ),
        box(
          "manifold",
          "Water manifold",
          [l - 30, 8, 8],
          [0, h + 16, -p.potDiameter / 2],
          dark,
          "Flexible tubing",
          "buy",
        ),
      ];
      parts.push(
        box(
          "wall-front",
          "Front reservoir wall",
          [l, h, 4],
          [0, h / 2, -(p.potDiameter + 31) / 2],
          light,
          "PETG",
          "print",
        ),
        box(
          "wall-back",
          "Rear reservoir wall",
          [l, h, 4],
          [0, h / 2, (p.potDiameter + 31) / 2],
          light,
          "PETG",
          "print",
        ),
        box(
          "wall-left",
          "Left reservoir wall",
          [4, h, p.potDiameter + 27],
          [-l / 2 + 2, h / 2, 0],
          light,
          "PETG",
          "print",
        ),
        box(
          "wall-right",
          "Right reservoir wall",
          [4, h, p.potDiameter + 27],
          [l / 2 - 2, h / 2, 0],
          light,
          "PETG",
          "print",
        ),
      );
      parts[1].motion = {
        type: "flow",
        axis: "y",
        speed: p.waterMinutes / 60,
        range: h * 0.15,
      };
      for (let i = 0; i < p.pots; i++) {
        const x = (i - (p.pots - 1) / 2) * pitch;
        parts.push(
          tube(
            "pot-" + i,
            "Plant cup " + (i + 1),
            p.potDiameter,
            p.potDiameter - 6,
            p.potDiameter * 0.7,
            [x, h + p.potDiameter * 0.35, 0],
            light,
            "PETG",
            "print",
          ),
          cylinder(
            "plant-" + i,
            "Plant envelope " + (i + 1),
            p.potDiameter * 0.45,
            p.potDiameter * 0.75,
            [x, h + p.potDiameter * 0.95, 0],
            green,
            "Reference envelope",
            "buy",
          ),
          tube(
            "outlet-" + i,
            "Water outlet " + (i + 1),
            8,
            5,
            35,
            [x, h + 12, -p.potDiameter * 0.35],
            dark,
            "Food-contact tubing",
            "buy",
          ),
        );
      }
      metrics = [
        {
          label: "Usable water estimate",
          value: round(((l - 12) * (p.potDiameter + 23) * (h * 0.65)) / 1e6),
          unit: "L",
        },
        { label: "Tube allowance", value: l + p.pots * 180, unit: "mm" },
        { label: "Daily run time", value: p.waterMinutes, unit: "min" },
        { label: "Watering outlets", value: p.pots },
      ];
      warnings.push(
        "Reservoir panel joints and cup drainage need a watertight design and leak testing before use.",
      );
      connections = Array.from({ length: p.pots }, (_, i) => ({
        from: "manifold",
        to: "outlet-" + i,
        description:
          "One regulated outlet per cup; calibrate delivered volume.",
      }));
      steps = [
        step(
          "reservoir",
          "Prepare the reservoir",
          "Review wall thickness and seal design, then leak-test the empty reservoir.",
          ["reservoir"],
          "No leaks and no water near exposed electrical contacts.",
        ),
        step(
          "cups",
          "Place the cups",
          "Fit the cups at " + pitch + " mm spacing.",
          [
            "reservoir",
            ...Array.from({ length: p.pots }, (_, i) => "pot-" + i),
          ],
          "Each cup is supported and can drain.",
        ),
        step(
          "water",
          "Connect the water path",
          "Connect the pump, manifold and one outlet per cup.",
          [
            "pump",
            "manifold",
            ...Array.from({ length: p.pots }, (_, i) => "outlet-" + i),
          ],
          "Each outlet delivers a measured amount without leaks.",
        ),
        step(
          "schedule",
          "Calibrate the schedule",
          "Measure pump flow before setting a daily run time. Keep the low-voltage controller dry.",
          ["pump", "water"],
          "Observed watering volume matches the plants and reservoir.",
        ),
      ];
      break;
    }
    case "holder": {
      if (d.mechanismVersion === 2) {
        const standard = standardHolder(p);
        parts = standard.parts;
        steps = standard.steps;
        metrics = standard.metrics;
        connections = standard.connections;
        warnings.push(...standard.warnings);
        validateParts(parts);
        break;
      }
      warnings.push(
        "Legacy conceptual holder. Create a new holder for retained guides, spindle and tilt joints.",
      );
      const w = p.jawWidth,
        o = p.opening,
        total = o + 100;
      parts = [
        cylinder("base", "Bench base", w + 40, 18, [0, 9, 0], metal),
        cylinder("pivot", "Tilt pivot", 34, w * 0.6, [0, 38, 0], dark),
        box("guide", "Slide guide", [total, 18, w * 0.65], [0, 65, 0], metal),
        box("jaw-fixed", "Fixed jaw", [18, 48, w], [-o / 2 - 9, 88, 0], metal),
        box("jaw-moving", "Moving jaw", [18, 48, w], [o / 2 + 9, 88, 0], metal),
        cylinder(
          "screw",
          "Lead screw",
          p.screwDiameter,
          total + 45,
          [15, 63, 0],
          dark,
          "Steel lead screw",
          "buy",
        ),
        tube(
          "nut",
          "Lead screw nut",
          p.screwDiameter * 2,
          p.screwDiameter + 0.2,
          18,
          [o / 2, 63, 0],
          metal,
        ),
        cylinder(
          "handle",
          "Adjustment handle",
          34,
          14,
          [total / 2 + 32, 63, 0],
          dark,
          "PETG",
          "print",
        ),
      ];
      parts[1].rotation = [Math.PI / 2, 0, 0];
      for (const idx of [5, 6, 7]) parts[idx].rotation = [0, 0, Math.PI / 2];
      parts[4].motion = {
        type: "slide",
        axis: "x",
        speed: 10,
        range: Math.min(40, o - 8),
      };
      const tilt = (p.angle * Math.PI) / 180;
      for (const part of parts.filter(
        (part) => !["base", "pivot"].includes(part.id),
      )) {
        const [x, y, z] = part.position;
        part.position = [
          x * Math.cos(tilt) - (y - 38) * Math.sin(tilt),
          38 + x * Math.sin(tilt) + (y - 38) * Math.cos(tilt),
          z,
        ];
        part.rotation = [
          part.rotation?.[0] || 0,
          part.rotation?.[1] || 0,
          (part.rotation?.[2] || 0) + tilt,
        ];
      }
      metrics = [
        { label: "Lead screw length", value: total + 45, unit: "mm" },
        {
          label: "Nut bore allowance",
          value: round(p.screwDiameter + 0.2),
          unit: "mm",
        },
        { label: "Clear jaw opening", value: o, unit: "mm" },
        { label: "Requested tilt", value: p.angle, unit: "°" },
      ];
      warnings.push(
        "Jaw force, thread pitch, bench fastening and pivot retention require review. Do not use this unvalidated prototype for powered machining.",
      );
      connections = [
        {
          from: "screw",
          to: "nut",
          description:
            "Choose matched thread form and pitch; " +
            p.screwDiameter +
            " mm is nominal diameter.",
        },
        {
          from: "nut",
          to: "jaw-moving",
          description: "Captive nut translates the moving jaw.",
        },
      ];
      steps = [
        step(
          "base",
          "Fix the base",
          "Fasten the base to a suitable bench and install the retained tilt pivot.",
          ["base", "pivot"],
          "The mounting cannot lift or rotate unexpectedly.",
        ),
        step(
          "jaws",
          "Fit the jaws",
          "Install the guide and fixed jaw, then check the moving jaw slides freely.",
          ["guide", "jaw-fixed", "jaw-moving"],
          "Jaws stay parallel across the opening.",
        ),
        step(
          "screw",
          "Fit the lead screw",
          "Install a matching threaded nut, lead screw and retained handle.",
          ["screw", "nut", "handle"],
          "The screw advances smoothly without end play.",
        ),
        step(
          "fit",
          "Try the workpiece",
          "Fit soft jaw pads and gently clamp a lightweight test piece.",
          ["jaw-fixed", "jaw-moving"],
          "The workpiece is held without excessive force.",
        ),
      ];
      break;
    }
    case "custom": {
      parts = (d.customParts || []).map((part) => ({
        ...part,
        size: part.size.map((v) => v * p.scale) as Vec3,
        position: part.position.map((v) => v * p.scale) as Vec3,
        sections: part.sections?.map((s) => ({
          height: s.height * p.scale,
          diameter: s.diameter * p.scale,
          bore: s.bore * p.scale,
        })),
        channel: part.channel
          ? {
              width: part.channel.width * p.scale,
              depth: part.channel.depth * p.scale,
            }
          : undefined,
        holes: part.holes?.map((h) => ({
          x: h.x * p.scale,
          z: h.z * p.scale,
          diameter: h.diameter * p.scale,
          ...(h.counterbore
            ? {
                counterbore: {
                  diameter: h.counterbore.diameter * p.scale,
                  depth: h.counterbore.depth * p.scale,
                },
              }
            : {}),
        })),
        motion: part.motion?.drivenBy
          ? {
              ...part.motion,
              travelPerTurn: part.motion.travelPerTurn! * p.scale,
            }
          : part.motion,
        loopSpan:
          part.loopSpan === undefined ? undefined : part.loopSpan * p.scale,
        edgeRadius:
          part.edgeRadius === undefined ? undefined : part.edgeRadius * p.scale,
        wall: part.wall === undefined ? undefined : part.wall * p.scale,
        holeDiameter:
          part.holeDiameter === undefined
            ? undefined
            : part.holeDiameter * p.scale,
      }));
      steps = parts.map((part, i) =>
        step(
          "place-" + part.id,
          "Position " + part.name,
          "Place " +
            part.name +
            " at " +
            part.position.map(round).join(", ") +
            " mm. Review its attachments before assembly.",
          [part.id],
          "Orientation, dimensions and fastening reviewed.",
        ),
      );
      metrics = [
        { label: "Parts", value: parts.length },
        { label: "Scale", value: p.scale, unit: "×" },
      ];
      warnings.push(
        "Generated primitive assemblies need reviewed joints, fastening and a production process before building.",
      );
      break;
    }
  }
  for (const part of parts)
    if (part.material === "Reference envelope") part.role = "reference";
    else part.role = part.role || "component";
  parts = applyLook(d.kind, parts);
  let rows = bom(parts);
  if (d.kind === "turntable" && d.mechanismVersion === 2) {
    rows = rows.filter(
      (row) =>
        !row.id.endsWith("-head") &&
        !["motor-pilot", "motor-shaft"].includes(row.id),
    );
    for (const row of rows) {
      if (row.id.includes("screw"))
        row.name = row.name.replace(
          "screw shank envelope",
          "screw (head included)",
        );
      if (row.id === "motor")
        row.sourceUrl = "https://www.pololu.com/product/4756";
      if (row.id === "coupling") {
        row.sourceUrl = "https://www.ruland.com/pcmr25-8-6-ss.html";
        row.specification +=
          " / body Ø25.4; model reserves Ø31.8 for clamp hardware; verify engagement";
      }
      if (row.id === "collar") {
        row.sourceUrl = "https://www.ruland.com/mcl-8-a.html";
        row.specification +=
          " / body Ø18; model reserves Ø22.4 for clamp hardware";
      }
      if (row.id.endsWith("-bearing"))
        row.sourceUrl =
          "https://www.nsk.com/content/dam/nsk-marketing/projects-completed/literature/service/guides/bearing-replacement-guide-brg/en_bearing-replacement-guide-brg/preview-pdf_bearing-replacement-guide-brg_en/NSK_Bro_BRG_E_preview.pdf";
    }
  }
  if (d.kind === "slider" && d.mechanismVersion === 2) {
    rows = rows.filter(
      (row) => row.id !== "drive-shaft" && !row.id.startsWith("idler-bearing-"),
    );
    for (const row of rows) {
      // Assign only specific dimensional sources; generic search links imply no fit.
      row.sourceUrl = undefined;
      if (row.id === "drive")
        row.sourceUrl = "https://www.pololu.com/product/2267";
      if (row.id === "drive-pulley")
        row.sourceUrl = "https://sg.misumi-ec.com/pdf/fa/2015/p1_1415_001.pdf";
      if (row.id === "idler") {
        row.sourceUrl =
          "https://us.misumi-ec.com/pdf/fa/2019/2019_US_1424_001.pdf";
        row.specification +=
          " / includes two 675ZZ bearings (5 × 8 × 2.5); body and bearings shown separately";
      }
      if (
        ["rail-front", "rail-rear", "block-front", "block-rear"].includes(
          row.id,
        )
      )
        row.sourceUrl =
          "https://hiwin.co.uk/wp-content/uploads/2017/06/Linear-Guideways.pdf";
      if (row.id === "camera-screw")
        row.specification +=
          " / cut 1/4-20 thread on upper 9 mm; 4 mm projection above carriage";
      if (row.id === "idler-axle")
        row.specification +=
          " / M5 lower 6 mm thread; smooth 5 mm bearing journal; verify bearing preload and retention";
      if (row.id === "base")
        row.specification +=
          " / 3 mm nominal holes indicate M3 threads; choose tap-drill dimensions in fabrication review";
      if (row.id === "tension-plate")
        row.specification +=
          " / 5 mm nominal centre hole indicates M5 thread; 7 mm clearances permit ±2 mm X adjustment";
    }
  }
  if (d.kind === "conveyor" && d.mechanismVersion === 2) {
    rows = rows.filter(
      (row) => !["motor-shaft", "motor-pilot", "gate-shaft"].includes(row.id),
    );
    for (const row of rows) {
      row.sourceUrl = undefined;
      if (row.id === "motor")
        row.sourceUrl = "https://www.pololu.com/product/4756";
      if (row.id === "gate-motor")
        row.sourceUrl = "https://www.pololu.com/product/2267";
      if (row.id === "coupling")
        row.sourceUrl = "https://www.ruland.com/pcmr25-8-6-ss.html";
      if (row.id.endsWith("-collar"))
        row.sourceUrl = "https://www.ruland.com/mcl-8-a.html";
      if (row.id === "diverter") {
        row.sourceUrl = "https://www.pololu.com/product/1998";
        row.specification +=
          " / one hub used; supplier sells a two-pack, included set screw omitted from envelope";
      }
      if (row.id === "sensor")
        row.sourceUrl =
          "https://assets.omron.eu/downloads/latest/datasheet/en/e3z_compact_photoelectric_sensor_with_built-in_amplifier_datasheet_en.pdf";
      if (row.id === "base")
        row.specification +=
          " / nominal Ø4 holes indicate M4 threads; select tap-drill dimensions in fabrication review";
    }
  }
  if (d.kind === "lamp" && d.mechanismVersion === 2) {
    for (const row of rows) {
      row.sourceUrl = undefined;
      if (row.id === "led")
        row.sourceUrl = "https://www.adafruit.com/product/2855";
      if (row.id === "thermal-pad")
        row.sourceUrl =
          "https://multimedia.3m.com/mws/media/122119O/3m-thermally-conductive-adhesive-transfer-tapes-8800-series.pdf";
      if (row.id.includes("screw"))
        row.sourceUrl = "https://www.hpcgears.com/pdf_c33/5.54-5.59.pdf";
      if (row.id.includes("washer") || row.id.endsWith("-nut"))
        row.sourceUrl =
          "https://www.muepro.com/out/media/KP_EDELSTAHL-SECHSKANTMUTTER_DIN934_UNTERLEGSCHEIBEN_EN.PDF";
    }
  }
  if (d.kind === "planter" && d.mechanismVersion === 2) {
    rows = rows.filter((row) => row.id !== "pump-outlet");
    for (const row of rows) {
      row.sourceUrl = undefined;
      if (row.id === "pump") {
        row.sourceUrl = "https://www.adafruit.com/product/4546";
        row.specification +=
          " / integral outlet included; measure actual revision";
      }
      if (row.id === "inlet" || /^outlet-\d+$/.test(row.id))
        row.sourceUrl = "https://www.adafruit.com/product/4545";
      if (row.id.includes("screw"))
        row.sourceUrl = "https://shop.hpceurope.com/pdf/gbPDFauto/CHCSS.pdf";
    }
  }
  if (d.kind === "holder" && d.mechanismVersion === 2) {
    for (const row of rows) {
      row.sourceUrl = undefined;
      if (row.id.startsWith("bushing-"))
        row.sourceUrl =
          "https://www.igus.co.uk/iglidur-ibh/flanged-bearings/product-details/iglidur-g-m?artnr=GFM-0810-10";
      if (row.id.includes("screw") && row.id !== "screw")
        row.sourceUrl = "https://shop.hpceurope.com/pdf/gbPDFauto/CHCSS.pdf";
      if (row.id.startsWith("pivot-washer"))
        row.sourceUrl =
          "https://www.muepro.com/Products/Fastening-Technology/Accessories/Washers-M8-galvanised.html";
    }
  }
  return { parts, bom: rows, steps, connections, metrics, warnings };
}
