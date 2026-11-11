import type { Part, ProductKind } from "./types";

// Product finishes for the starter designs: each part gets the colour of a real
// finish (anodised aluminium, black-oxide screws, rubber, bronze, printed plastic).
// Only `color` changes; names, sizes, holes and declared materials stay as built.
// The render kit (droneLook.ts) reads the matching metalness and roughness from LOOKS,
// and the colour travels into the exported GLB as each part's base colour.

export interface Look { color: string; metalness: number; roughness: number; clearcoat?: number; clearcoatRoughness?: number }

export const LOOKS = {
  clearAnodised: { color: "#9EA7B1", metalness: 0.82, roughness: 0.34 },
  blackAnodised: { color: "#25292F", metalness: 0.55, roughness: 0.42, clearcoat: 0.15, clearcoatRoughness: 0.5 },
  redAnodised: { color: "#8C3341", metalness: 0.55, roughness: 0.36, clearcoat: 0.2, clearcoatRoughness: 0.4 },
  blueAnodised: { color: "#2E5F92", metalness: 0.55, roughness: 0.36, clearcoat: 0.2, clearcoatRoughness: 0.4 },
  orangePowder: { color: "#C2622E", metalness: 0.1, roughness: 0.58, clearcoat: 0.25, clearcoatRoughness: 0.5 },
  yellowPowder: { color: "#D6A23A", metalness: 0.1, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.5 },
  greenPowder: { color: "#2F5B4E", metalness: 0.1, roughness: 0.6, clearcoat: 0.2, clearcoatRoughness: 0.55 },
  bluePaint: { color: "#34587C", metalness: 0.2, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.45 },
  castBlack: { color: "#1F2226", metalness: 0.35, roughness: 0.62 },
  machinedSteel: { color: "#9AA3AD", metalness: 0.92, roughness: 0.24 },
  stainless: { color: "#C4CAD0", metalness: 0.92, roughness: 0.2 },
  blackOxide: { color: "#2C2F35", metalness: 0.75, roughness: 0.38 },
  zinc: { color: "#ADB5BC", metalness: 0.88, roughness: 0.3 },
  bearing: { color: "#8E97A1", metalness: 0.95, roughness: 0.16 },
  bronze: { color: "#A97A43", metalness: 0.9, roughness: 0.32 },
  motorCan: { color: "#A3ABB4", metalness: 0.85, roughness: 0.3 },
  motorBlack: { color: "#2A2D32", metalness: 0.35, roughness: 0.45 },
  rubber: { color: "#1B1D20", metalness: 0, roughness: 0.88 },
  belt: { color: "#2B2D30", metalness: 0, roughness: 0.8 },
  blackPlastic: { color: "#22252A", metalness: 0, roughness: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.5 },
  redPrint: { color: "#7A2834", metalness: 0, roughness: 0.6 },
  terracotta: { color: "#B5603C", metalness: 0, roughness: 0.7 },
  slatePlastic: { color: "#34434A", metalness: 0, roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.45 },
  greyPlastic: { color: "#58656C", metalness: 0, roughness: 0.55 },
  tubing: { color: "#8FB7C4", metalness: 0, roughness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.1 },
  silicone: { color: "#3F4C50", metalness: 0, roughness: 0.75 },
  frictionFibre: { color: "#5B4535", metalness: 0, roughness: 0.85 },
  opal: { color: "#E6E8EA", metalness: 0, roughness: 0.65 },
  thermalTape: { color: "#8C8F86", metalness: 0, roughness: 0.8 },
  sensorBody: { color: "#2E3338", metalness: 0.1, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.3 },
} satisfies Record<string, Look>;

type LookName = keyof typeof LOOKS;
const BY_COLOR = new Map<string, Look>(Object.values(LOOKS).map((l) => [l.color.toUpperCase(), l]));

/** The finish for a colour from the starter palette, if it is one. */
export const lookForColor = (color = "") => BY_COLOR.get(color.toUpperCase());

type Rule = [RegExp, LookName];

// Shared fastener and hardware rules, checked after each design's own rules.
const HARDWARE: Rule[] = [
  [/screw|tie-|bolt/, "blackOxide"],
  [/nut/, "zinc"],
  [/washer/, "zinc"],
  [/bearing/, "bearing"],
  [/foot|pad/, "rubber"],
  [/belt/, "belt"],
  [/collar|coupling|pulley|idler$|diverter/, "clearAnodised"],
];

