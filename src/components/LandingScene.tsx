import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Edges, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Part } from "../shared/types";
import { featuredGeometry } from "../lib/partGeometry";
import { motionPose } from "../lib/motion";
import { colors } from "../lib/tokens";

type Props = { parts: Part[]; playing: boolean; separated: boolean; reduced: boolean; onReady?: () => void };
class PreviewBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() {
    return this.state.failed ? <div className="landing-fallback" role="status">
      <svg viewBox="0 0 240 240" aria-hidden="true"><ellipse cx="120" cy="50" rx="92" ry="29"/><path d="M28 50v16c0 39 184 39 184 0V50M120 94v55M71 132v57M169 132v57"/><ellipse cx="120" cy="190" rx="79" ry="25"/><path d="M41 190v16c0 34 158 34 158 0v-16"/></svg>
      <strong>Explore how the parts fit.</strong><p>The 3D preview is unavailable. Open the design to inspect dimensions and parts.</p>
    </div> : this.props.children;
  }
}
function Scene({ parts, playing, separated, reduced, onReady }: Props) {
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const elapsed = useRef(0), amount = useRef(separated ? 1 : 0), tick = useRef(0);
  const lastSeparated = useRef(separated);
  const { camera, size, gl, scene, invalidate } = useThree();
  const geometries = useMemo(() => parts.map(p => featuredGeometry(p, false)), [parts]);
  const offsets = useMemo(() => parts.map(p => {
    const y = p.position[1];
    // Keep the real support frame intact while exposing the rotating stack.
    const lift = y > 175 ? 70 : y > 130 ? 42 : y > 70 ? 18 : 0;
    return new THREE.Vector3(p.position[0] * .12, lift, p.position[2] * .12);
  }), [parts]);
  useEffect(() => () => geometries.forEach(g => g.dispose()), [geometries]);
  useEffect(() => {
    camera.position.set(440, 275, 530);
    camera.lookAt(0, 130, 0);
    (camera as THREE.OrthographicCamera).zoom = Math.min(size.width / 320, size.height / 330);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, invalidate]);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl), room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, .04);
    scene.environment = environment.texture;
    scene.environmentIntensity = .75;
    room.dispose(); pmrem.dispose(); invalidate();
    return () => { scene.environment = null; environment.dispose(); };
  }, [gl, scene, invalidate]);
  useEffect(() => {
    if (reduced || (!playing && lastSeparated.current !== separated)) amount.current = separated ? 1 : 0;
    lastSeparated.current = separated;
    invalidate();
  }, [separated, playing, reduced, invalidate]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, .05);
    if (playing && !reduced) {
      elapsed.current += dt;
      amount.current = THREE.MathUtils.damp(amount.current, separated ? 1 : 0, 3.4, dt);
    }
    parts.forEach((p, i) => {
      const mesh = meshes.current[i]; if (!mesh) return;
      const pose = motionPose(p, parts, elapsed.current);
      mesh.position.set(...pose.position).addScaledVector(offsets[i], amount.current);
      mesh.rotation.set(...pose.rotation);
    });
    gl.domElement.dataset.assemblyAmount = amount.current.toFixed(3);
    if (++tick.current === 2) onReady?.();
    if (tick.current < 2) invalidate();
  });
  return <>
    <color attach="background" args={[colors.surface]} />
    <ambientLight intensity={.18} />
    <hemisphereLight args={[colors.white, colors.border, .35]} />
    <directionalLight position={[180, 450, 260]} intensity={2.5} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-250} shadow-camera-right={250} shadow-camera-top={400} shadow-camera-bottom={-250} shadow-bias={-.0001} shadow-camera-near={.5} shadow-camera-far={1500} />
    <directionalLight position={[-300, 160, -100]} intensity={.65} />
    {parts.map((p, i) => <mesh castShadow receiveShadow key={p.id} ref={m => { meshes.current[i] = m; }} position={p.position} rotation={p.rotation} geometry={geometries[i]}>
      <meshStandardMaterial color={new THREE.Color(p.color).multiplyScalar(/steel|alumin|metal/i.test(p.material) ? .68 : .9)} metalness={/steel|alumin|metal/i.test(p.material) ? .9 : .05} roughness={/steel|alumin|metal/i.test(p.material) ? .3 : .58} />
      <Edges threshold={28} color={colors.text} transparent opacity={.13} />
    </mesh>)}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -8, 0]} receiveShadow><planeGeometry args={[1200, 1200]}/><shadowMaterial color={colors.text} transparent opacity={.16}/></mesh>
    <ContactShadows position={[0, -7.9, 0]} scale={500} opacity={.35} blur={2.2} far={300} resolution={256} frames={1} />
    <OrbitControls target={[0, 130, 0]} enableZoom={false} enablePan={false} enableDamping={false} minPolarAngle={.35} maxPolarAngle={Math.PI * .48} />
  </>;
}
export default function LandingScene(props: Props) {
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  return <div className="landing-scene" data-testid="landing-scene" data-motion={props.playing && !props.reduced ? "playing" : "paused"} data-assembly={props.separated ? "separated" : "assembled"} data-ready={ready} aria-label={failed ? "3D preview unavailable" : "Interactive motorized turntable. Drag to rotate the view."} role={failed ? "region" : "img"}>
    <PreviewBoundary onFailure={() => setFailed(true)}><Canvas style={{position: "absolute", inset: 0}} shadows orthographic dpr={[1, 1.5]} camera={{near: .1, far: 3000}} gl={{antialias: true, preserveDrawingBuffer: true}} frameloop={props.playing && !props.reduced ? "always" : "demand"}>
      <Scene {...props} onReady={() => setReady(true)} />
    </Canvas></PreviewBoundary>
    {!ready && !failed && <span className="landing-loading">Preparing the 3D design…</span>}
  </div>;
}
