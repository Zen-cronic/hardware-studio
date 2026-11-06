import * as THREE from "three";
import type { Snapshot, Vec3, Part } from "../shared/types";
import { explodedParts } from "./explosion";
import { motionPose } from "./motion";

export const CLIP_FORMAT = { durationSeconds: 20, fps: 30, width: 1920, height: 1080 } as const;
export interface ClipFormat { durationSeconds: number; fps: number; width: number; height: number }
export interface ClipProject {
  version: 1;
  snapshot: Snapshot;
  snapshotHash: string;
  format: ClipFormat;
  renderSettings?: { viewportHeight: number; holdFinalCaption: boolean };
  shots: { startFrame: number; endFrame: number; title: string; subtitle: string }[];
  framing: { center: Vec3; assembledRadius: number; explodedCenter: Vec3; explodedRadius: number };
}
export interface ClipFrame {
  frame: number; seconds: number; shot: number;
  camera: { position: Vec3; target: Vec3; fov: number; viewportHeight: number };
  explosion: number; mechanismSeconds: number;
  title: string; subtitle: string; captionOpacity: number;
}
export interface ClipJob {
  id: string; designId: string; revision: number; snapshotHash: string;
  status: "queued" | "running" | "ready" | "failed" | "cancelled";
  frame: number; totalFrames: number; format: ClipFormat;
  createdAt: string; finishedAt?: string; error?: string; downloadUrl?: string; stale?: boolean;
}
export function frozenClipSnapshot(snapshot: Snapshot): Snapshot {
  return structuredClone({ design: snapshot.design, derived: snapshot.derived, history: [] });
}
export function canonicalClipSource(snapshot: Snapshot): string {
  const sort = (value: any): any => Array.isArray(value) ? value.map(sort) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, sort(value[key])])) : value;
  return JSON.stringify(sort({ design: snapshot.design, derived: snapshot.derived }));
}
function partBox(part: Part, position = part.position, rotation = part.rotation || [0, 0, 0] as Vec3) {
  const half = new THREE.Vector3(...part.size).multiplyScalar(.5);
  return new THREE.Box3(half.clone().negate(), half).applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1)));
}
function framing(parts: Part[], motionSeconds: number) {
  const box = new THREE.Box3();
  for (let step = 0; step <= 8; step++) for (const part of parts) {
    const pose = motionPose(part, parts, motionSeconds * step / 8);
    box.union(partBox(part, pose.position, pose.rotation));
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-50, -50, -50), new THREE.Vector3(50, 50, 50));
  return { center: box.getCenter(new THREE.Vector3()).toArray() as Vec3, radius: Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1) };
}
export function makeClipProject(snapshot: Snapshot, snapshotHash: string, format: ClipFormat = CLIP_FORMAT): ClipProject {
  if (!Number.isInteger(format.width) || !Number.isInteger(format.height) || format.width < 160 || format.height < 90 ||
      format.width > 1920 || format.height > 1080 || format.width % 2 || format.height % 2 ||
      !Number.isInteger(format.fps) || format.fps < 1 || format.fps > 30 || !Number.isFinite(format.durationSeconds) ||
      format.durationSeconds <= 0 || format.durationSeconds > 20 || !Number.isInteger(format.fps * format.durationSeconds))
    throw new Error("Clip format must use even dimensions and an exact number of frames within the supported limits.");
  const frozen = frozenClipSnapshot(snapshot), total = format.fps * format.durationSeconds;
  const assembled = framing(frozen.derived.parts, 10), exploded = framing(explodedParts(frozen.derived.parts, 1), 0);
  const title = frozen.design.name.trim().slice(0, 120) || "Your product";
  const titles = [title, "Explore every component", "See it in motion", title];
  const subtitles = ["Designed to work together", "An assembly you can inspect and edit", "Function follows your design", "Create. Customize. Build."];
  return { version: 1, snapshot: frozen, snapshotHash, format: { ...format }, renderSettings: { viewportHeight: .74, holdFinalCaption: true },
    shots: titles.map((title, i) => ({ startFrame: Math.floor(total * i / 4), endFrame: Math.floor(total * (i + 1) / 4), title, subtitle: subtitles[i] })),
    framing: { center: assembled.center, assembledRadius: assembled.radius, explodedCenter: exploded.center, explodedRadius: exploded.radius } };
}
const ease = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
export function evaluateClipFrame(project: ClipProject, frame: number): ClipFrame {
  const total = project.format.durationSeconds * project.format.fps;
  if (!Number.isInteger(frame) || frame < 0 || frame >= total) throw new Error("Frame is outside this clip timeline.");
  const seconds = frame / project.format.fps, normalized = seconds / project.format.durationSeconds;
  const shot = Math.min(3, Math.floor(normalized * 4)), section = project.shots[shot];
  const sectionProgress = (frame - section.startFrame) / Math.max(1, section.endFrame - section.startFrame);
  const explosion = normalized >= .25 && normalized < .5
    ? ease((normalized - .25) / .055) * ease((.5 - normalized) / .055) : 0;
  const mechanismSeconds = Math.max(0, (normalized - .5) * 20);
  const center = new THREE.Vector3(...project.framing.center).lerp(new THREE.Vector3(...project.framing.explodedCenter), explosion);
  const radius = THREE.MathUtils.lerp(project.framing.assembledRadius, project.framing.explodedRadius, explosion);
  // Keep the lower quarter clear for captions in every shot and every mechanism.
  const fov = 35, viewportHeight = project.renderSettings?.viewportHeight ?? 1, aspect = project.format.width / (project.format.height * viewportHeight);
  const verticalHalf = fov * Math.PI / 360;
  const limitingHalf = Math.min(verticalHalf, Math.atan(Math.tan(verticalHalf) * aspect));
  const distance = radius / Math.sin(limitingHalf) * 1.15;
  const angle = .72 + normalized * Math.PI * 1.5;
  const direction = new THREE.Vector3(Math.sin(angle), .55, Math.cos(angle)).normalize();
  const position = center.clone().addScaledVector(direction, distance);
  return { frame, seconds, shot, explosion, mechanismSeconds,
    camera: { position: position.toArray() as Vec3, target: center.toArray() as Vec3, fov, viewportHeight },
    title: section.title, subtitle: section.subtitle,
    captionOpacity: shot === 0 ? Math.min(1, ease(sectionProgress * 12) + .2) : shot === 3 && project.renderSettings?.holdFinalCaption ? ease(sectionProgress * 12) : Math.min(ease(sectionProgress * 12), ease((1 - sectionProgress) * 12)) };
}
