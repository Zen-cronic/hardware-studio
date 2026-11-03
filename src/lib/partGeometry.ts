import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Part } from "../shared/types";

export function featuredGeometry(
  part: Part,
  compact = false,
): THREE.BufferGeometry {
  if (
    part.shape === "box" &&
    (part.channel || part.holes?.some((h) => h.counterbore))
  ) {
    return mountingBoxGeometry(part, compact);
  }
  let offset = -part.size[1] / 2;
  const sections = part.sections || [
    {
      height: part.size[1],
      diameter: part.size[0],
      bore: part.shape === "tube" ? part.holeDiameter! : 0,
    },
  ];
  const chunks = sections.map((section) => {
    const shape = new THREE.Shape();
    if (part.shape === "box") {
      shape.moveTo(-part.size[0] / 2, -part.size[2] / 2);
      shape.lineTo(part.size[0] / 2, -part.size[2] / 2);
      shape.lineTo(part.size[0] / 2, part.size[2] / 2);
      shape.lineTo(-part.size[0] / 2, part.size[2] / 2);
      shape.closePath();
    } else shape.absarc(0, 0, section.diameter / 2, 0, Math.PI * 2, false);
    const hole = (x: number, z: number, diameter: number) => {
      const path = new THREE.Path();
      path.absarc(x, -z, diameter / 2, 0, Math.PI * 2, true);
      shape.holes.push(path);
    };
    if (section.bore) hole(0, 0, section.bore);
    for (const h of part.holes || [])
      if (
        part.shape === "box" ||
        Math.hypot(h.x, h.z) + h.diameter / 2 < section.diameter / 2
      )
        hole(h.x, h.z, h.diameter);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: section.height,
      bevelEnabled: false,
      curveSegments: compact ? 16 : 40,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, offset, 0);
    offset += section.height;
    return g;
  });
  const merged = mergeGeometries(chunks, false);
  chunks.forEach((g) => g.dispose());
  return merged!;
}

// Build exposed surfaces only: stacking closed extrusions leaves coincident
// internal caps and false seams where a channel or counterbore changes section.
function mountingBoxGeometry(part: Part, compact: boolean) {
  const [x, y, z] = part.size,
    c = part.channel,
    holes = part.holes || [];
  const chunks: THREE.BufferGeometry[] = [];
  const plane = (
    shape: THREE.Shape,
    map: (u: number, v: number) => number[],
    normal: number[],
  ) => {
    const g = new THREE.ShapeGeometry(shape, compact ? 16 : 40).toNonIndexed();
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const q = map(pos.getX(i), pos.getY(i));
      pos.setXYZ(i, q[0], q[1], q[2]);
    }
    orient(g, normal);
    chunks.push(g);
  };
  const rectangle = (a: number, b: number, d: number, e: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(a, b);
    shape.lineTo(d, b);
    shape.lineTo(d, e);
    shape.lineTo(a, e);
    shape.closePath();
    return shape;
  };
  const face = (
    z0: number,
    z1: number,
    y0: number,
    up: boolean,
    top: boolean,
  ) => {
    const shape = rectangle(-x / 2, -z1, x / 2, -z0);
    for (const h of holes)
      if (h.z > z0 && h.z < z1) {
        const path = new THREE.Path();
        path.absarc(
          h.x,
          -h.z,
          (top ? (h.counterbore?.diameter ?? h.diameter) : h.diameter) / 2,
          0,
          Math.PI * 2,
          true,
        );
        shape.holes.push(path);
      }
    plane(shape, (u, v) => [u, y0, -v], [0, up ? 1 : -1, 0]);
  };
  face(-z / 2, z / 2, y / 2, true, true);
  if (c) {
    face(-z / 2, -c.width / 2, -y / 2, false, false);
    face(c.width / 2, z / 2, -y / 2, false, false);
    face(-c.width / 2, c.width / 2, -y / 2 + c.depth, false, false);
  } else face(-z / 2, z / 2, -y / 2, false, false);
  for (const sign of [-1, 1]) {
    plane(
      rectangle(-x / 2, -y / 2, x / 2, y / 2),
      (u, v) => [u, v, (sign * z) / 2],
      [0, 0, sign],
    );
    if (c)
      plane(
        rectangle(-x / 2, -y / 2, x / 2, -y / 2 + c.depth),
        (u, v) => [u, v, (sign * c.width) / 2],
        [0, 0, -sign],
      );
    const shape = new THREE.Shape();
    const points = c
      ? [
          [-z / 2, -y / 2],
          [-c.width / 2, -y / 2],
          [-c.width / 2, -y / 2 + c.depth],
          [c.width / 2, -y / 2 + c.depth],
          [c.width / 2, -y / 2],
          [z / 2, -y / 2],
          [z / 2, y / 2],
          [-z / 2, y / 2],
        ]
      : [
          [-z / 2, -y / 2],
          [z / 2, -y / 2],
          [z / 2, y / 2],
          [-z / 2, y / 2],
        ];
    points.forEach(([u, v], i) =>
      i ? shape.lineTo(u, v) : shape.moveTo(u, v),
    );
    shape.closePath();
    plane(shape, (u, v) => [(sign * x) / 2, v, u], [sign, 0, 0]);
  }
  for (const h of holes) {
    const cb = h.counterbore;
    for (const [bottom, top, radius] of cb
      ? [
          [-y / 2, y / 2 - cb.depth, h.diameter / 2],
          [y / 2 - cb.depth, y / 2, cb.diameter / 2],
        ]
      : [[-y / 2, y / 2, h.diameter / 2]]) {
      const g = new THREE.CylinderGeometry(
        radius,
        radius,
        top - bottom,
        compact ? 32 : 80,
        1,
        true,
      ).toNonIndexed();
      g.translate(h.x, (top + bottom) / 2, h.z);
      reverse(g);
      chunks.push(g);
    }
    if (cb) {
      const shape = new THREE.Shape();
      shape.absarc(h.x, -h.z, cb.diameter / 2, 0, Math.PI * 2, false);
      const inner = new THREE.Path();
      inner.absarc(h.x, -h.z, h.diameter / 2, 0, Math.PI * 2, true);
      shape.holes.push(inner);
      plane(shape, (u, v) => [u, y / 2 - cb.depth, -v], [0, 1, 0]);
    }
  }
  const merged = mergeGeometries(chunks, false)!;
  chunks.forEach((g) => g.dispose());
  return merged;
}
function reverse(g: THREE.BufferGeometry) {
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i += 3) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    pos.setXYZ(i, pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
    pos.setXYZ(i + 1, x, y, z);
  }
  g.computeVertexNormals();
}
function orient(g: THREE.BufferGeometry, normal: number[]) {
  const p = g.getAttribute("position");
  if (p.count < 3) return;
  const a = new THREE.Vector3().fromBufferAttribute(p, 0),
    b = new THREE.Vector3().fromBufferAttribute(p, 1),
    c = new THREE.Vector3().fromBufferAttribute(p, 2);
  if (
    b
      .sub(a)
      .cross(c.sub(a))
      .dot(new THREE.Vector3(...normal)) < 0
  )
    reverse(g);
  else g.computeVertexNormals();
}
