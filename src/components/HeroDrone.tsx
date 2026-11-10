import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { featuredGeometry } from "../lib/partGeometry";
import { colors } from "../lib/tokens";
import type { Part, Vec3 } from "../shared/types";

// A studio-lit stage for the drone, shared by the home page hero, the walkthrough and the phone frame.
// It renders the real starter parts with finishes that match their declared materials.
// `still` draws one settled pose and stops, for captures and reduced motion.

function twillTexture() {
  const size = 128, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1b1f25"; ctx.fillRect(0, 0, size, size);
  // 2x2 twill: diagonal bands of alternating tows catch the light differently.
  const tow = 8;
  for (let y = 0; y < size; y += tow) for (let x = 0; x < size; x += tow) {
    const phase = ((x / tow) + (y / tow)) % 4 < 2;
    const g = ctx.createLinearGradient(x, y, x + (phase ? tow : 0), y + (phase ? 0 : tow));
    g.addColorStop(0, phase ? "#343c47" : "#171b20"); g.addColorStop(.5, phase ? "#2a313a" : "#1f242b"); g.addColorStop(1, phase ? "#3b444f" : "#15181d");
    ctx.fillStyle = g; ctx.fillRect(x, y, tow, tow);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function discTexture() {
  const size = 256, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.06, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(200,220,245,0.05)"); g.addColorStop(0.55, "rgba(200,220,245,0.22)");
  g.addColorStop(0.9, "rgba(200,220,245,0.30)"); g.addColorStop(1, "rgba(200,220,245,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A two-blade propeller with taper and twist, sized from the declared part's diameter.
function bladeGeometry(diameter: number, chord: number) {
  const g = new THREE.BoxGeometry(diameter, 1.4, chord, 32, 1, 2);
  const p = g.attributes.position, R = diameter / 2;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), r = Math.abs(x) / R;
    const width = THREE.MathUtils.lerp(1, 0.45, r) * (r > 0.92 ? Math.sqrt(Math.max(0, 1 - (r - 0.92) / 0.08)) * 0.9 + 0.1 : 1);
    const twist = THREE.MathUtils.lerp(0.42, 0.12, r) * Math.sign(x || 1);
    const z = p.getZ(i) * width, y = p.getY(i);
    p.setXYZ(i, x, y * Math.cos(twist) - z * Math.sin(twist), y * Math.sin(twist) + z * Math.cos(twist));
  }
  g.computeVertexNormals();
  return g;
}

function StudioEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const map = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = map.texture; scene.environmentIntensity = 0.6;
    pmrem.dispose();
    return () => { scene.environment = null; map.dispose(); };
  }, [gl, scene]);
  return null;
}

