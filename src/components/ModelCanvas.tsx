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
import { ContactShadows, OrbitControls, Html, Edges } from "@react-three/drei";
import * as THREE from "three";
import { featuredGeometry } from "../lib/partGeometry";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Part, Vec3 } from "../shared/types";
import { colors } from "../lib/tokens";
import { motionPose } from "../lib/motion";
import { explodedParts, explosionProgress, EXPLOSION_DURATION } from "../lib/explosion";
import { visiblePartsInPolygon, type ScreenPoint } from "../lib/selection";
import type { SelectionRef, SelectionSource } from "../shared/selection";
import { CircleSelectionOverlay, SpatialSelectionTools } from "./SpatialSelection";
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
  onSelect?: (id: string) => void;
  compact?: boolean;
  dimensions?: boolean;
  reset?: number;
  framingKey?: string;
  camera?: { position: Vec3; target: Vec3 };
  onCamera?: (camera: { position: Vec3; target: Vec3 }) => void;
  ariaLabel?: string;
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
function PartMesh({
  part,
  parts,
  playing,
  speed = 1,
  selected,
  selectedPartIds,
  onSelect,
  compact,
  activePartIds,
  animation,
}: Props & { part: Part; animation: React.MutableRefObject<AssemblyFrame> }) {
  const ref = useRef<THREE.Mesh>(null);
  const rot = part.rotation || [0, 0, 0];
  const isSelected = selected === part.id || !!selectedPartIds?.includes(part.id);
  const metal = /steel|alumin|metal/i.test(part.material),
    reference = part.role === "reference",
    ghost =
      !!activePartIds &&
      !activePartIds.includes(part.id) &&
      !isSelected,
    referencePreview = reference && !!onSelect;
  const materialColor = useMemo(() => {
    const c = new THREE.Color(part.color);
    return metal ? c.multiplyScalar(0.82) : c;
  }, [part.color, metal]);
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
          e.stopPropagation();
          onSelect(part.id);
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
      {part.channel ||
      part.sections ||
      part.holes?.length ||
      part.shape === "tube" ? (
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
      <meshStandardMaterial
        color={materialColor}
        metalness={metal ? 0.82 : 0.02}
        roughness={metal ? 0.38 : 0.78}
        emissive={
          isSelected
            ? colors.focus
            : part.id === "led"
              ? part.color
              : colors.text
        }
        emissiveIntensity={
          isSelected ? 0.1 : part.id === "led" ? 0.25 : 0
        }
        transparent={
          ghost || referencePreview || /water|glass/i.test(part.material)
        }
        depthWrite={!ghost && !referencePreview}
        opacity={
          ghost
            ? 0.18
            : referencePreview
              ? 0.34
              : /water|glass/i.test(part.material)
                ? 0.58
                : 1
        }
      />
      {(!reference || referencePreview || isSelected) && (
        <Edges
          threshold={24}
          color={
            isSelected
              ? colors.focus
              : referencePreview
                ? part.color
                : colors.text
          }
          transparent
          opacity={
            isSelected
              ? 1
              : ghost
                ? 0.07
                : referencePreview
                  ? 0.45
                  : 0.38
          }
        />
      )}
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
function StudioLight() {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const map = pmrem.fromScene(room, 0.04);
    scene.environment = map.texture;
    scene.environmentIntensity = 0.7;
    room.dispose();
    pmrem.dispose();
    invalidate();
    return () => {
      scene.environment = null;
      map.dispose();
    };
  }, [gl, scene, invalidate]);
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
      aspect = size.width / size.height;
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
          v.dot(dir) + Math.abs(v.dot(right)) / (tan * aspect * 0.83),
          v.dot(dir) + Math.abs(v.dot(up)) / (tan * 0.83),
        );
      }
    }
    const destination = center.clone().addScaledVector(dir, distance * 1.08);
    if (isExplosionChange && !reduced && ref.current) {
      cameraTween.current = { from: camera.position.clone(), to: destination,
        fromTarget: ref.current.target.clone(), toTarget: center.clone(), elapsed: 0, last: performance.now() };
    } else {
      cameraTween.current = null;
      camera.position.copy(destination);
      camera.lookAt(center);
      if (ref.current) { ref.current.target.copy(center); ref.current.update(); }
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
  const [circleMode, setCircleMode] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [selectionMessage, setSelectionMessage] = useState("");
  const picker = useRef<PolygonPicker>(null);
  const animation = useRef<AssemblyFrame>({ progress: props.exploded ? 1 : 0, seconds: 0, poses: new Map() });
  const canSelect = !!(props.onSelect || props.onSelection);
  const choose = (ids: string[], source: SelectionSource) => {
    const existing = [...new Set(ids)].filter(id => props.parts.some(part => part.id === id));
    if (!existing.length) return;
    if (existing.length > 1 && (!props.onSelection || !props.selectionContext)) {
      setSelectionMessage("Choose one of the circled parts before continuing."); return;
    }
    setCircleMode(false); setCandidates([]);
    setSelectionMessage(existing.length === 1 ? `${props.parts.find(part => part.id === existing[0])!.name} selected.` : `${existing.length} parts selected.`);
    props.onSelect?.(existing[0]);
    if (props.selectionContext) props.onSelection?.({ ...props.selectionContext, partIds: existing, source });
  };
  useEffect(() => { setCircleMode(false); setCandidates([]); setSelectionMessage(""); }, [props.selectionContext?.designId, props.selectionContext?.revision]);
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
      className={"model-canvas" + (compact ? " compact" : "") + (!compact && canSelect ? " is-selectable" : "")}
      role={failed || canSelect ? "region" : "img"}
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
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          frameloop={playing && !reduced ? "always" : "demand"}
        >
          <AssemblyAnimation parts={props.parts} exploded={!!props.exploded} playing={playing && !circleMode}
            speed={props.speed ?? 1} reduced={reduced} frozen={circleMode} frame={animation} />
          <SelectionBridge picker={picker} />
          <FrameSignal parts={parts} onReady={() => setReady(true)} />
          <color attach="background" args={[colors.surface]} />
          <StudioLight />
          <ambientLight intensity={0.38} />
          <hemisphereLight args={[colors.white, colors.border, 0.65]} />
          <directionalLight
            position={[extent, extent * 2, extent]}
            intensity={1.7}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-camera-left={-extent}
            shadow-camera-right={extent}
            shadow-camera-top={extent}
            shadow-camera-bottom={-extent}
            shadow-bias={-0.0001}
          />
          <directionalLight
            position={[-extent, extent, -extent]}
            intensity={0.7}
          />
          <Suspense fallback={null}>
            {props.parts.map((part) => (
              <PartMesh
                key={part.id}
                {...props}
                parts={props.parts}
                animation={animation}
                playing={playing && !reduced && !circleMode}
                onSelect={canSelect && !circleMode ? id => choose([id], "click") : undefined}
                selectedPartIds={candidates.length ? candidates : props.selectedPartIds}
                part={part}
              />
            ))}
            {!compact && (
              <ContactShadows
                position={[center[0], box.min.y - 1, center[2]]}
                scale={extent * 4}
                far={extent * 0.22}
                opacity={0.24}
                blur={1.6}
                resolution={512}
                frames={1}
              />
            )}
            {dimensions && (
              <Html
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
            const ids = picker.current?.(points) || [];
            setCircleMode(false); setCandidates(ids.length > 1 ? ids : []);
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
        circleMode={circleMode} onCircleMode={enabled => { setCircleMode(enabled); setCandidates([]); setSelectionMessage(""); }}
        circleAvailable={ready && !failed} candidates={candidates} onChoose={choose} onDismiss={() => { setCandidates([]); setSelectionMessage(""); }} message={selectionMessage}
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
