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
  if (motion.type === "rotate") {
    let angle = (seconds * motion.speed * 2 * Math.PI) / 60;
    const direction = motion.direction;
    const leader = motion.drivenBy
      ? parts.find((p) => p.id === motion.drivenBy)
      : undefined;
    if (leader?.motion && motion.travelPerTurn) {
      const leaderAxis =
        leader.motion.axis === "x" ? 0 : leader.motion.axis === "y" ? 1 : 2;
      const leaderPosition = ownPose(leader, parts, seconds).position;
      const displacement = leader.motion.direction
        ? leaderPosition.reduce(
            (n, v, i) =>
              n + (v - leader.position[i]) * leader.motion!.direction![i],
            0,
          )
        : leaderPosition[leaderAxis] - leader.position[leaderAxis];
      angle = -(displacement * 2 * Math.PI) / motion.travelPerTurn;
    }
    if (!direction && rotation.every((value, i) => i === axis || value === 0)) {
      rotation[axis] += angle;
    } else {
      const worldAxis = new Vector3(
        direction?.[0] ?? (axis === 0 ? 1 : 0),
        direction?.[1] ?? (axis === 1 ? 1 : 0),
        direction?.[2] ?? (axis === 2 ? 1 : 0),
      );
      const pose = new Euler().setFromQuaternion(
        new Quaternion()
          .setFromAxisAngle(worldAxis, angle)
          .multiply(new Quaternion().setFromEuler(new Euler(...rotation))),
      );
      rotation[0] = pose.x;
      rotation[1] = pose.y;
      rotation[2] = pose.z;
    }
  }
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
  if (motion.type === "slide" && motion.direction) {
    const displacement = position[axis] - part.position[axis];
    for (let i = 0; i < 3; i++)
      position[i] = part.position[i] + displacement * motion.direction[i];
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