type Kind = "carbon" | "motor" | "prop" | "alu" | "pcb" | "battery" | "camera" | "tpu" | "other";
function kindOf(part: Part): Kind {
  const m = part.material || "";
  if (/^prop-/.test(part.id)) return "prop";
  if (/carbon fib/i.test(m)) return "carbon";
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

function materialFor(part: Part, twill: THREE.Texture): THREE.MeshPhysicalMaterial {
  const k = kindOf(part);
  if (k === "carbon") {
    const map = twill.clone(); map.needsUpdate = true;
    map.repeat.set(Math.max(1, part.size[0] / 14), Math.max(1, part.size[2] / 14));
    return new THREE.MeshPhysicalMaterial({ color: "#ffffff", map, roughnessMap: map, metalness: 0.25, roughness: 0.5, clearcoat: 0.8, clearcoatRoughness: 0.18 });
  }
  const spec: Record<Exclude<Kind, "carbon">, THREE.MeshPhysicalMaterialParameters> = {
    motor: { color: "#15181d", metalness: 0.75, roughness: 0.3 },
    prop: { color: "#2b3542", metalness: 0.1, roughness: 0.22, clearcoat: 1, transparent: true, opacity: 0.88 },
    alu: { color: "#b9c3ce", metalness: 0.92, roughness: 0.26 },
    pcb: { color: "#22513b", metalness: 0.2, roughness: 0.5 },
    battery: { color: "#202429", metalness: 0.1, roughness: 0.6 },
    camera: { color: "#111317", metalness: 0.45, roughness: 0.28 },
    tpu: { color: "#1a1d22", metalness: 0.05, roughness: 0.62 },
    other: { color: part.color, metalness: 0.1, roughness: 0.5 },
  };
  return new THREE.MeshPhysicalMaterial(spec[k]);
}

const copper = new THREE.MeshStandardMaterial({ color: "#b8733f", metalness: 0.95, roughness: 0.3 });
const band = new THREE.MeshStandardMaterial({ color: colors.primary, metalness: 0.1, roughness: 0.4 });
const strap = new THREE.MeshStandardMaterial({ color: "#0c0e11", metalness: 0, roughness: 0.8 });
const lens = new THREE.MeshPhysicalMaterial({ color: "#0b1626", metalness: 0.2, roughness: 0.05, clearcoat: 1 });

function geometryFor(part: Part) {
  if (kindOf(part) === "prop") return bladeGeometry(part.size[0], part.size[2]);
  if (part.holes?.length || part.shape === "tube" || part.channel || part.sections) return featuredGeometry(part, false);
  if (part.shape === "box") return new THREE.BoxGeometry(...part.size);
  return new THREE.CylinderGeometry(part.size[0] / 2, part.size[0] / 2, part.size[1], 48);
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
    material.emissiveIntensity = highlighted ? 0.45 : 0;
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
    <mesh geometry={geometry} material={material} castShadow receiveShadow {...events}/>
    {kindOf(part) === "motor" && !dimmed && <mesh position={[0, -part.size[1] / 2 + 3, 0]} material={copper}><cylinderGeometry args={[part.size[0] / 2 - 1.2, part.size[0] / 2 - 1.2, 4, 48]}/></mesh>}
    {kindOf(part) === "battery" && !dimmed && <>
      <mesh position={[part.size[0] * 0.28, 0, 0]} material={band}><boxGeometry args={[4, part.size[1] + 0.4, part.size[2] + 0.4]}/></mesh>
      <mesh material={strap}><boxGeometry args={[14, part.size[1] + 1.6, part.size[2] + 1.6]}/></mesh>
    </>}
    {kindOf(part) === "camera" && !dimmed && <mesh position={[part.size[0] / 2 + 1.5, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={lens}><cylinderGeometry args={[6.5, 7.5, 4, 40]}/></mesh>}
  </group>;
}

function Drone({ parts, still, exploded, highlight, dimOthers, idle, onHover, onReady }: {
  parts: Part[]; still: boolean; exploded: boolean; highlight: string[]; dimOthers: boolean; idle: boolean; onHover?: Hover; onReady: () => void;
}) {
  const twill = useMemo(twillTexture, []), disc = useMemo(discTexture, []);
  const group = useRef<THREE.Group>(null);
  const offset = useRef(exploded ? 1 : 0), frames = useRef(0);
  const { invalidate } = useThree();
  useEffect(() => { if (!still) return; let n = 0; const id = setInterval(() => { invalidate(); if (++n > 8) clearInterval(id); }, 60); return () => clearInterval(id); }, [still, invalidate, exploded, highlight.join(), dimOthers]);
  useFrame(({ clock }, delta) => {
    if (frames.current++ === 1) onReady();
    const target = exploded ? 1 : 0;
    offset.current = still ? target : THREE.MathUtils.damp(offset.current, target, 4, delta);
    const g = group.current; if (!g) return;
    if (still || !idle) { g.rotation.y = -0.55; g.position.y = 0; return; }
    const t = clock.getElapsedTime();
    g.rotation.y = -0.55 + Math.sin(t * 0.22) * 0.5;
    g.position.y = Math.sin(t * 1.1) * 4;
  });
  return <group ref={group}>
    <group position={[0, -30, 0]}>{parts.map(part => <PartMesh key={part.id} part={part} twill={twill} disc={disc} still={still}
      highlighted={highlight.includes(part.id)} dimmed={dimOthers && highlight.length > 0 && !highlight.includes(part.id)} offset={offset} onHover={onHover}/>)}</group>
  </group>;
}

export function DroneStage({ parts, still, exploded = false, highlight = [], dimOthers = false, idle = true, camera = [215, 150, 255], target = [0, -14, 0], floor = false, hoverLabels = false, className = "" }: {
  parts: Part[]; still: boolean; exploded?: boolean; highlight?: string[]; dimOthers?: boolean; idle?: boolean; camera?: Vec3; target?: Vec3; floor?: boolean; hoverLabels?: boolean; className?: string;
}) {
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false), [visible, setVisible] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.05 });
    io.observe(host.current); return () => io.disconnect();
  }, []);
  const live = !still && visible;
  return <div ref={host} className={"hero-drone " + className} data-ready={ready} data-still={still}>
    <Canvas shadows dpr={[1, 1.75]} gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      camera={{ position: camera, fov: 30, near: 10, far: 4000 }}
      frameloop={live ? "always" : "demand"}
      onCreated={({ camera: c }) => c.lookAt(...target)}
      onPointerMissed={() => setHover(null)}>
      <StudioEnvironment/>
      <ambientLight intensity={0.15}/>
      <directionalLight position={[220, 420, 260]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-260} shadow-camera-right={260} shadow-camera-top={260} shadow-camera-bottom={-260}/>
      <directionalLight position={[-320, 160, -260]} intensity={1.4} color={colors.primary}/>
      <directionalLight position={[300, 60, -200]} intensity={0.5}/>
      <Drone parts={parts} still={still} exploded={exploded} highlight={highlight} dimOthers={dimOthers} idle={idle} onReady={() => setReady(true)}
        onHover={hoverLabels ? (part, x, y) => setHover(part ? { name: part.name, x: x ?? 0, y: y ?? 0 } : null) : undefined}/>
      {floor && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -34.5, 0]} receiveShadow><circleGeometry args={[260, 64]}/><meshStandardMaterial color="#1d2633" roughness={0.9} transparent opacity={0.85}/></mesh>}
      <ContactShadows position={[0, -34, 0]} scale={520} far={120} blur={2.6} opacity={0.6} resolution={512} color="#000000" frames={live ? Infinity : 1}/>
    </Canvas>
    {hover && <span className="hero-drone-label" style={{ left: hover.x, top: hover.y }} aria-hidden="true"><i/>Pointing at: {hover.name}</span>}
  </div>;
}

export default function HeroDrone({ parts, still }: { parts: Part[]; still: boolean }) {
  return <DroneStage parts={parts} still={still} hoverLabels/>;
}
