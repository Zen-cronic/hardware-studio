import * as THREE from "three";

// Render-time looks shared by the home page drone and the studio canvas: a carbon twill
// texture, a motion-blur disc for spinning propellers, and a tapered, twisted blade.

export function twillTexture() {
  const size = 128, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1b1f25"; ctx.fillRect(0, 0, size, size);
  // 2x2 twill: diagonal bands of alternating tows catch the light differently.
  const tow = 8;
  for (let y = 0; y < size; y += tow) for (let x = 0; x < size; x += tow) {
    const phase = ((x / tow) + (y / tow)) % 4 < 2;
    const g = ctx.createLinearGradient(x, y, x + (phase ? tow : 0), y + (phase ? 0 : tow));
    g.addColorStop(0, phase ? "#343c47" : "#171b20"); g.addColorStop(.5, phase ? "#2a313a" : "#1f242b"); g.addColorStop(1, phase ? "#3b444f" : "#15181d");
    ctx.fillStyle = g; ctx.fillRect(x, y, tow, tow);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function discTexture() {
  const size = 256, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.06, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(200,220,245,0.05)"); g.addColorStop(0.55, "rgba(200,220,245,0.22)");
  g.addColorStop(0.9, "rgba(200,220,245,0.30)"); g.addColorStop(1, "rgba(200,220,245,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A two-blade propeller with taper and twist, sized from the declared part's diameter.
export function bladeGeometry(diameter: number, chord: number) {
  const g = new THREE.BoxGeometry(diameter, 1.4, chord, 32, 1, 2);
  const p = g.attributes.position, R = diameter / 2;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), r = Math.abs(x) / R;
    const width = THREE.MathUtils.lerp(1, 0.45, r) * (r > 0.92 ? Math.sqrt(Math.max(0, 1 - (r - 0.92) / 0.08)) * 0.9 + 0.1 : 1);
    const twist = THREE.MathUtils.lerp(0.42, 0.12, r) * Math.sign(x || 1);
    const z = p.getZ(i) * width, y = p.getY(i);
    p.setXYZ(i, x, y * Math.cos(twist) - z * Math.sin(twist), y * Math.sin(twist) + z * Math.cos(twist));
  }
  g.computeVertexNormals();
  return g;
}

// Render kit: one finish per declared material, shared by the home page stage, the studio
// canvas and the still renders, so every view of a part looks like the same object.
export interface Finish {
  color: string;
  metalness: number;
  roughness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  opacity?: number;
  /** Draw the carbon twill weave (the colour then tints the weave texture). */
  twill?: boolean;
}

// Named finish colours for props drawn outside the parts list (the landing camera payload).
export const KIT = { graphite: "#2A3038", satinBlack: "#1A1D22", aluminium: "#A9B3BF", glass: "#0E1A2A" } as const;

// Whole material names or codes, so "Polycarbonate" never reads as carbon fibre.
const CARBON_FIBRE = /\bcarbon fib(re|er)\b/i;
export const isCarbonFibre = (material = "") => CARBON_FIBRE.test(material);

function srgb(hex: string) {
  return /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) : [0.5, 0.5, 0.5];
}

export function finishFor(part: { color: string; material: string; process: string; role?: string; size: [number, number, number] }): Finish {
  const m = part.material || "";
  if (isCarbonFibre(m)) return { color: "#ffffff", metalness: 0.1, roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.45, twill: true };
  if (/propeller/i.test(m)) return { color: "#2B3542", metalness: 0.05, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2, opacity: 0.9 };
  if (/brushless motor/i.test(m)) return { color: "#1B1F25", metalness: 0.78, roughness: 0.34, clearcoat: 0.3, clearcoatRoughness: 0.3 };
  if (/\btpu\b/i.test(m)) return { color: "#1A1D22", metalness: 0, roughness: 0.72 };
  if (/lipo|battery/i.test(m)) return { color: part.color, metalness: 0.05, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.4 };
  if (/optical glass|\blens\b/i.test(m)) return { color: part.color, metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02 };
  if (/camera module/i.test(m)) return { color: part.color, metalness: 0.35, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 };
  if (/\bled\b/i.test(m)) return { color: part.color, metalness: 0, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.1 };
  if (/\bpa12\b|\bnylon\b|\bpetg\b/i.test(m)) return { color: part.color, metalness: 0, roughness: 0.46, clearcoat: 0.18, clearcoatRoughness: 0.5 };
  if (/circuit|fr-4/i.test(m)) return { color: "#22513B", metalness: 0.2, roughness: 0.5 };
  // Metals before the plate rule, so a thin aluminium plate stays aluminium.
  if (/alumin/i.test(m)) return part.process === "buy" ? { color: "#3E5878", metalness: 0.75, roughness: 0.35 } : { color: "#A9B3BF", metalness: 0.88, roughness: 0.3 };
  if (/steel|brass|metal/i.test(m)) return { color: "#7E8893", metalness: 0.9, roughness: 0.28 };
  const dims = [...part.size].sort((a, b) => a - b), plate = dims[2] > 40 && dims[0] / dims[2] < 0.12;
  if (plate && part.process !== "buy") return { color: "#353C46", metalness: 0.35, roughness: 0.42 };
  const hex = srgb(part.color), chroma = Math.max(...hex) - Math.min(...hex), light = (Math.max(...hex) + Math.min(...hex)) / 2;
  if (part.process === "buy" && part.role !== "reference") {
    const c = new THREE.Color(part.color).lerp(new THREE.Color("#1E232A"), 0.75);
    return { color: "#" + c.getHexString(), metalness: 0.35, roughness: 0.42 };
  }
  if (chroma < 0.12 && light > 0.55) return { color: "#4F5864", metalness: 0.06, roughness: 0.46 };
  return { color: part.color, metalness: 0.04, roughness: 0.55 };
}

/** A physical material for a part's finish, with the carbon weave when it applies. */
export function finishMaterial(finish: Finish, twill?: THREE.Texture | null) {
  return new THREE.MeshPhysicalMaterial({
    color: finish.color, metalness: finish.metalness, roughness: finish.roughness,
    clearcoat: finish.clearcoat ?? 0, clearcoatRoughness: finish.clearcoatRoughness ?? 0.3,
    map: finish.twill && twill ? twill : null, roughnessMap: finish.twill && twill ? twill : null,
    transparent: finish.opacity !== undefined && finish.opacity < 1, opacity: finish.opacity ?? 1,
  });
}

/**
 * Replaces a geometry's texture coordinates with millimetre box projection, so one
 * texture tile covers `period` mm on every part whatever its size or geometry type.
 */
export function boxProjectUv<T extends THREE.BufferGeometry>(geometry: T, period = 36): T {
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const p = geometry.attributes.position, n = geometry.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : ax >= az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)];
    uv[i * 2] = u / period; uv[i * 2 + 1] = v / period;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/**
 * Ground under a model: a soft disc a step lighter than the page, with a faint millimetre
 * grid that fades out. Dithered with fine noise so the falloff never bands.
 */
export function groundTexture(disc: string, line: string, cells = 16) {
  const size = 1024, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!, half = size / 2;
  const fade = (alpha: number) => {
    const g = ctx.createRadialGradient(half, half, 0, half, half, half);
    for (let i = 0; i <= 10; i++) { const t = i / 10; g.addColorStop(t, `rgba(0,0,0,${alpha * Math.pow(1 - t, 1.6)})`); }
    return g;
  };
  ctx.fillStyle = disc; ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.globalAlpha = 0.45;
  for (let i = 0; i <= cells; i++) {
    const at = Math.round((i / cells) * size) + 0.5;
    ctx.beginPath(); ctx.moveTo(at, 0); ctx.lineTo(at, size); ctx.moveTo(0, at); ctx.lineTo(size, at); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Keep the colour, take the radial falloff as alpha.
  ctx.globalCompositeOperation = "destination-in"; ctx.fillStyle = fade(1); ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "source-over";
  const image = ctx.getImageData(0, 0, size, size), d = image.data;
  for (let i = 3; i < d.length; i += 4) d[i] = Math.max(0, Math.min(255, d[i] * 0.55 + (Math.random() - 0.5) * 3));
  ctx.putImageData(image, 0, 0);
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
