import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { groundTexture } from "../lib/droneLook";
import { colors } from "../lib/tokens";

// The shared stage every product render stands on: soft studio light from a room
// environment, a key light that casts the shadow, a cool rim to lift dark edges off the
// navy page, and a ground with a contact shadow so the model sits on something.

export function StageEnvironment({ intensity = 0.62 }: { intensity?: number }) {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl), room = new RoomEnvironment();
    const map = pmrem.fromScene(room, 0.04);
    scene.environment = map.texture; scene.environmentIntensity = intensity;
    room.dispose(); pmrem.dispose(); invalidate();
    return () => { scene.environment = null; map.dispose(); };
  }, [gl, scene, intensity, invalidate]);
  return null;
}

/** Key, fill and rim lights scaled to the model; `extent` is roughly its largest size in mm. */
export function StageLights({ extent, shadows = true }: { extent: number; shadows?: boolean }) {
  const e = Math.max(40, extent);
  return <>
    <hemisphereLight args={[colors.white, colors.background, 0.3]} />
    <directionalLight position={[e * 0.9, e * 1.9, e * 1.1]} intensity={1.9} castShadow={shadows}
      shadow-mapSize={[1024, 1024]} shadow-bias={-0.0002} shadow-normalBias={0.4}
      shadow-camera-left={-e} shadow-camera-right={e} shadow-camera-top={e} shadow-camera-bottom={-e} shadow-camera-near={1} shadow-camera-far={e * 6} />
    <directionalLight position={[-e * 1.2, e * 0.7, e * 0.4]} intensity={0.55} />
    <directionalLight position={[-e * 0.6, e * 0.6, -e * 1.5]} intensity={1.4} color={colors.primary} />
  </>;
}

/** A soft ground disc with a fading grid and a contact shadow, `y` at the model's underside. */
export function StageGround({ y, radius, center = [0, 0], live = false, opacity = 0.62 }: { y: number; radius: number; center?: [number, number]; live?: boolean; opacity?: number }) {
  const texture = useMemo(() => groundTexture(colors.surfaceHover, colors.border, 14), []);
  useEffect(() => () => texture.dispose(), [texture]);
  return <group position={[center[0], y, center[1]]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]} raycast={() => null} renderOrder={-1}>
      <planeGeometry args={[radius * 2, radius * 2]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} dithering />
    </mesh>
    <ContactShadows position={[0, -0.3, 0]} scale={radius * 1.4} far={radius * 0.35} blur={2.4} opacity={opacity} resolution={512} color="#000000" frames={live ? Infinity : 1} />
  </group>;
}
