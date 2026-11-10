import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Edges } from "@react-three/drei";
import * as THREE from "three";
import { featuredGeometry, hasCreases, needsFeaturedGeometry } from "../lib/partGeometry";
import { bladeGeometry, boxProjectUv, discTexture, finishFor, finishMaterial, isCarbonFibre, twillTexture } from "../lib/droneLook";
import { StageEnvironment, StageGround, StageLights } from "./StudioStage";
import { colors } from "../lib/tokens";
import type { Part, Vec3 } from "../shared/types";

// A studio-lit stage for the drone, shared by the home page hero, the walkthrough and the phone frame.
// It renders the real starter parts with finishes that match their declared materials.
// `still` draws one settled pose and stops, for captures and reduced motion.

type Kind = "carbon" | "motor" | "prop" | "alu" | "pcb" | "battery" | "camera" | "tpu" | "other";
function kindOf(part: Part): Kind {
  const m = part.material || "";
  if (/^prop-/.test(part.id)) return "prop";
  if (isCarbonFibre(m)) return "carbon";
  if (/^motor-mount/.test(part.id)) return "tpu";
  if (/^motor-/.test(part.id)) return "motor";
  if (/^prop-/.test(part.id)) return "prop";
  if (/alumin/i.test(m)) return "alu";
  if (/circuit/i.test(m)) return "pcb";
  if (part.id === "battery") return "battery";
  if (part.id === "camera") return "camera";
  if (/tpu/i.test(m)) return "tpu";
  return "other";
}

// Finishes come from the shared render kit, so the studio and this stage agree.
function materialFor(part: Part, twill: THREE.Texture): THREE.MeshPhysicalMaterial {
  return finishMaterial(finishFor(part), twill);
}

const copper = new THREE.MeshStandardMaterial({ color: "#b8733f", metalness: 0.95, roughness: 0.3 });
const band = new THREE.MeshStandardMaterial({ color: colors.primary, metalness: 0.1, roughness: 0.4 });
const strap = new THREE.MeshStandardMaterial({ color: "#0c0e11", metalness: 0, roughness: 0.8 });
const lens = new THREE.MeshPhysicalMaterial({ color: "#0b1626", metalness: 0.2, roughness: 0.05, clearcoat: 1 });

function geometryFor(part: Part) {
  if (kindOf(part) === "prop") return bladeGeometry(part.size[0], part.size[2]);
  const geometry = needsFeaturedGeometry(part) ? featuredGeometry(part, false)
    : part.shape === "box" ? new THREE.BoxGeometry(...part.size) : new THREE.CylinderGeometry(part.size[0] / 2, part.size[0] / 2, part.size[1], 48);
  // Millimetre texture coordinates, so the weave has the same scale on every carbon part.
  return kindOf(part) === "carbon" ? boxProjectUv(geometry) : geometry;
}

type Hover = (part: Part | null, x?: number, y?: number) => void;

