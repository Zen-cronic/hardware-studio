import { Box3, Vector3, type Camera, type Object3D } from "three";

export interface ScreenRect { left: number; top: number; right: number; bottom: number }
/** A target on screen in the canvas's own pixel frame (origin at its top-left corner). */
export interface ScreenTarget {
  x: number;
  y: number;
  rect: ScreenRect;
  /** True when the anchor is in front of the camera and inside the canvas. */
  visible: boolean;
}
export interface PartTargetRequest { partIds: string[]; featureId?: string }

const scratch = new Vector3();

/** Projects a world point to canvas pixels. */
export function projectPoint(point: Vector3, camera: Camera, width: number, height: number) {
  scratch.copy(point).project(camera);
  const x = (scratch.x + 1) / 2 * width, y = (1 - scratch.y) / 2 * height;
  // NDC z beyond ±1 is outside the near/far range, including behind the camera.
  const inFront = scratch.z >= -1 && scratch.z <= 1;
  return { x, y, inFront, visible: inFront && x >= 0 && x <= width && y >= 0 && y <= height };
}

/** Screen rectangle of a world box's eight corners; the anchor defaults to the box centre. */
export function projectBox(box: Box3, camera: Camera, width: number, height: number, anchor?: Vector3): ScreenTarget | null {
  if (box.isEmpty()) return null;
  const rect: ScreenRect = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (let i = 0; i < 8; i++) {
    const corner = new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    const p = projectPoint(corner, camera, width, height);
    rect.left = Math.min(rect.left, p.x); rect.right = Math.max(rect.right, p.x);
    rect.top = Math.min(rect.top, p.y); rect.bottom = Math.max(rect.bottom, p.y);
  }
  const centre = projectPoint(anchor || box.getCenter(new Vector3()), camera, width, height);
  return { x: centre.x, y: centre.y, rect, visible: centre.visible };
}

/**
 * Projects the meshes tagged with the requested part ids. A feature anchor, in the first
 * part's own millimetre frame, replaces the bounding-box centre when one is given.
 */
export function projectParts(scene: Object3D, camera: Camera, width: number, height: number, partIds: string[], localAnchor?: Vector3): ScreenTarget | null {
  const box = new Box3();
  let first: Object3D | undefined;
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  scene.traverseVisible(object => {
    const id = object.userData?.partId;
    if (typeof id !== "string" || !partIds.includes(id) || !(object as { isMesh?: boolean }).isMesh) return;
    box.union(new Box3().setFromObject(object));
    if (id === partIds[0] && !first) first = object;
  });
  if (box.isEmpty()) return null;
  const anchor = localAnchor && first ? first.localToWorld(localAnchor.clone()) : undefined;
  return projectBox(box, camera, width, height, anchor);
}
