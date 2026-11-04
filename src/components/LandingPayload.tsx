import { RoundedBox } from '@react-three/drei';
import { colors } from '../lib/tokens';

/** Presentation prop fitted inside the design's reference-load envelope. */
export default function LandingPayload({ size }: { size: [number, number, number] }) {
  return <group scale={size}>
    <RoundedBox args={[.94, .66, .4]} radius={.055} smoothness={4} position={[0, -.06, -.16]} castShadow receiveShadow>
      <meshPhysicalMaterial color={colors.text} roughness={.62} metalness={.18} clearcoat={.15}/>
    </RoundedBox>
    <RoundedBox args={[.94, .12, .4]} radius={.035} smoothness={4} position={[0, .24, -.16]} castShadow>
      <meshPhysicalMaterial color={colors.action} roughness={.27} metalness={.72}/>
    </RoundedBox>
    <RoundedBox args={[.22, .5, .13]} radius={.055} smoothness={4} position={[-.34, -.055, .04]} castShadow>
      <meshStandardMaterial color={colors.text} roughness={.88}/>
    </RoundedBox>
    <RoundedBox args={[.27, .12, .25]} radius={.025} smoothness={3} position={[.03, .35, -.17]} castShadow>
      <meshPhysicalMaterial color={colors.action} metalness={.7} roughness={.25}/>
    </RoundedBox>
    <mesh position={[-.32, .315, -.15]} castShadow><cylinderGeometry args={[.06, .065, .03, 32]}/><meshPhysicalMaterial color={colors.panel} metalness={.9} roughness={.23}/></mesh>
    <mesh position={[.3, .32, -.16]} castShadow><cylinderGeometry args={[.08, .08, .04, 32]}/><meshStandardMaterial color={colors.text} metalness={.6} roughness={.38}/></mesh>
    <group position={[.07, -.035, 0]}>
      <mesh rotation={[Math.PI/2,0,0]} position={[0,0,.085]} castShadow><cylinderGeometry args={[.258,.258,.09,64]}/><meshPhysicalMaterial color={colors.border} metalness={.96} roughness={.22}/></mesh>
      <mesh rotation={[Math.PI/2,0,0]} position={[0,0,.19]} castShadow><cylinderGeometry args={[.225,.225,.17,64]}/><meshStandardMaterial color={colors.text} metalness={.5} roughness={.5}/></mesh>
      <mesh rotation={[Math.PI/2,0,0]} position={[0,0,.31]} castShadow><cylinderGeometry args={[.202,.212,.12,64]}/><meshPhysicalMaterial color={colors.action} metalness={.75} roughness={.28}/></mesh>
      <mesh position={[0,0,.375]}><torusGeometry args={[.18,.023,12,64]}/><meshPhysicalMaterial color={colors.panel} metalness={.95} roughness={.18}/></mesh>
      <mesh position={[0,0,.38]}><circleGeometry args={[.16,64]}/><meshPhysicalMaterial color={colors.text} metalness={.9} roughness={.045} clearcoat={1} clearcoatRoughness={.04}/></mesh>
      <mesh position={[0,0,.384]}><torusGeometry args={[.098,.008,8,48]}/><meshPhysicalMaterial color={colors.action} metalness={.9} roughness={.1}/></mesh>
      {Array.from({length:28},(_,i)=>{
        const a=i*Math.PI/14;
        return <mesh key={i} position={[Math.cos(a)*.226,Math.sin(a)*.226,.19]} rotation={[0,0,a]}>
          <boxGeometry args={[.012,.012,.12]}/><meshStandardMaterial color={colors.border} metalness={.65} roughness={.5}/>
        </mesh>;
      })}
    </group>
    {[[-.405,.17],[.405,.17],[-.405,-.28],[.405,-.28]].map(([x,y])=><mesh key={`${x}-${y}`} position={[x,y,.045]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.015,.015,.008,12]}/><meshStandardMaterial color={colors.border} metalness={.9} roughness={.3}/></mesh>)}
    <mesh position={[0,-.42,-.16]} castShadow><boxGeometry args={[.32,.06,.24]}/><meshStandardMaterial color={colors.text} roughness={.9}/></mesh>
  </group>;
}
