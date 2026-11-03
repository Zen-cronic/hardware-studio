import { Vector3, Quaternion, Euler } from "three";
import type { Part, Vec3 } from "../shared/types";
function ownPose(
  part: Part,
  parts: Part[],
  seconds: number,
): { position: Vec3; rotation: Vec3 } {
  const position = [...part.position] as Vec3,
    rotation = [...(part.rotation || [0, 0, 0])] as Vec3;
  const motion = part.motion;
  if (!motion) return { position, rotation };
  const axis = motion.axis === "x" ? 0 : motion.axis === "y" ? 1 : 2;
  const distance = Math.max(0.001, motion.range || 40),
    travel = Math.max(0, seconds) * Math.abs(motion.speed);
  if (motion.type === "rotate")
    rotation[axis] += (seconds * motion.speed * 2 * Math.PI) / 60;
  if (motion.type === "slide") {
    if (part.id === "parcel") {
      position[axis] += travel % distance;
      const gate = parts.find((p) => p.id === "diverter");
      if (gate && position[0] > gate.position[0] - 20)
        position[2] += Math.max(0, position[0] - gate.position[0] + 20) * 0.8;
    } else if (part.id === "jaw-moving") {
      const phase = travel % (distance * 2);
      position[axis] -= phase < distance ? phase : distance * 2 - phase;
    } else {
      const phase = (travel + distance / 2) % (distance * 2);
      position[axis] +=
        phase < distance ? phase - distance / 2 : distance * 1.5 - phase;
    }
  }
  if (motion.type === "pivot") {
    if (part.id === "diverter") {
      const parcel = parts.find((p) => p.id === "parcel");
      if (parcel?.motion) {
        const x =
          parcel.position[0] +
          ((seconds * Math.abs(parcel.motion.speed)) %
            (parcel.motion.range || 40));
        const proximity = Math.max(0, 1 - Math.abs(x - part.position[0]) / 45);
        rotation[axis] += proximity * (motion.range || Math.PI / 3);
      }
    } else
      rotation[axis] +=
        (Math.sin(seconds * motion.speed) * (motion.range || 0.4)) / 2;
  }
  if (motion.type === "flow")
    position[axis] += (Math.sin(seconds * motion.speed) * distance) / 2;
  return { position, rotation };
}

export function motionPose(
  part: Part,
  parts: Part[],
  seconds: number,
): { position: Vec3; rotation: Vec3 } {
  const pose = ownPose(part, parts, seconds);
  const parent = part.parentId
    ? parts.find((p) => p.id === part.parentId)
    : undefined;
  if (!parent) return pose;
  const parentPose = motionPose(parent, parts, seconds);
  const original = new Quaternion().setFromEuler(
    new Euler(...(parent.rotation || [0, 0, 0])),
  );
  const delta = new Quaternion()
    .setFromEuler(new Euler(...parentPose.rotation))
    .multiply(original.invert());
  const position = new Vector3(...pose.position)
    .sub(new Vector3(...parent.position))
    .applyQuaternion(delta)
    .add(new Vector3(...parentPose.position));
  const rotation = new Euler().setFromQuaternion(
    delta.multiply(new Quaternion().setFromEuler(new Euler(...pose.rotation))),
  );
  return {
    position: position.toArray() as Vec3,
    rotation: [rotation.x, rotation.y, rotation.z],
  };
}
