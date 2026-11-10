import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html, Edges, Line } from "@react-three/drei";
import * as THREE from "three";
import { featuredGeometry, needsFeaturedGeometry } from "../lib/partGeometry";
import { bladeGeometry, boxProjectUv, finishFor, isCarbonFibre, twillTexture } from "../lib/droneLook";
import { StageEnvironment, StageGround, StageLights } from "./StudioStage";
import type { Part, Vec3 } from "../shared/types";
import { colors } from "../lib/tokens";
import { motionPose } from "../lib/motion";
import { explodedParts, explosionProgress, EXPLOSION_DURATION } from "../lib/explosion";
import { visiblePartsInPolygon, type ScreenPoint } from "../lib/selection";
import type { SelectionRef, SelectionSource } from "../shared/selection";
import { CircleSelectionOverlay, SpatialSelectionTools } from "./SpatialSelection";
import { displayTarget, partFeatures, resolveSurfaceFeature, surfaceTargetFromHit, type SurfaceFeature, type SurfaceTarget } from "../shared/surface";
import { projectParts, type PartTargetRequest, type ScreenTarget } from "../lib/projection";
type Props = {
  parts: Part[];
  activePartIds?: string[];
  playing?: boolean;
  speed?: number;
  exploded?: boolean;
  selected?: string;
  selectedPartIds?: string[];
  selectionContext?: { designId: string; revision: number };
  onSelection?: (selection: SelectionRef) => void;
  hoverEnabled?: boolean;
  hoverPicker?: React.MutableRefObject<(() => SelectionRef | null) | null>;
  voiceTarget?: SelectionRef | null;
  /** A pinned, frozen or proposal-bound surface, drawn on the model until it changes. */
  pointedTarget?: SelectionRef | null;
  onPendingSelectionChange?: (pending: boolean) => void;
  onSelect?: (id: string) => void;
  compact?: boolean;
  dimensions?: boolean;
  reset?: number;
  framingKey?: string;
  camera?: { position: Vec3; target: Vec3 };
  onCamera?: (camera: { position: Vec3; target: Vec3 }) => void;
  ariaLabel?: string;
  /** Filled with a projector from part ids (and an optional feature) to viewport pixels. */
  projector?: React.MutableRefObject<((target: PartTargetRequest) => ScreenTarget | null) | null>;
  /** Reports the hovered part and its readable feature label, or null. */
  onHoverChange?: (hover: { partId: string; label: string } | null) => void;
  /** Parts the assistant is pointing at; drawn with the hover outline. */
  highlightPartIds?: string[];
};
class CanvasBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? (
      <div className="canvas-fallback" role="status">
        The 3D view needs WebGL. Your dimensions, parts list and build files are
        still available.
      </div>
    ) : (
      this.props.children
    );
  }
}
function partBounds(parts: Part[]) {
  const b = new THREE.Box3();
  for (const p of parts) {
    const half = new THREE.Vector3(...p.size).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...(p.rotation || [0, 0, 0])),
    );
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...p.position),
      q,
      new THREE.Vector3(1, 1, 1),
    );
    b.union(new THREE.Box3(half.clone().negate(), half).applyMatrix4(matrix));
  }
  if (b.isEmpty())
    b.set(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 100, 50));
  return b;
}
function FeaturedGeometry({
  part,
  compact,
}: {
  part: Part;
  compact?: boolean;
}) {
  const geometry = useMemo(() => {
    return featuredGeometry(part, compact);
  }, [
    JSON.stringify([
      part.shape,
      part.size,
      part.holeDiameter,
      part.holes,
      part.sections,
      part.channel,
      part.loopSpan,
      part.edgeRadius,
    ]),
    compact,
  ]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive object={geometry} attach="geometry" />;
}

interface AssemblyFrame {
  progress: number;
  seconds: number;
  poses: Map<string, { position: Vec3; rotation: Vec3 }>;
}
function AssemblyAnimation({ parts, exploded, playing, speed, reduced, frozen, frame }: {
  parts: Part[]; exploded: boolean; playing: boolean; speed: number; reduced: boolean; frozen: boolean;
  frame: React.MutableRefObject<AssemblyFrame>;
}) {
  const { invalidate, gl } = useThree();
  const transition = useRef({ from: frame.current.progress, to: frame.current.progress, elapsed: EXPLOSION_DURATION, last: performance.now() });
  useEffect(() => {
    transition.current = { from: frame.current.progress, to: exploded ? 1 : 0, elapsed: 0, last: performance.now() };
    invalidate();
  }, [exploded, reduced, invalidate, frame]);
  useEffect(() => { transition.current.last = performance.now(); invalidate(); }, [frozen, invalidate]);
  useFrame((_, delta) => {
    const state = transition.current;
    const now = performance.now();
    if (!frozen) state.elapsed = Math.min(EXPLOSION_DURATION, state.elapsed + (now - state.last) / 1000);
    state.last = now;
    frame.current.progress = explosionProgress(state.from, state.to, state.elapsed, reduced);
    if (playing && !reduced) frame.current.seconds += Math.min(delta, .05) * speed;
    const movingParts = explodedParts(parts, frame.current.progress);
    frame.current.poses = new Map(movingParts.map(part => [part.id, motionPose(part, movingParts, frame.current.seconds)]));
    gl.domElement.dataset.explosionProgress = frame.current.progress.toFixed(4);
    gl.domElement.dataset.mechanismSeconds = frame.current.seconds.toFixed(4);
    if (!frozen && frame.current.progress !== state.to) invalidate();
  }, -1);
  return null;
}
// Studio finishes come from the shared render kit (droneLook.ts), so the home page stage,
// the studio and the still renders give each declared material the same look.
function surfaceFinish(part: Part) {
  const finish = finishFor(part);
  return { ...finish, color: new THREE.Color(finish.color) };
}
function PartMesh({
  part,
  parts,
  selectionContext,
  playing,
  speed = 1,
  selected,
  selectedPartIds,
  onSelect,
  compact,
  activePartIds,
  animation,
  focused = false,
  marker,
  labelPortal,
  onPick,
  surface,
  outlined = false,
  highlightPartIds,
}: Props & { outlined?: boolean; part: Part; animation: React.MutableRefObject<AssemblyFrame>; focused?: boolean; marker?: number; labelPortal: React.RefObject<HTMLElement>;
  onPick?: (target: SurfaceTarget) => void;
  surface?: { target: SurfaceTarget; feature: SurfaceFeature; mode: "hover" | "pinned"; label: string }[] }) {
  const ref = useRef<THREE.Mesh>(null);
  const rot = part.rotation || [0, 0, 0];
  const isSelected = selectedPartIds !== undefined ? selectedPartIds.includes(part.id) : selected === part.id;
  // Every part a change applies to gets the same soft tint and outline as a selection.
  const tinted = isSelected || !!highlightPartIds?.includes(part.id);
  const metal = /steel|alumin|metal/i.test(part.material),
    reference = part.role === "reference",
    ghost =
      !!activePartIds &&
      !activePartIds.includes(part.id) &&
      !isSelected,
    // The studio canvas keeps reference envelopes see-through, including during proposal review.
    referencePreview = reference && (!!onSelect || !!selectionContext);
  const finish = useMemo(() => surfaceFinish(part), [part.color, part.material, part.process, part.role, part.size.join()]);
  const carbon = isCarbonFibre(part.material), propeller = /propeller/i.test(part.material || "");
  const twill = useMemo(() => carbon ? twillTexture() : null, [carbon]);
  useEffect(() => () => twill?.dispose(), [twill]);
  // Carbon parts get millimetre texture coordinates, so the weave reads at its real scale.
  const carbonGeometry = useMemo(() => {
    if (!carbon) return null;
    const g = needsFeaturedGeometry(part) ? featuredGeometry(part, compact)
      : part.shape === "box" ? new THREE.BoxGeometry(...part.size) : new THREE.CylinderGeometry(part.size[0] / 2, part.size[0] / 2, part.size[1], compact ? 32 : 64);
    return boxProjectUv(g);
  }, [carbon, compact, JSON.stringify([part.shape, part.size, part.holes, part.holeDiameter, part.sections, part.channel, part.edgeRadius, part.loopSpan])]);
  useEffect(() => () => carbonGeometry?.dispose(), [carbonGeometry]);
  const blade = useMemo(() => propeller ? bladeGeometry(part.size[0], part.size[2]) : null, [propeller, part.size[0], part.size[2]]);
  useEffect(() => () => blade?.dispose(), [blade]);
  const materialColor = useMemo(() => {
    const c = carbon ? new THREE.Color("#b9c2cf") : finish.color.clone();
    if (tinted) c.lerp(new THREE.Color(colors.primary), 0.22);
    return c;
  }, [finish, tinted, carbon]);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const pose = animation.current.poses.get(part.id) || motionPose(part, parts, animation.current.seconds);
    m.position.set(...pose.position);
    m.rotation.set(...pose.rotation);
  });
  return (
    <mesh
      ref={ref}
      userData={{ partId: part.id }}
      position={part.position}
      rotation={rot}
      castShadow
      receiveShadow
      onClick={(e) => {
        if (onSelect) {
          // Let a click pass through a see-through reference envelope to the solid part behind it.
          if (reference && onPick && e.intersections.some(hit => hit.object !== e.object && parts?.find(p => p.id === hit.object.userData.partId && p.role !== "reference"))) return;
          e.stopPropagation();
          // A click or tap pins the exact surface; without a face it still selects the part.
          const own = e.intersections.find(hit => hit.object === e.eventObject);
          if (onPick && own?.face) onPick(surfaceTargetFromHit(part, e.eventObject.worldToLocal(own.point.clone()).toArray() as Vec3, own.face.normal.toArray() as Vec3));
          else onSelect(part.id);
        }
      }}
      onPointerOver={(e) => {
        if (onSelect) {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
      }}
    >
      {blade ? (
        <primitive object={blade} attach="geometry" />
      ) : carbonGeometry ? (
        <primitive object={carbonGeometry} attach="geometry" />
      ) : needsFeaturedGeometry(part) ? (
        <FeaturedGeometry part={part} compact={compact} />
      ) : part.shape === "box" ? (
        <boxGeometry args={part.size} />
      ) : (
        <cylinderGeometry
          args={[
            part.size[0] / 2,
            part.size[0] / 2,
            part.size[1],
            compact ? 32 : 64,
          ]}
        />
      )}
      <meshPhysicalMaterial
        color={materialColor}
        map={twill}
        roughnessMap={twill}
        clearcoat={finish.clearcoat ?? 0}
        clearcoatRoughness={finish.clearcoatRoughness ?? 0.55}
        metalness={finish.metalness}
        roughness={finish.roughness}
        envMapIntensity={carbon ? 0.3 : 1}
        emissive={
          tinted
            ? colors.primary
            : part.id === "led"
              ? part.color
              : colors.text
        }
        emissiveIntensity={
          tinted ? 0.08 : part.id === "led" ? 0.25 : 0
        }
        transparent={
          ghost || referencePreview || reference || /water|glass/i.test(part.material)
        }
        depthWrite={!ghost && !referencePreview && !reference}
        opacity={
          ghost
            ? 0.18
            : referencePreview || reference
              ? 0.04
              : /water|glass/i.test(part.material)
                ? 0.58
                : 1
        }
      />
      {(
        <Edges
          threshold={24}
          lineWidth={focused || outlined ? 3 : isSelected ? 2 : 1}
          color={
            isSelected
              ? colors.primary
              : focused || outlined
                ? colors.primary
              : reference
                ? colors.muted
                : colors.text
          }
          transparent
          opacity={
            isSelected || focused || outlined
              ? 1
              : ghost
                ? 0.07
                : reference
                  ? 0.55
                  : 0.38
          }
        />
      )}
      {/brushless motor/i.test(part.material || "") && part.shape === "cylinder" && !ghost && <mesh position={[0, -part.size[1] / 2 + 3, 0]}><cylinderGeometry args={[part.size[0] / 2 + 0.2, part.size[0] / 2 + 0.2, 4, 48]} /><meshStandardMaterial color="#b8733f" metalness={0.95} roughness={0.3} /></mesh>}
      {/lipo|battery/i.test(part.material || "") && part.shape === "box" && !part.edgeRadius && !ghost && <>
        <mesh position={[part.size[0] * 0.28, 0, 0]}><boxGeometry args={[4, part.size[1] + 0.4, part.size[2] + 0.4]} /><meshStandardMaterial color={colors.primary} roughness={0.4} /></mesh>
        <mesh><boxGeometry args={[14, part.size[1] + 1.6, part.size[2] + 1.6]} /><meshStandardMaterial color="#0c0e11" roughness={0.8} /></mesh>
      </>}
      {(marker || (focused && !surface?.some(s => s.mode === "pinned"))) && <Html portal={labelPortal} position={[0, 0, 0]} center zIndexRange={[2, 0]} style={{ pointerEvents: "none" }}>
        <span className={"part-marker" + (isSelected ? " is-checked" : "") + (focused ? " is-focused" : "")} data-part-marker={part.id} data-checked={isSelected}>
          {marker && <span>{marker}</span>}{marker && isSelected && <span aria-hidden="true">✓</span>}{focused && <span>{part.name}</span>}
        </span>
      </Html>}
      {surface?.map(item => <SurfaceHighlight key={item.mode} part={part} target={item.target} feature={item.feature} mode={item.mode} />)}
      {surface?.filter(item => item.mode === "pinned").map(item => <Html key="pinned-label" portal={labelPortal} position={item.target.point} zIndexRange={[3, 0]} style={{ pointerEvents: "none" }}>
        <span className="surface-label is-pinned" data-surface-label="pinned">{item.label}</span>
      </Html>)}
    </mesh>
  );
}
function FrameSignal({
  parts,
  onReady,
}: {
  parts: Part[];
  onReady: () => void;
}) {
  const ticks = useRef(0),
    done = useRef(false);
  const { invalidate } = useThree();
  useEffect(() => {
    ticks.current = 0;
    done.current = false;
    invalidate();
  }, [parts, invalidate]);
  useFrame(() => {
    if (done.current) return;
    if (++ticks.current >= 2) {
      done.current = true;
      onReady();
    } else invalidate();
  });
  return null;
}
function Camera({
  reset,
  remote,
  onCamera,
  box,
  parts,
  framingKey,
  enabled = true,
  exploded = false,
  reduced = false,
}: {
  exploded?: boolean;
  reduced?: boolean;
  enabled?: boolean;
  framingKey?: string;
  reset?: number;
  remote?: Props["camera"];
  onCamera?: Props["onCamera"];
  box: THREE.Box3;
  parts: Part[];
}) {
  const ref = useRef<any>(null);
  const previousExploded = useRef(exploded);
  const cameraTween = useRef<{ from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; elapsed: number; last: number } | null>(null);
  const { camera, invalidate, size, gl } = useThree();
  useEffect(() => { if (cameraTween.current) cameraTween.current.last = performance.now(); }, [enabled]);
  useFrame(() => {
    const tween = cameraTween.current;
    if (!tween || !ref.current || !enabled) return;
    const now = performance.now();
    tween.elapsed += (now - tween.last) / 1000;
    tween.last = now;
    const progress = explosionProgress(0, 1, tween.elapsed, reduced);
    camera.position.lerpVectors(tween.from, tween.to, progress);
    ref.current.target.lerpVectors(tween.fromTarget, tween.toTarget, progress);
    ref.current.update();
    if (progress === 1) cameraTween.current = null; else invalidate();
  });
  const center = box.getCenter(new THREE.Vector3());
  const extent = Math.max(...box.getSize(new THREE.Vector3()).toArray(), 80);
  useEffect(() => {
    const isExplosionChange = previousExploded.current !== exploded;
    previousExploded.current = exploded;
    const dir = isExplosionChange && ref.current
      ? camera.position.clone().sub(ref.current.target).normalize()
      : new THREE.Vector3(1.15, 0.9, 1.25).normalize(),
      right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), dir)
        .normalize(),
      up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const tan = Math.tan((35 * Math.PI) / 360),
      aspect = size.width / size.height,
      fit = size.width < 600 ? 0.97 : 0.9;
    let distance = 1;
    for (const part of parts) {
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...part.position),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...(part.rotation || [0, 0, 0])),
        ),
        new THREE.Vector3(1, 1, 1),
      );
      const points: THREE.Vector3[] = [];
      if (part.shape === "box") {
        for (const x of [-0.5, 0.5])
          for (const y of [-0.5, 0.5])
            for (const z of [-0.5, 0.5])
              points.push(
                new THREE.Vector3(
                  part.size[0] * x,
                  part.size[1] * y,
                  part.size[2] * z,
                ),
              );
      } else {
        for (let i = 0; i < 24; i++)
          for (const y of [-0.5, 0.5]) {
            const angle = (i * Math.PI) / 12;
            points.push(
              new THREE.Vector3(
                (Math.cos(angle) * part.size[0]) / 2,
                part.size[1] * y,
                (Math.sin(angle) * part.size[0]) / 2,
              ),
            );
          }
      }
      for (const point of points) {
        const v = point.applyMatrix4(matrix).sub(center);
        distance = Math.max(
          distance,
          v.dot(dir) + Math.abs(v.dot(right)) / (tan * aspect * fit),
          v.dot(dir) + Math.abs(v.dot(up)) / (tan * fit),
        );
      }
    }
    const destination = center.clone().addScaledVector(dir, distance * 1.03);
    if (isExplosionChange && !reduced && ref.current) {
      cameraTween.current = { from: camera.position.clone(), to: destination,
        fromTarget: ref.current.target.clone(), toTarget: center.clone(), elapsed: 0, last: performance.now() };
    } else {
      cameraTween.current = null;
      camera.position.copy(destination);
      camera.lookAt(center);
      if (ref.current) { ref.current.target.copy(center); ref.current.update(); }
      // Passive inspection hook, matching the one OrbitControls writes after a drag.
      gl.domElement.dataset.view = JSON.stringify({ position: camera.position.toArray(), target: center.toArray() });
    }
    invalidate();
  }, [
    reset,
    exploded,
    reduced,
    framingKey ?? `${box.min.toArray().join()}:${box.max.toArray().join()}`,
    size.width,
    size.height,
    camera,
    invalidate,
  ]);
  useEffect(() => {
    if (remote && ref.current) {
      cameraTween.current = null;
      camera.position.set(...remote.position);
      ref.current.target.set(...remote.target);
      ref.current.update();
      invalidate();
    }
  }, [remote, camera, invalidate]);
  return (
    <OrbitControls
      ref={ref}
      makeDefault
      enabled={enabled}
      minDistance={extent * 0.4}
      maxDistance={extent * 6}
      enableDamping={false}
      maxPolarAngle={Math.PI * 0.49}
      onStart={() => { cameraTween.current = null; }}
      onChange={() => {
        if (ref.current)
          gl.domElement.dataset.view = JSON.stringify({
            position: camera.position.toArray(),
            target: ref.current.target.toArray(),
          });
      }}
      onEnd={() => {
        if (onCamera && ref.current)
          onCamera({
            position: camera.position.toArray() as Vec3,
            target: ref.current.target.toArray() as Vec3,
          });
      }}
    />
  );
}
const NO_RAYCAST = () => null;
// Draws only the pointed feature, in part-local axes, on top of the part.
// It never takes part in hover/click raycasts or the circle ID pass.
function SurfaceHighlight({ part, target, feature, mode }: { part: Part; target: SurfaceTarget; feature: SurfaceFeature; mode: "hover" | "pinned" }) {
  const shapes = useMemo(() => {
    const half = part.size.map(v => v / 2) as Vec3, lift = Math.max(0.06, Math.max(...part.size) * 0.0015);
    const out: { geometry: THREE.BufferGeometry; position: Vec3; rotation?: Vec3; quaternion?: THREE.Quaternion }[] = [];
    const lines: Vec3[][] = [];
    const circle = (cx: number, y: number, cz: number, r: number) => Array.from({ length: 49 }, (_, i) => [cx + Math.cos(i / 48 * Math.PI * 2) * r, y, cz + Math.sin(i / 48 * Math.PI * 2) * r] as Vec3);
    const planeRotation = (axis: "x" | "y" | "z", side: number): Vec3 => axis === "y" ? [-side * Math.PI / 2, 0, 0] : axis === "x" ? [0, side * Math.PI / 2, 0] : [0, side < 0 ? Math.PI : 0, 0];
    const round = part.shape !== "box";
    if (feature.kind === "hole") {
      const hole = part.holes![feature.holeIndex!], r = hole.diameter / 2, outer = Math.max(hole.counterbore ? hole.counterbore.diameter / 2 : r, r) + Math.max(2, r * 0.6);
      for (const side of [1, -1]) {
        out.push({ geometry: new THREE.RingGeometry(r, outer, 48), position: [hole.x, side * (half[1] + lift), hole.z], rotation: planeRotation("y", side) });
        lines.push(circle(hole.x, side * (half[1] + lift), hole.z, r), circle(hole.x, side * (half[1] + lift), hole.z, outer));
      }
      out.push({ geometry: new THREE.CylinderGeometry(r - lift, r - lift, part.size[1], 48, 1, true), position: [hole.x, 0, hole.z] });
    } else if (feature.kind === "bore" && part.loopSpan === undefined) {
      const r = feature.dimensions.diameter / 2;
      out.push({ geometry: new THREE.CylinderGeometry(r - lift, r - lift, part.size[1], 48, 1, true), position: [0, 0, 0] });
      for (const side of [1, -1]) {
        out.push({ geometry: new THREE.RingGeometry(r, r + Math.max(1, r * 0.3), 48), position: [0, side * (half[1] + lift), 0], rotation: planeRotation("y", side) });
        lines.push(circle(0, side * (half[1] + lift), 0, r));
      }
    } else if (feature.kind === "outer" && part.shape === "ellipsoid") {
      const geometry = new THREE.SphereGeometry(0.5, 48, 24);
      geometry.scale(part.size[0] + 2 * lift, part.size[1] + 2 * lift, part.size[2] + 2 * lift);
      out.push({ geometry, position: [0, 0, 0] });
      lines.push(circle(0, 0, 0, half[0] + lift));
    } else if (feature.kind === "outer" && part.loopSpan === undefined) {
      const r = feature.dimensions.diameter / 2 + lift;
      out.push({ geometry: new THREE.CylinderGeometry(r, r, part.size[1], 64, 1, true), position: [0, 0, 0] });
      for (const side of [1, -1]) lines.push(circle(0, side * half[1], 0, r));
    } else if (feature.kind === "channel") {
      const c = part.channel!;
      out.push({ geometry: new THREE.PlaneGeometry(part.size[0], c.width), position: [0, -half[1] + c.depth - lift, 0], rotation: planeRotation("y", -1) });
      const y = -half[1] + c.depth - lift, w = c.width / 2;
      lines.push([[-half[0], y, -w], [half[0], y, -w], [half[0], y, w], [-half[0], y, w], [-half[0], y, -w]]);
    } else if (feature.kind === "face" && feature.axis) {
      const a = feature.axis, side = feature.side!, i = "xyz".indexOf(a);
      const position = [0, 0, 0] as Vec3; position[i] = side * (half[i] + lift);
      // A rounded box's flat face stops where its edge fillets begin.
      const flat = part.size.map(v => Math.max(0.1, v - 2 * (part.edgeRadius || 0))) as Vec3, flatHalf = flat.map(v => v / 2) as Vec3;
      const geometry = round ? (part.shape === "tube" && part.holeDiameter && part.loopSpan === undefined && !part.sections
        ? new THREE.RingGeometry(part.holeDiameter / 2, half[0], 64) : new THREE.CircleGeometry(half[0], 64))
        : a === "y" ? new THREE.PlaneGeometry(flat[0], flat[2]) : a === "x" ? new THREE.PlaneGeometry(flat[2], flat[1]) : new THREE.PlaneGeometry(flat[0], flat[1]);
      out.push({ geometry, position, rotation: planeRotation(a, side) });
      if (round) lines.push(circle(0, position[1], 0, half[0]));
      else {
        const [u, v] = [0, 1, 2].filter(k => k !== i), corner = (su: number, sv: number) => { const q = [...position] as Vec3; q[u] = su * flatHalf[u]; q[v] = sv * flatHalf[v]; return q; };
        lines.push([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1), corner(-1, -1)]);
      }
    } else {
      const n = new THREE.Vector3(...target.normal).normalize(), radius = Math.max(2, Math.max(...part.size) * 0.04);
      out.push({ geometry: new THREE.CircleGeometry(radius, 32), position: new THREE.Vector3(...target.point).addScaledVector(n, lift).toArray() as Vec3,
        quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n) });
    }
    return { out, lines };
  }, [part, feature.id, feature.kind, feature.label, target.point.join(), target.normal.join()]);
  useEffect(() => () => shapes.out.forEach(shape => shape.geometry.dispose()), [shapes]);
  return <group>{shapes.lines.map((points, index) => <Line key={"line-" + index} points={points} color={colors.action} lineWidth={mode === "pinned" ? 3 : 2.5}
    raycast={NO_RAYCAST} renderOrder={4} transparent depthWrite={false} />)}{shapes.out.map((shape, index) => <mesh key={index} geometry={shape.geometry} position={shape.position} rotation={shape.rotation} quaternion={shape.quaternion}
    raycast={NO_RAYCAST} renderOrder={3} userData={{ surfaceHighlight: mode }}>
    <meshBasicMaterial color={colors.action} transparent opacity={mode === "pinned" ? 0.55 : 0.38} side={THREE.DoubleSide} depthWrite={false}
      polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} toneMapped={false} />
  </mesh>)}</group>;
}
export interface HoverHit { partId: string; target: SurfaceTarget; x: number; y: number }
function HoverBridge({ enabled, parts, onHover, picker }: { enabled: boolean; parts: Part[]; onHover: (hit: HoverHit | null) => void; picker: React.MutableRefObject<(() => HoverHit | null) | null> }) {
  const { gl, scene, camera } = useThree();
  const latest = useRef(onHover); latest.current = onHover;
  const byId = useRef(new Map<string, Part>()); byId.current = new Map(parts.map(part => [part.id, part]));
  useFrame(() => { picker.current?.(); });
  useEffect(() => {
    const canvas = gl.domElement, ray = new THREE.Raycaster(), point = new THREE.Vector2();
    let dragging = false, pointer: { x: number; y: number } | null = null;
    const clear = () => { pointer = null; latest.current(null); };
    const down = () => { dragging = true; clear(); };
    const up = () => { dragging = false; clear(); };
    const hit = (): HoverHit | null => {
      if (!enabled || dragging || !pointer) return null;
      const bounds = canvas.getBoundingClientRect();
      point.set((pointer.x - bounds.left) / bounds.width * 2 - 1, -(pointer.y - bounds.top) / bounds.height * 2 + 1);
      const meshes: THREE.Object3D[] = [];
      scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      scene.traverseVisible(object => { if ((object as THREE.Mesh).isMesh && typeof object.userData.partId === "string") meshes.push(object); });
      ray.setFromCamera(point, camera);
      // A see-through reference envelope never hides the solid part behind it.
      const hits = ray.intersectObjects(meshes, false);
      const intersection = hits.find(item => byId.current.get(item.object.userData.partId)?.role !== "reference") || hits[0];
      const part = intersection && byId.current.get(intersection.object.userData.partId);
      if (!intersection || !part || !intersection.face) { latest.current(null); return null; }
      // Part-local hit point and face normal: the frame of the part's own features.
      const local = intersection.object.worldToLocal(intersection.point.clone());
      const result = { partId: part.id, target: surfaceTargetFromHit(part, local.toArray() as Vec3, intersection.face.normal.toArray() as Vec3),
        x: pointer.x - bounds.left, y: pointer.y - bounds.top };
      latest.current(result); return result;
    };
    picker.current = hit;
    const move = (event: PointerEvent) => {
      if (!enabled || dragging || event.buttons || event.pointerType === "touch") { clear(); return; }
      pointer = { x: event.clientX, y: event.clientY }; hit();
    };
    const wheel = (event: WheelEvent) => {
      if (!enabled || dragging) { clear(); return; }
      pointer = { x: event.clientX, y: event.clientY };
      latest.current(null); // The next frame and speech onset recast after the camera zoom.
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointerleave", clear);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel);
    window.addEventListener("pointerup", up);
    clear();
    return () => { picker.current = null; canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointerleave", clear); canvas.removeEventListener("pointercancel", up); canvas.removeEventListener("wheel", wheel); window.removeEventListener("pointerup", up); clear(); };
  }, [enabled, gl, scene, camera, picker]);
  return null;
}
// Viewport coordinates of a part or one of its features, for overlays outside the canvas.
function ProjectionBridge({ parts, projector }: { parts: Part[]; projector: NonNullable<Props["projector"]> }) {
  const { gl, scene, camera, size } = useThree();
  const byId = useRef(new Map<string, Part>()); byId.current = new Map(parts.map(part => [part.id, part]));
  const occlusion = useRef(new Map<string, { at: number; hidden: boolean }>());
  const ray = useMemo(() => new THREE.Raycaster(), []);
  useEffect(() => {
    projector.current = ({ partIds, featureId }) => {
      const part = byId.current.get(partIds[0]);
      const anchor = part && featureId ? partFeatures(part).find(entry => entry.feature.id === featureId)?.target.point : undefined;
      const hit = projectParts(scene, camera, size.width, size.height, partIds, anchor ? new THREE.Vector3(...anchor) : undefined);
      if (!hit) return null;
      // A marker whose part is hidden behind another solid part is not shown.
      // The ray test is cheap (part meshes only) and reused for a few frames.
      let occluded = false;
      if (hit.visible) {
        const key = partIds.join(",") + "|" + (featureId || "") + "|" + Math.round(hit.x) + "," + Math.round(hit.y);
        const now = performance.now(), cached = occlusion.current.get(key);
        if (cached && now - cached.at < 250) occluded = cached.hidden;
        else {
          const meshes: THREE.Object3D[] = [];
          scene.traverseVisible(object => { if ((object as THREE.Mesh).isMesh && typeof object.userData?.partId === "string") meshes.push(object); });
          ray.setFromCamera(new THREE.Vector2((hit.x / size.width) * 2 - 1, -(hit.y / size.height) * 2 + 1), camera);
          const first = ray.intersectObjects(meshes, false).find(entry => {
            const material = (entry.object as THREE.Mesh).material as THREE.Material | undefined;
            return !(material && material.transparent && material.opacity < 0.5);
          });
          occluded = !!first && !partIds.includes(first.object.userData.partId);
          if (occlusion.current.size > 64) occlusion.current.clear();
          occlusion.current.set(key, { at: now, hidden: occluded });
        }
      }
      const { left, top } = gl.domElement.getBoundingClientRect();
      return { ...hit, visible: hit.visible && !occluded, x: hit.x + left, y: hit.y + top, rect: { left: hit.rect.left + left, right: hit.rect.right + left, top: hit.rect.top + top, bottom: hit.rect.bottom + top } };
    };
    return () => { projector.current = null; };
  }, [gl, scene, camera, size.width, size.height, projector]);
  return null;
}
type PolygonPicker = ((points: ScreenPoint[]) => string[]) | null;
function SelectionBridge({ picker }: { picker: React.MutableRefObject<PolygonPicker> }) {
  const { gl, scene, camera, size, invalidate } = useThree();
  useEffect(() => {
    picker.current = points => {
      try { return visiblePartsInPolygon(gl, scene, camera, size.width, size.height, points); }
      finally { invalidate(); }
    };
    return () => { picker.current = null; };
  }, [gl, scene, camera, size.width, size.height, invalidate, picker]);
  return null;
}
export default function ModelCanvas(props: Props) {
  const { compact, playing = false, dimensions = false } = props;
  // Keep Html roots on one DOM owner while Canvas connects its event target.
  // Inferring that target can recreate a root on the same label container.
  const labelPortal = useRef<HTMLDivElement>(null!);
  const [circleMode, setCircleMode] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  useEffect(() => { props.onPendingSelectionChange?.(candidates.length > 1); }, [candidates.length, props.onPendingSelectionChange]);
  const [checked, setChecked] = useState<string[]>([]);
  const [focusedCandidate, setFocusedCandidate] = useState<string | null>(null);
  const [hover, setHoverState] = useState<HoverHit | null>(null);
  const hoverKey = useRef(""), hoverLabel = useRef<HTMLSpanElement>(null);
  const placeLabel = (hit: HoverHit | null) => {
    const element = hoverLabel.current, width = labelPortal.current?.clientWidth || 0;
    if (!hit || !element) return;
    element.style.left = `${hit.x}px`; element.style.top = `${hit.y}px`;
    element.classList.toggle("is-flipped", hit.x > width - 250);
  };
  // State changes only when the pointed feature changes; the label follows the pointer directly.
  const setHover = (hit: HoverHit | null) => {
    const key = hit ? `${hit.partId}|${hit.target.featureId}|${hit.target.featureId === "surface" ? hit.target.point.join() : ""}` : "";
    placeLabel(hit);
    if (key === hoverKey.current) return;
    hoverKey.current = key; setHoverState(hit);
  };
  const hovered = hover?.partId ?? null;
  const dismiss = () => { setCandidates([]); setChecked([]); setFocusedCandidate(null); setSelectionMessage(""); };
  const displayIds = candidates.length ? checked : props.selectedPartIds ?? (props.selected ? [props.selected] : []);
  const [selectionMessage, setSelectionMessage] = useState("");
  const picker = useRef<PolygonPicker>(null);
  const hoverHit = useRef<(() => HoverHit | null) | null>(null);
  useEffect(() => {
    if (!props.hoverPicker) return;
    props.hoverPicker.current = () => {
      if (!props.hoverEnabled || circleMode || candidates.length || !props.selectionContext) return null;
      const hit = hoverHit.current?.();
      return hit ? { ...props.selectionContext, partIds: [hit.partId], source: "hover", surface: hit.target } : null;
    };
    return () => { if (props.hoverPicker) props.hoverPicker.current = null; };
  }, [props.hoverPicker, props.hoverEnabled, circleMode, candidates.length, props.selectionContext?.designId, props.selectionContext?.revision]);
  const animation = useRef<AssemblyFrame>({ progress: props.exploded ? 1 : 0, seconds: 0, poses: new Map() });
  const canSelect = !!(props.onSelect || props.onSelection);
  const choose = (ids: string[], source: SelectionSource, surface?: SurfaceTarget) => {
    const existing = [...new Set(ids)].filter(id => props.parts.some(part => part.id === id));
    if (!existing.length) return;
    if (existing.length > 1 && (!props.onSelection || !props.selectionContext)) {
      setSelectionMessage("Choose one of the circled parts before continuing."); return;
    }
    setCircleMode(false); setCandidates([]); setChecked([]); setFocusedCandidate(null);
    setSelectionMessage(existing.length === 1 ? `${props.parts.find(part => part.id === existing[0])!.name} selected.` : `${existing.length} parts selected.`);
    props.onSelect?.(existing[0]);
    if (props.selectionContext) props.onSelection?.({ ...props.selectionContext, partIds: existing, source, ...(surface && existing.length === 1 && surface.partId === existing[0] ? { surface } : {}) });
  };
  const partById = useMemo(() => new Map(props.parts.map(part => [part.id, part])), [props.parts]);
  const pinned = useMemo(() => {
    const surface = props.pointedTarget?.surface, part = surface && partById.get(surface.partId);
    const shown = part && surface ? displayTarget(part, surface) : null;
    return part && shown ? { partId: part.id, ...shown, label: `${part.name}, ${shown.feature.label}`, spoken: `${part.name}, ${shown.feature.label}` } : null;
  }, [props.pointedTarget, partById]);
  const hoverInfo = useMemo(() => {
    const part = hover && partById.get(hover.partId);
    if (!hover || !part) return null;
    const feature = resolveSurfaceFeature(part, hover.target.point, hover.target.normal);
    return { ...hover, feature, label: `${part.name}, ${feature.label}`, spoken: `${part.name}, ${feature.label}` };
  }, [hover, partById]);
  // A frozen utterance target is the only target drawn while it lasts.
  const showHover = !!hoverInfo && !props.voiceTarget && !(pinned && pinned.partId === hoverInfo.partId && pinned.feature.id === hoverInfo.feature.id);
  const onHoverChange = useRef(props.onHoverChange); onHoverChange.current = props.onHoverChange;
  useEffect(() => { onHoverChange.current?.(hoverInfo && showHover ? { partId: hoverInfo.partId, label: hoverInfo.label } : null); }, [hoverInfo?.partId, hoverInfo?.label, showHover]);
  const [spokenHover, setSpokenHover] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSpokenHover(hoverInfo?.spoken || ""), 450);
    return () => clearTimeout(timer);
  }, [hoverInfo?.spoken]);
  useEffect(() => { setCircleMode(false); setCandidates([]); setChecked([]); setFocusedCandidate(null); setSelectionMessage(""); }, [props.selectionContext?.designId, props.selectionContext?.revision]);
  useEffect(() => {
    setCandidates([]); setChecked([]); setFocusedCandidate(null);
    const ids = props.selectedPartIds ?? (props.selected ? [props.selected] : []);
    setSelectionMessage(ids.length === 1 ? `${props.parts.find(part => part.id === ids[0])?.name || "Part"} selected.` : ids.length ? `${ids.length} parts selected.` : "");
  }, [props.selected, props.selectedPartIds]);
  useEffect(() => { setHover(null); }, [props.selectionContext?.designId, props.selectionContext?.revision, props.hoverEnabled, props.exploded, props.reset, props.camera]);
  const [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false);
  // Once mounted, synchronous part/pose updates retain the rendered view.
  // FrameSignal still requests frames; only the initial canvas needs a loading overlay.
  const originalBox = useMemo(() => partBounds(props.parts), [props.parts]);
  const parts = useMemo(() => explodedParts(props.parts, props.exploded ? 1 : 0), [props.parts, props.exploded]);
  const box = useMemo(() => partBounds(parts), [parts]);
  const size = box.getSize(new THREE.Vector3()),
    extent = Math.max(size.x, size.y, size.z, 120),
    center = box.getCenter(new THREE.Vector3()).toArray() as Vec3;
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(q.matches);
    const on = () => setReduced(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return (
    <div
      className={"model-canvas" + (compact ? " compact" : "") + (!compact && canSelect ? " is-selectable" : "") + (props.selected ? " has-selection" : "")}
      role={failed || canSelect ? "region" : "img"}
      data-highlighted-parts={displayIds.join(",")}
      data-hovered-part={hovered || ""}
      data-hovered-surface={hoverInfo ? `${hoverInfo.partId}:${hoverInfo.feature.id}` : ""}
      data-pointed-surface={pinned ? `${pinned.partId}:${pinned.feature.id}` : ""}
      data-ready={failed ? "error" : ready ? "true" : "false"}
      aria-busy={!ready && !failed}
      aria-label={
        failed
          ? "3D preview unavailable"
          : props.ariaLabel ||
            "Interactive 3D product. Drag to rotate, scroll to zoom."
      }
    >
      <div className="model-canvas-viewport">
      <div ref={labelPortal} className="model-label-layer" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
      {showHover && <span ref={hoverLabel} className={"surface-label is-hover" + (hoverInfo!.x > (labelPortal.current?.clientWidth || 0) - 250 ? " is-flipped" : "")} data-surface-label="hover" aria-hidden="true"
        style={{ left: hoverInfo!.x, top: hoverInfo!.y }}>{hoverInfo!.label}</span>}
      <p className="sr-only" aria-live="polite" data-testid="pointing-status">{pinned ? `Pointing at ${pinned.spoken}` : spokenHover ? `Pointer over ${spokenHover}` : ""}</p>
      <CanvasBoundary onFailure={() => setFailed(true)}>
        <Canvas
          shadows={!compact}
          dpr={[1, compact ? 1 : 1.5]}
          camera={{
            fov: 35,
            near: 0.1,
            far: 20000,
            position: [extent * 1.25, extent, extent * 1.25],
          }}
          gl={{ antialias: true, preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.92 }}
          frameloop={playing && !reduced ? "always" : "demand"}
        >
          <AssemblyAnimation parts={props.parts} exploded={!!props.exploded} playing={playing && !circleMode}
            speed={props.speed ?? 1} reduced={reduced} frozen={circleMode} frame={animation} />
          <SelectionBridge picker={picker} />
          {props.projector && <ProjectionBridge parts={props.parts} projector={props.projector} />}
          <HoverBridge enabled={!!props.hoverEnabled && !circleMode && !candidates.length} parts={props.parts} onHover={setHover} picker={hoverHit} />
          <FrameSignal parts={parts} onReady={() => setReady(true)} />
          <color attach="background" args={[colors.surface]} />
          {/* The shared stage: studio environment, key/fill/rim lights and a ground with a contact shadow */}
          <StageEnvironment intensity={0.55} />
          <StageLights extent={extent} shadows={!compact} />
          <Suspense fallback={null}>
            {props.parts.map((part) => (
              <PartMesh
                key={part.id}
                {...props}
                parts={props.parts}
                animation={animation}
                labelPortal={labelPortal}
                playing={playing && !reduced && !circleMode}
                onSelect={canSelect && !circleMode ? id => choose([id], "click") : undefined}
                selected={undefined}
                selectedPartIds={displayIds}
                focused={focusedCandidate === part.id || (!props.voiceTarget?.surface && (props.voiceTarget?.partIds[0] || (showHover ? null : hovered)) === part.id)}
                outlined={(props.voiceTarget?.partIds[0] || hovered) === part.id || !!props.highlightPartIds?.includes(part.id)}
                marker={candidates.includes(part.id) ? candidates.indexOf(part.id) + 1 : undefined}
                onPick={canSelect && !circleMode && props.onSelection && props.selectionContext ? target => choose([target.partId], "click", target) : undefined}
                surface={[
                  ...(showHover && hoverInfo!.partId === part.id ? [{ target: hoverInfo!.target, feature: hoverInfo!.feature, mode: "hover" as const, label: hoverInfo!.label }] : []),
                  ...(pinned && pinned.partId === part.id ? [{ target: pinned.target, feature: pinned.feature, mode: "pinned" as const, label: pinned.label }] : []),
                ]}
                part={part}
              />
            ))}
            <StageGround y={box.min.y} radius={extent * 1.5} center={[center[0], center[2]]} opacity={0.6} />
            {dimensions && (
              <Html
                portal={labelPortal}
                position={[center[0], box.min.y - 5, box.max.z + 15]}
                center
              >
                <span className="dimension-tag">
                  {Math.round(originalBox.getSize(new THREE.Vector3()).x)} ×{" "}
                  {Math.round(originalBox.getSize(new THREE.Vector3()).z)} mm
                </span>
              </Html>
            )}
            <Camera
              enabled={!circleMode}
              exploded={!!props.exploded}
              reduced={reduced}
              reset={props.reset}
              framingKey={props.framingKey}
              remote={props.camera}
              onCamera={props.onCamera}
              box={box}
              parts={parts}
            />
          </Suspense>
        </Canvas>
      </CanvasBoundary>
      {ready && !failed && !compact && canSelect && circleMode && <CircleSelectionOverlay
        onCancel={() => setCircleMode(false)}
        onCircle={points => {
          try {
            const picked = picker.current?.(points) || [];
            const ids = props.parts.filter(part => picked.includes(part.id)).map(part => part.id);
            setCircleMode(false); setCandidates(ids.length > 1 ? ids : []); setChecked(ids); setFocusedCandidate(null);
            if (ids.length === 1) choose(ids, "circle");
            else setSelectionMessage(ids.length ? "Confirm which visible parts you want to edit." : "No visible part inside that circle. Try a larger circle or use the parts list.");
          } catch {
            setCircleMode(false); setSelectionMessage("Circle selection is unavailable in this view. Choose a part from the list.");
          }
        }} />}
      {!ready && !failed && <div className="model-loading">Loading model…</div>}
      </div>
      {!compact && canSelect && <SpatialSelectionTools
        parts={props.parts} selectedIds={props.selectedPartIds || (props.selected ? [props.selected] : [])}
        circleMode={circleMode} onCircleMode={enabled => { setHover(null); setCircleMode(enabled); dismiss(); }}
        circleAvailable={ready && !failed} candidates={candidates} checked={checked} onChecked={setChecked} onFocusPart={setFocusedCandidate} onChoose={choose} onDismiss={dismiss} message={selectionMessage}
      />}
      {ready &&
        !failed &&
        !compact &&
        props.onSelect &&
        !props.activePartIds &&
        !circleMode && !candidates.length && !selectionMessage &&
        props.parts
          .filter((part) => part.role === "reference")
          .slice(0, 1)
          .map((part) => (
            <span className="canvas-reference-label" style={{ top: 62 }} key={part.id}>
              <i style={{ background: part.color }} />
              {part.name}
            </span>
          ))}
    </div>
  );
}
