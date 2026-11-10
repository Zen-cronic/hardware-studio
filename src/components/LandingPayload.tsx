import { RoundedBox } from '@react-three/drei';
import { KIT } from '../lib/droneLook';

/** Presentation prop fitted inside the design's reference-load envelope. */
export default function LandingPayload({ size }: { size: [number, number, number] }) {
  return <group scale={size}>
    <RoundedBox args={[.94, .66, .4]} radius={.055} smoothness={4} position={[0, -.06, -.16]} castShadow receiveShadow>
      <meshPhysicalMaterial color={KIT.graphite} roughness={.5} metalness={.2} clearcoat={.25} clearcoatRoughness={.4}/>
    </RoundedBox>
    <RoundedBox args={[.94, .12, .4]} radius={.035} smoothness={4} position={[0, .24, -.16]} castShadow>
      <meshPhysicalMaterial color={KIT.aluminium} roughness={.3} metalness={.88}/>
    </RoundedBox>
    <RoundedBox args={[.22, .5, .13]} radius={.055} smoothness={4} position={[-.34, -.055, .04]} castShadow>
      <meshStandardMaterial color={KIT.satinBlack} roughness={.8}/>
    </RoundedBox>
    <RoundedBox args={[.27, .12, .25]} radius={.025} smoothness={3} position={[.03, .35, -.17]} castShadow>
      <meshPhysicalMaterial color={KIT.aluminium} metalness={.88} roughness={.3}/>
    </RoundedBox>
    <mesh position={[-.32, .315, -.15]} castShadow><cylinderGeometry args={[.06, .065, .03, 32]}/><meshPhysicalMaterial color={KIT.satinBlack} metalness={.6} roughness={.35}/></mesh>
    <mesh position={[.3, .32, -.16]} castShadow><cylinderGeometry args={[.08, .08, .04, 32]}/><meshStandardMaterial color={KIT.aluminium} metalness={.85} roughness={.32}/></mesh>
    <group position={[.07, -.035, 0]}>
      <mesh rotation={[Math.PI/2,0,0]} position={[0,0,.085]} castShadow><cylinderGeometry args={[.258,.258,.09,64]}/><meshPhysicalMaterial color={KIT.aluminium} metalness={.9} roughness={.28}/></mesh>
      <mesh rotation={[Math.PI/2,0,0]} position={[0,0,.19]} castShadow><cylinderGeometry args={[.225,.225,.17,64]}/><meshStandardMaterial color={KIT.satinBlack} metalness={.2} roughness={.7}/></mesh>
      <mesh rotation={[Math.PI/2,0,0]} position={[0,0,.31]} castShadow><cylinderGeometry args={[.202,.212,.12,64]}/><meshPhysicalMaterial color={KIT.graphite} metalness={.6} roughness={.3}/></mesh>
      <mesh position={[0,0,.375]}><torusGeometry args={[.18,.023,12,64]}/><meshPhysicalMaterial color={KIT.satinBlack} metalness={.8} roughness={.25}/></mesh>
      <mesh position={[0,0,.38]}><circleGeometry args={[.16,64]}/><meshPhysicalMaterial color={KIT.glass} metalness={.2} roughness={.04} clearcoat={1} clearcoatRoughness={.02}/></mesh>
      <mesh position={[0,0,.384]}><torusGeometry args={[.098,.008,8,48]}/><meshPhysicalMaterial color={KIT.aluminium} metalness={.9} roughness={.15}/></mesh>
      {Array.from({length:28},(_,i)=>{
        const a=i*Math.PI/14;
        return <mesh key={i} position={[Math.cos(a)*.226,Math.sin(a)*.226,.19]} rotation={[0,0,a]}>
          <boxGeometry args={[.012,.012,.12]}/><meshStandardMaterial color={KIT.satinBlack} metalness={.3} roughness={.6}/>
        </mesh>;
      })}
    </group>
    {[[-.405,.17],[.405,.17],[-.405,-.28],[.405,-.28]].map(([x,y])=><mesh key={`${x}-${y}`} position={[x,y,.045]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.015,.015,.008,12]}/><meshStandardMaterial color={KIT.aluminium} metalness={.9} roughness={.3}/></mesh>)}
    <mesh position={[0,-.42,-.16]} castShadow><boxGeometry args={[.32,.06,.24]}/><meshStandardMaterial color={KIT.satinBlack} roughness={.8}/></mesh>
  </group>;
}