function PartMesh({ part, twill, disc, still, highlighted, dimmed, offset, onHover }: {
  part: Part; twill: THREE.Texture; disc: THREE.Texture; still: boolean; highlighted: boolean; dimmed: boolean; offset: React.MutableRefObject<number>; onHover?: Hover;
}) {
  const geometry = useMemo(() => geometryFor(part), [part]);
  const material = useMemo(() => materialFor(part, twill), [part, twill]);
  const blurMaterial = useMemo(() => new THREE.MeshBasicMaterial({ map: disc, transparent: true, depthWrite: false, side: THREE.DoubleSide }), [disc]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); blurMaterial.dispose(); }, [geometry, material, blurMaterial]);
  useEffect(() => {
    material.emissive.set(highlighted ? colors.primary : "#000000");
    material.emissiveIntensity = highlighted ? 0.18 : 0;
    const prop = kindOf(part) === "prop";
    material.transparent = dimmed || prop; material.opacity = dimmed ? 0.14 : prop ? 0.88 : 1; material.depthWrite = !dimmed;
    material.needsUpdate = true;
  }, [material, highlighted, dimmed, part]);
  const holder = useRef<THREE.Group>(null), spin = useRef<THREE.Group>(null);
  const home = part.position, dir = useMemo(() => { const v = new THREE.Vector3(home[0], home[1] - 45, home[2]); return v.lengthSq() ? v.normalize() : v; }, [home]);
  useFrame((_, delta) => {
    const k = offset.current * 70;
    holder.current?.position.set(home[0] + dir.x * k, home[1] + dir.y * k * 1.6, home[2] + dir.z * k);
    if (!still && spin.current) spin.current.rotation.y += delta * 30;
  });
  const rot = part.rotation || [0, 0, 0];
  const events = onHover ? {
    onPointerOver: (e: any) => { e.stopPropagation(); onHover(part, e.nativeEvent.offsetX, e.nativeEvent.offsetY); },
    onPointerMove: (e: any) => { e.stopPropagation(); onHover(part, e.nativeEvent.offsetX, e.nativeEvent.offsetY); },
    onPointerOut: () => onHover(null),
  } : {};
  if (kindOf(part) === "prop") {
    return <group ref={holder} position={home}>
      {still
        ? <group rotation={[rot[0], rot[1], rot[2]]}><mesh geometry={geometry} material={material} castShadow {...events}/></group>
        : <group ref={spin}><mesh rotation={[-Math.PI / 2, 0, 0]} material={blurMaterial} {...events}><circleGeometry args={[part.size[0] / 2, 72]}/></mesh></group>}
    </group>;
  }
  return <group ref={holder} position={home} rotation={[rot[0], rot[1], rot[2]]}>
    <mesh geometry={geometry} material={material} castShadow receiveShadow {...events}>
      {highlighted && hasCreases(part) && <Edges threshold={20} color={colors.primary} lineWidth={2}/>}
    </mesh>
    {kindOf(part) === "motor" && !dimmed && <mesh position={[0, -part.size[1] / 2 + 3, 0]} material={copper}><cylinderGeometry args={[part.size[0] / 2 - 1.2, part.size[0] / 2 - 1.2, 4, 48]}/></mesh>}
    {kindOf(part) === "battery" && !part.edgeRadius && !dimmed && <>
      <mesh position={[part.size[0] * 0.28, 0, 0]} material={band}><boxGeometry args={[4, part.size[1] + 0.4, part.size[2] + 0.4]}/></mesh>
      <mesh material={strap}><boxGeometry args={[14, part.size[1] + 1.6, part.size[2] + 1.6]}/></mesh>
    </>}
    {kindOf(part) === "camera" && part.shape === "box" && !dimmed && <mesh position={[part.size[0] / 2 + 1.5, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={lens}><cylinderGeometry args={[6.5, 7.5, 4, 40]}/></mesh>}
  </group>;
}

function Drone({ parts, still, exploded, highlight, dimOthers, idle, onHover, onReady, assistant, agentEl }: {
  parts: Part[]; still: boolean; exploded: boolean; highlight: string[]; dimOthers: boolean; idle: boolean; onHover?: Hover; onReady: () => void; assistant?: { partId: string; label: string };
  agentEl?: React.RefObject<HTMLSpanElement | null>;
}) {
  const pointed = assistant ? parts.find(p => p.id === assistant.partId) : undefined;
  const { camera, size } = useThree();
  const probe = useMemo(() => new THREE.Vector3(), []);
  const twill = useMemo(twillTexture, []), disc = useMemo(discTexture, []);
  useEffect(() => () => { twill.dispose(); disc.dispose(); }, [twill, disc]);
  const group = useRef<THREE.Group>(null);
  const offset = useRef(exploded ? 1 : 0), frames = useRef(0);
  const { invalidate } = useThree();
  useEffect(() => { if (!still) return; let n = 0; const id = setInterval(() => { invalidate(); if (++n > 8) clearInterval(id); }, 60); return () => clearInterval(id); }, [still, invalidate, exploded, highlight.join(), dimOthers]);
  useFrame(({ clock }, delta) => {
    if (frames.current++ === 1) onReady();
    const target = exploded ? 1 : 0;
    offset.current = still ? target : THREE.MathUtils.damp(offset.current, target, 4, delta);
    const g = group.current; if (!g) return;
    if (still || !idle) { g.rotation.y = -0.55; g.position.y = 0; }
    else {
      const t = clock.getElapsedTime();
      g.rotation.y = -0.55 + Math.sin(t * 0.22) * 0.5;
      g.position.y = Math.sin(t * 1.1) * 4;
    }
    // Keep the assistant's marker on the arm it points at, in screen space.
    const el = agentEl?.current;
    if (pointed && el) {
      g.updateMatrixWorld();
      probe.set(pointed.position[0], pointed.position[1] - 30 + 4, pointed.position[2]);
      g.localToWorld(probe); probe.project(camera);
      el.style.transform = `translate(${((probe.x + 1) / 2) * size.width}px, ${((1 - probe.y) / 2) * size.height}px)`;
    }
  });
  return <group ref={group}>
    <group position={[0, -30, 0]}>{parts.map(part => <PartMesh key={part.id} part={part} twill={twill} disc={disc} still={still}
      highlighted={highlight.includes(part.id)} dimmed={dimOthers && highlight.length > 0 && !highlight.includes(part.id)} offset={offset} onHover={onHover}/>)}
</group>
  </group>;
}

// Without WebGL, or if the 3D view fails, show the still render of the same scene instead.
function webglAvailable() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}
class StageBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
function StillFallback({ className }: { className: string }) {
  return <div className={"hero-drone is-image " + className}><img src="/previews/drone.png" alt="Camera drone, 3D model" width="650" height="445"/></div>;
}

