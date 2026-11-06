import * as THREE from "three";

export interface ScreenPoint { x: number; y: number }
export function pointInPolygon(point: ScreenPoint, polygon: ScreenPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    if (Math.abs(cross) < 1e-8 && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function polygonArea(polygon: ScreenPoint[]): number {
  return Math.abs(polygon.reduce((area, point, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}
export function decodeSelectionPixels(
  pixels: Uint8Array, width: number, height: number, polygon: ScreenPoint[], ids: Map<number, string>,
): string[] {
  const counts = new Map<string, number>();
  if (polygon.length < 3 || polygonArea(polygon) < 4) return [];
  const minX = Math.max(0, Math.floor(Math.min(...polygon.map(p => p.x))));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...polygon.map(p => p.x))));
  const minY = Math.max(0, Math.floor(Math.min(...polygon.map(p => p.y))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...polygon.map(p => p.y))));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if (!pointInPolygon({ x: x + 0.5, y: y + 0.5 }, polygon)) continue;
    // WebGL readback starts at the bottom; pointer positions start at the top.
    const offset = ((height - y - 1) * width + x) * 4;
    const id = ids.get(pixels[offset] | pixels[offset + 1] << 8 | pixels[offset + 2] << 16);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
}

// A depth-tested ID pass selects only geometry actually visible through the
// closed circle. It uses CSS-pixel resolution, independent of device ratio.
// Render state is restored even if the driver fails to read the framebuffer.
export function visiblePartsInPolygon(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  width: number, height: number, polygon: ScreenPoint[],
): string[] {
  const w = Math.max(1, Math.floor(width)), h = Math.max(1, Math.floor(height));
  if (polygon.length < 3 || polygonArea(polygon) < 4) return [];
  const target = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, stencilBuffer: false });
  target.texture.colorSpace = THREE.NoColorSpace;
  const ids = new Map<number, string>(), originals: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];
  const hidden: THREE.Object3D[] = [], materials: THREE.MeshBasicMaterial[] = [];
  const previous = { target: renderer.getRenderTarget(), background: scene.background, fog: scene.fog, override: scene.overrideMaterial,
    clearColor: renderer.getClearColor(new THREE.Color()), clearAlpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear, viewport: renderer.getViewport(new THREE.Vector4()),
    scissor: renderer.getScissor(new THREE.Vector4()), scissorTest: renderer.getScissorTest() };
  try {
    scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && typeof mesh.userData.partId === "string") {
        const index = ids.size + 1;
        ids.set(index, mesh.userData.partId);
        const material = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB((index & 255) / 255, (index >> 8 & 255) / 255, (index >> 16 & 255) / 255, THREE.LinearSRGBColorSpace), toneMapped: false });
        originals.push({ mesh, material: mesh.material });
        materials.push(material);
        mesh.material = material;
      } else if (object.visible && (mesh.isMesh || (object as THREE.Line).isLine || (object as THREE.Points).isPoints || (object as THREE.Sprite).isSprite)) {
        hidden.push(object); object.visible = false;
      }
    });
    scene.background = new THREE.Color(0); scene.fog = null; scene.overrideMaterial = null;
    renderer.autoClear = true;
    renderer.setRenderTarget(target); renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h); renderer.setClearColor(0, 1);
    renderer.clear(); renderer.render(scene, camera);
    const pixels = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
    return decodeSelectionPixels(pixels, w, h, polygon, ids);
  } finally {
    for (const { mesh, material } of originals) mesh.material = material;
    for (const object of hidden) object.visible = true;
    scene.background = previous.background; scene.fog = previous.fog; scene.overrideMaterial = previous.override;
    renderer.autoClear = previous.autoClear;
    renderer.setRenderTarget(previous.target); renderer.setViewport(previous.viewport);
    renderer.setScissor(previous.scissor); renderer.setScissorTest(previous.scissorTest);
    renderer.setClearColor(previous.clearColor, previous.clearAlpha);
    target.dispose(); materials.forEach(material => material.dispose());
  }
}
