import { useEffect,useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
export default function AnalysisCanvas({result,multiplier=10,scaleMax,field='displacement'}:{result:any;multiplier?:number;scaleMax?:number;field?:'displacement'|'stress'}) {
 const geometry=useMemo(()=>{
  const mesh=result.mesh,dis=result.displacement;if(!mesh?.vertices?.length||!mesh.surface?.length||!dis?.length)return null;
  const values=new Float64Array(mesh.vertices.length),counts=new Uint32Array(mesh.vertices.length);
  if(field==='stress')mesh.tets.forEach((tet:number[],i:number)=>tet.forEach(v=>{values[v]+=result.vonMises[i];counts[v]++;}));
  const points:number[]=[],colors:number[]=[];const max=scaleMax||(field==='stress'?result.maxVonMisesMPa:result.maxDisplacementMm)||1;
  const cold=new THREE.Color('#72c9f4'),hot=new THREE.Color('#b93627');
  mesh.vertices.forEach((p:number[],i:number)=>{const d=dis[i]||[0,0,0];points.push(...p.map((v,j)=>v+d[j]*multiplier));const value=field==='stress'?values[i]/Math.max(1,counts[i]):Math.hypot(...d);const c=cold.clone().lerp(hot,Math.min(1,value/max));colors.push(c.r,c.g,c.b);});
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(mesh.surface.flat());g.computeVertexNormals();
  const original=new THREE.BufferGeometry();original.setAttribute('position',new THREE.Float32BufferAttribute(mesh.vertices.flat(),3));original.setIndex(mesh.surface.flat());
  const boundary=(indices:number[])=>{const b=new THREE.BufferGeometry();b.setAttribute('position',original.getAttribute('position'));b.setIndex(indices.flatMap(i=>mesh.surface[i]||[]));return b;};
  return {deformed:g,outline:new THREE.EdgesGeometry(original,22),supports:boundary(result.supports?.surfaceTriangleIndices||[]),loads:boundary((result.loads||[]).flatMap((l:any)=>l.surfaceTriangleIndices||[])),original};
 },[result,multiplier,scaleMax,field]);
 useEffect(()=>()=>{if(geometry)Object.values(geometry).forEach(g=>g.dispose());},[geometry]);
 if(!geometry)return <p className="subtle">This study has no field to display.</p>;
 const maximum=scaleMax||(field==='stress'?result.maxVonMisesMPa:result.maxDisplacementMm)||0;
 return <div className="analysis-viewport" aria-label="Computed engineering field"><Canvas camera={{position:[180,140,180],far:10000}}><color attach="background" args={['#ecf6fd']}/><ambientLight intensity={1.5}/><directionalLight position={[100,200,100]} intensity={2}/><Bounds fit clip observe margin={1.35}><group><mesh geometry={geometry.deformed}><meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={.6}/></mesh><lineSegments geometry={geometry.outline}><lineBasicMaterial color="#335b79" transparent opacity={.4}/></lineSegments><mesh geometry={geometry.supports}><meshBasicMaterial color="#112f87" side={THREE.DoubleSide} transparent opacity={.55} polygonOffset polygonOffsetFactor={-2}/></mesh><mesh geometry={geometry.loads}><meshBasicMaterial color="#f1a435" side={THREE.DoubleSide} transparent opacity={.55} polygonOffset polygonOffsetFactor={-2}/></mesh></group></Bounds><OrbitControls makeDefault/></Canvas><div className="analysis-legend"><span>{field==='stress'?'Stress, vertex-averaged / MPa':'Displacement / mm'}</span><i/><span>0 → {maximum.toPrecision(3)}</span><small>Deformation ×{multiplier}; outline = original. Blue = fixed, amber = load.</small></div></div>;
}
