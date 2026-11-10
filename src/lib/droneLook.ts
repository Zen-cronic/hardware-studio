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