const BY_MATERIAL: Rule[] = [
  [/stainless/, "stainless"],
  [/bearing steel/, "bearing"],
  [/galvanised/, "zinc"],
  [/bronze/, "bronze"],
  [/rubber|belting|2gt belt/, "rubber"],
  [/friction/, "frictionFibre"],
  [/silicone/, "silicone"],
  [/pvc/, "tubing"],
  [/opal/, "opal"],
  [/tape/, "thermalTape"],
  [/iglidur/, "blackPlastic"],
  [/photoelectric/, "sensorBody"],
  [/stepper/, "motorBlack"],
  [/gearmotor|pump/, "motorCan"],
  [/integral motor feature|pump integral/, "machinedSteel"],
  [/^steel$/, "machinedSteel"],
  [/alumin/, "clearAnodised"],
];

const DESIGN: Partial<Record<ProductKind, Rule[]>> = {
  turntable: [
    [/^platter-cover$/, "redPrint"],
    [/^platter$/, "clearAnodised"],
    [/^(base-floor|motor-plate)$/, "blackAnodised"],
    [/support$|retainer$|seat$/, "blackAnodised"],
    [/^post-/, "clearAnodised"],
    [/spacer$/, "redAnodised"],
    [/^motor-shaft$|^shaft$/, "machinedSteel"],
    [/^motor-pilot$/, "motorCan"],
  ],
  slider: [
    [/^carriage$/, "blueAnodised"],
    [/^belt-clamp/, "blueAnodised"],
    [/^base$|^riser-/, "blackAnodised"],
    [/^tension-plate$/, "blackAnodised"],
    [/^rail-(front|rear)$|^block-/, "bearing"],
    [/^stop-.*(?<!screw|nut)$/, "redAnodised"],
    [/^foot-.*(?<!screw)$/, "blackOxide"],
    [/^camera-screw$|^idler-axle$/, "stainless"],
    [/^idler-spacer/, "machinedSteel"],
  ],
  conveyor: [
    [/^frame-/, "orangePowder"],
    [/^bed$/, "stainless"],
    [/^bed-beam/, "blackAnodised"],
    [/^gate-blade$|^gate-arm$/, "yellowPowder"],
    [/^gate-post$|^gate-mount$|^sensor-(post|platform|bracket)$/, "blackAnodised"],
    [/^roller-/, "machinedSteel"],
    [/shoulder$|seat$|retainer$/, "blackAnodised"],
    [/spacer$/, "machinedSteel"],
  ],
  lamp: [
    [/^base-pad$/, "rubber"],
    [/^base$|^base-foot$|^pivot-lower$/, "castBlack"],
    [/^(lower|upper)-arm$/, "greenPowder"],
    [/^shade$|^head-cap$|^head-lug$/, "greenPowder"],
    [/^diffuser-retainer$|^spreader$/, "clearAnodised"],
  ],
  planter: [
    [/^reservoir$|^wall-/, "slatePlastic"],
    [/^pot-/, "terracotta"],
    [/^shelf$|^support-|^pump-(cradle|cap|spacer)/, "greyPlastic"],
    [/^manifold|^inlet-tail$|^outlet-tail/, "greyPlastic"],
    [/^pump$/, "motorBlack"],
  ],
  holder: [
    [/^yoke-|^guide$|^ear-|^nut$|^base/, "bluePaint"],
    [/^jaw-/, "machinedSteel"],
    [/^pad-/, "rubber"],
    [/^rod-\d|^rod--?\d+$/, "stainless"],
    [/^handle$/, "blackOxide"],
    [/^screw$/, "machinedSteel"],
    [/^thrust-/, "bronze"],
  ],
};

function pick(kind: ProductKind, part: Part): LookName | undefined {
  const id = part.id, material = (part.material || "").toLowerCase();
  for (const [re, look] of DESIGN[kind] ?? []) if (re.test(id)) return look;
  // Distinctive materials win over the id-based hardware guesses.
  for (const [re, look] of BY_MATERIAL.slice(0, 11)) if (re.test(material)) return look;
  for (const [re, look] of HARDWARE) if (re.test(id)) return look;
  for (const [re, look] of BY_MATERIAL) if (re.test(material)) return look;
  return undefined;
}

/** Recolours a starter design's parts with real product finishes. Reference envelopes keep their colour. */
export function applyLook<T extends Part>(kind: ProductKind, parts: T[]): T[] {
  if (kind === "custom") return parts;
  return parts.map((part) => {
    if (part.role === "reference" || part.material === "Reference envelope") return part;
    const look = pick(kind, part);
    return look ? { ...part, color: LOOKS[look].color } : part;
  });
}