// On narrow stages the camera steps back so the whole drone stays in frame.
function FitWidth({ camera: base, target }: { camera: Vec3; target: Vec3 }) {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    const factor = Math.max(1, 1.8 / Math.max(0.5, size.width / Math.max(1, size.height)));
    camera.position.set(base[0] * factor, base[1] * factor, base[2] * factor);
    camera.lookAt(...target);
    invalidate();
  }, [camera, size.width, size.height, base[0], base[1], base[2], target[0], target[1], target[2], invalidate]);
  return null;
}

export function DroneStage({ parts, still, exploded = false, highlight = [], dimOthers = false, idle = true, camera = [215, 150, 255], target = [0, -14, 0], floor = false, hoverLabels = false, className = "", assistant, fitWidth = false }: {
  parts: Part[]; still: boolean; exploded?: boolean; highlight?: string[]; dimOthers?: boolean; idle?: boolean; camera?: Vec3; target?: Vec3; floor?: boolean; hoverLabels?: boolean; className?: string; assistant?: { partId: string; label: string }; fitWidth?: boolean;
}) {
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false), [visible, setVisible] = useState(true);
  // Every stage, including the phone frame, holds one settled pose when motion is reduced.
  const [reduced, setReduced] = useState(() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const q = matchMedia("(prefers-reduced-motion: reduce)"), on = () => setReduced(q.matches);
    q.addEventListener("change", on); return () => q.removeEventListener("change", on);
  }, []);
  still = still || reduced;
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.05 });
    io.observe(host.current); return () => io.disconnect();
  }, []);
  const live = !still && visible;
  const agentEl = useRef<HTMLSpanElement>(null);
  const [canRender] = useState(webglAvailable);
  if (!canRender) return <StillFallback className={className}/>;
  return <StageBoundary fallback={<StillFallback className={className}/>}><div ref={host} className={"hero-drone " + className} data-ready={ready} data-still={still}>
    <Canvas shadows dpr={[1, 1.75]} gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.08 }}
      camera={{ position: camera, fov: 30, near: 10, far: 4000 }}
      frameloop={live ? "always" : "demand"}
      onCreated={({ camera: c }) => c.lookAt(...target)}
      onPointerMissed={() => setHover(null)}>
      <StageEnvironment intensity={0.7}/>
      {fitWidth && <FitWidth camera={camera} target={target}/>}
      <StageLights extent={240}/>
      <Drone parts={parts} still={still} exploded={exploded} highlight={highlight} dimOthers={dimOthers} idle={idle} assistant={assistant} agentEl={agentEl} onReady={() => setReady(true)}
        onHover={hoverLabels ? (part, x, y) => setHover(part ? { name: part.name, x: x ?? 0, y: y ?? 0 } : null) : undefined}/>
      <StageGround y={-30} radius={floor ? 300 : 260} live={live} opacity={0.7}/>
    </Canvas>
    {assistant && <span ref={agentEl} className="hero-agent-anchor" aria-hidden="true"><span className={"hero-agent" + (still ? " is-still" : "")}><i/><b>{assistant.label}</b></span></span>}
    {hover && <span className="hero-drone-label" style={{ left: hover.x, top: hover.y }} aria-hidden="true"><i/>Pointing at: {hover.name}</span>}
  </div></StageBoundary>;
}

export default function HeroDrone({ parts, still }: { parts: Part[]; still: boolean }) {
  return <DroneStage parts={parts} still={still} hoverLabels fitWidth assistant={{ partId: "arm-front-left", label: "Arm, front left" }}/>;
}
