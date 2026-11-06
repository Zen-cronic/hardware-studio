import * as THREE from "three";
import type { Part, Vec3 } from "../shared/types";

export const EXPLOSION_DURATION = 0.72;
export function explosionProgress(from: number, to: number, seconds: number, reducedMotion = false): number {
  if (reducedMotion || seconds >= EXPLOSION_DURATION) return to;
  const t = Math.max(0, Math.min(1, seconds / EXPLOSION_DURATION));
  return from + (to - from) * t * t * (3 - 2 * t);
}
export function explodedParts(parts: Part[], progress: number): Part[] {
  if (progress <= 0) return parts;
  const amount = Math.min(1, progress), bounds = new THREE.Box3();
  for (const part of parts) {
    const half = new THREE.Vector3(...part.size).multiplyScalar(.5);
    bounds.union(new THREE.Box3(half.clone().negate(), half).applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(...part.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0]))), new THREE.Vector3(1, 1, 1))));
  }
  if (bounds.isEmpty()) return parts;
  const center = bounds.getCenter(new THREE.Vector3()), extent = Math.max(...bounds.getSize(new THREE.Vector3()).toArray());
  const levels = [...new Set(parts.map(p => Math.round(p.position[1])))].sort((a, b) => a - b);
  return parts.map(part => ({ ...part, position: [
    part.position[0] + (part.position[0] - center.x) * .25 * amount,
    part.position[1] + (levels.indexOf(Math.round(part.position[1])) - (levels.length - 1) / 2) * Math.min(extent * .1, 35) * amount,
    part.position[2] + (part.position[2] - center.z) * .25 * amount,
  ] as Vec3 }));
}
