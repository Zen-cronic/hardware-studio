import { Component, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Edges } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Part } from "../shared/types";
import { featuredGeometry } from "../lib/partGeometry";
import { motionPose } from "../lib/motion";
import { colors } from "../lib/tokens";
import LandingPayload from "./LandingPayload";

type Props = {parts: Part[]; playing:boolean; separated:boolean; manual:boolean; reduced:boolean; progress:number; diameter:number; onReady?:()=>void; onAssembly?:(value:number)=>void};
class PreviewBoundary extends Component<{children:ReactNode;onFailure:()=>void},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return{failed:true};}
  componentDidCatch(){this.props.onFailure();}
  render(){return this.state.failed ? <div className="landing-fallback" role="status"><svg viewBox="0 0 240 240" aria-hidden="true"><ellipse cx="120" cy="50" rx="92" ry="29"/><path d="M28 50v16c0 39 184 39 184 0V50M120 94v55M71 132v57M169 132v57"/><ellipse cx="120" cy="190" rx="79" ry="25"/></svg><strong>Explore how the parts fit.</strong><p>The 3D preview is unavailable. Open the design to inspect dimensions and parts.</p></div>:this.props.children;}
}
const smooth=(a:number,b:number,v:number)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
function surfaceTexture(){
  const size=128,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const value=238+Math.round(4*Math.sin(y*.8)+2*Math.sin(x*.16+y*.02));
    const i=(y*size+x)*4;data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
  }
  const texture=new THREE.DataTexture(data,size,size);
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(2,4);
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}
function Workbench(){
  const grid=useMemo(()=>{
    const points:number[]=[];
    for(let x=-250;x<=250;x+=25)points.push(x,0,-185,x,0,185);
    for(let z=-175;z<=175;z+=25)points.push(-260,0,z,260,0,z);
    return new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(points,3));
  },[]);
  useEffect(()=>()=>grid.dispose(),[grid]);
  return <group>
    <mesh position={[0,-18,0]}><boxGeometry args={[2000,16,2000]}/><meshBasicMaterial color={colors.background} toneMapped={false}/></mesh>
    <mesh position={[0,-9.9,0]} rotation={[-Math.PI/2,0,0]} receiveShadow><planeGeometry args={[2000,2000]}/><shadowMaterial color={colors.background} transparent opacity={.5}/></mesh>
    <group position={[165,-9,-5]} rotation={[0,-.1,0]}>
      <mesh receiveShadow><boxGeometry args={[570,2,420]}/><meshStandardMaterial color={colors.panel} roughness={.85}/></mesh>
      <lineSegments geometry={grid} position={[0,1.1,0]}><lineBasicMaterial color={colors.primary} transparent opacity={.14}/></lineSegments>
      {Array.from({length:23},(_,i)=><mesh key={i} position={[-275+i*25,1.3,200]}><boxGeometry args={[.8,.2,i%2?6:11]}/><meshBasicMaterial color={colors.primary}/></mesh>)}
    </group>
    <group position={[320,-3,-140]} rotation={[0,-.32,0]}>
      <mesh castShadow><boxGeometry args={[185,5,13]}/><meshStandardMaterial color={colors.border} metalness={.92} roughness={.25}/></mesh>
      {[-85,-25].map((x,i)=><group key={x} position={[x,3,0]}><mesh castShadow position={[0,0,15]}><boxGeometry args={[8,7,40]}/><meshStandardMaterial color={colors.text} metalness={.8} roughness={.32}/></mesh><mesh castShadow position={[i?5:-5,0,35]}><boxGeometry args={[18,7,5]}/><meshStandardMaterial color={colors.border} metalness={.9} roughness={.25}/></mesh></group>)}
      <mesh castShadow position={[-25,4,-2]}><boxGeometry args={[27,12,24]}/><meshStandardMaterial color={colors.action} roughness={.48}/></mesh>
      <mesh position={[-25,10.1,-2]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[19,12]}/><meshStandardMaterial color={colors.primary} roughness={.2}/></mesh>
      {Array.from({length:28},(_,i)=><mesh key={i} position={[-75+i*6,2.6,-3]}><boxGeometry args={[.6,.2,i%5?4:7]}/><meshBasicMaterial color={colors.text}/></mesh>)}
    </group>
    <group position={[355,-3,135]} rotation={[0,.3,0]}>
      <mesh castShadow rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[2.7,2.7,65,6]}/><meshStandardMaterial color={colors.text} metalness={.85} roughness={.3}/></mesh>
      <mesh castShadow position={[11,0,-31]} rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[2.7,2.7,24,6]}/><meshStandardMaterial color={colors.text} metalness={.85} roughness={.3}/></mesh>
    </group>
    {[0,1,2].map(i=><group key={i} position={[315+i*19,-3,75]} rotation={[Math.PI/2,0,.25]}><mesh castShadow><cylinderGeometry args={[2,2,20,12]}/><meshStandardMaterial color={colors.border} metalness={.95} roughness={.2}/></mesh><mesh castShadow position={[0,11,0]}><cylinderGeometry args={[4.5,4.5,4,6]}/><meshStandardMaterial color={colors.text} metalness={.9} roughness={.28}/></mesh></group>)}
  </group>;
}
function Scene({parts,playing,separated,manual,reduced,progress,diameter,onReady,onAssembly,annotations}:Props & {annotations:RefObject<SVGSVGElement|null>}){
  const meshes=useRef<(THREE.Object3D|null)[]>([]), model=useRef<THREE.Group>(null);
  const lastFrame=useRef<number|null>(null);
  const elapsed=useRef(0),amount=useRef(0),tick=useRef(0),reported=useRef(-1);
  const {camera,size,gl,scene,invalidate,pointer}=useThree();
  const cameraTarget=useMemo(()=>new THREE.Vector3(),[]),lookTarget=useMemo(()=>new THREE.Vector3(),[]);
  const payloadBounds=useMemo(()=>new THREE.Box3(),[]),annotationPoint=useMemo(()=>new THREE.Vector3(),[]);
  const mobile=size.width<=700;
  const geometries=useMemo(()=>parts.map(p=>featuredGeometry(p,false)),[parts]);
  const brushed=useMemo(()=>surfaceTexture(),[]);
  useEffect(()=>()=>brushed.dispose(),[brushed]);
  useEffect(()=>()=>geometries.forEach(g=>g.dispose()),[geometries]);
  const offsets=useMemo(()=>parts.map(p=>{
    const y=p.position[1],integral=["motor-pilot","motor-shaft"].includes(p.id),lift=integral?0:y>190?80:y>160?52:y>130?34:y>70?12:0;
    return new THREE.Vector3(integral?0:y>190?78:y>160?-55:y>130?25:y>70?-30:0,lift,0);
  }),[parts]);
  useEffect(()=>{
    const centerY=mobile?260:110;
    camera.position.set(420,centerY+340,640);camera.lookAt(0,centerY,0);
    (camera as THREE.OrthographicCamera).zoom=mobile?.9*Math.min(size.width/340,size.height/800):Math.min(size.width/650,size.height/520);
    camera.updateProjectionMatrix();invalidate();
  },[camera,size.width,size.height,mobile,invalidate]);
  useEffect(()=>{
    const pmrem=new THREE.PMREMGenerator(gl),room=new RoomEnvironment(),env=pmrem.fromScene(room,.025);
    scene.environment=env.texture;scene.environmentIntensity=.8;room.dispose();pmrem.dispose();invalidate();
    return()=>{scene.environment=null;env.dispose();};
  },[gl,scene,invalidate]);
  useEffect(()=>{
    if(reduced || (manual && !playing))amount.current=manual&&separated?1:0;
    invalidate();
  },[separated,manual,reduced,playing,parts,invalidate]);
  useEffect(()=>{lastFrame.current=playing&&!reduced?performance.now():null;},[playing,reduced]);
  useFrame(()=>{
    const now=performance.now();
    const active=playing&&!reduced;
    const elapsedDelta=active&&lastFrame.current!==null?Math.max(0,(now-lastFrame.current)/1000):0;
    lastFrame.current=active?now:null;
    const dt=Math.min(elapsedDelta,.25);
    if(active){
      elapsed.current+=elapsedDelta;
      const idleCycle=(1-Math.cos(elapsed.current*Math.PI/7))/2;
      const scrollAssembly=1-smooth(.16,.58,progress);
      const target=manual?(separated?1:0):progress>.04?scrollAssembly:idleCycle*.92;
      amount.current=THREE.MathUtils.damp(amount.current,target,4,dt);
    }
    const t=elapsed.current;
    const inspection=smooth(.04,.22,progress), plan=smooth(.62,.90,progress);
    if (active || reduced || tick.current < 2) {
      const centerY=mobile?260-inspection*65:110;
      cameraTarget.set(420 - inspection * 180 - plan * 40, centerY + 340 - inspection*140 + plan * 260, 640 + inspection * 80 - plan * 150);
      if (!reduced) {cameraTarget.x += pointer.x * 25;cameraTarget.y += pointer.y * 12;}
      camera.position.lerp(cameraTarget, reduced || tick.current < 2 ? 1 : 1-Math.exp(-4*dt));
      lookTarget.set(0, centerY, 0);camera.lookAt(lookTarget);
    }
    if(model.current){model.current.position.x=mobile?0:165-inspection*165-plan*90;model.current.rotation.y=reduced?-.25:-.25+Math.sin(t*.16)*.18+inspection*.45-plan*.4;}
    parts.forEach((p,i)=>{
      const m=meshes.current[i];if(!m)return;
      const pose=motionPose(p,parts,t);m.position.set(...pose.position).addScaledVector(offsets[i],amount.current);m.rotation.set(...pose.rotation);
    });
    if(annotations.current){
      const overlay=annotations.current;
      const mode=progress>.62?"dimensions":progress>.10?"mechanism":"none";
      overlay.dataset.mode=mode;
      model.current?.updateMatrixWorld(true);
      const project=(id:string,side:number=0)=>{
        const i=parts.findIndex(p=>p.id===id),mesh=meshes.current[i];
        if(!mesh)return null;
        const point=new THREE.Vector3(side*parts[i].size[0]/2,0,0);mesh.localToWorld(point);point.project(camera);
        return {x:(point.x*.5+.5)*size.width,y:(-.5*point.y+.5)*size.height};
      };
      const bound=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
      for(const [index,id]of ["motor","shaft","platter"].entries()){
        const point=project(id),group=overlay.querySelector(`[data-part="${id}"]`);if(!point||!group)continue;
        const right=index===1,tx=mobile?(right?size.width-18:18):(right?size.width*.79:size.width*.23);
        const ty=bound(point.y+(index===0?18:index===1?-12:-25),mobile?205:220,size.height-115);
        group.querySelector("path")?.setAttribute("d",`M${point.x} ${point.y}L${tx+(right?-12:12)} ${ty}L${tx} ${ty}`);
        const text=group.querySelector("text");text?.setAttribute("x",String(tx));text?.setAttribute("y",String(ty-9));text?.setAttribute("text-anchor",right?"end":"start");
      }
      let payloadBottom=-Infinity;
      const payload=meshes.current[parts.findIndex(p=>p.role==="reference")];
      if(mode==="dimensions"&&payload){
        payloadBounds.setFromObject(payload);
        let left=Infinity,right=-Infinity,top=Infinity;
        for(const x of [payloadBounds.min.x,payloadBounds.max.x])for(const y of [payloadBounds.min.y,payloadBounds.max.y])for(const z of [payloadBounds.min.z,payloadBounds.max.z]){
          annotationPoint.set(x,y,z).project(camera);
          const px=(annotationPoint.x*.5+.5)*size.width,py=(-.5*annotationPoint.y+.5)*size.height;
          left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);payloadBottom=Math.max(payloadBottom,py);
        }
        overlay.dataset.payloadBounds=JSON.stringify({left,right,top,bottom:payloadBottom});
      }
      for(const [index,id]of ["platter","base-floor"].entries()){
        const left=project(id,-1),right=project(id,1),group=overlay.querySelector(`[data-dimension="${id}"]`);if(!left||!right||!group)continue;
        const dimensionY=Math.max(left.y,right.y)+(index?36:-24);
        const y=bound(index?dimensionY:Math.max(dimensionY,payloadBottom+12),mobile?210:240,size.height-100);
        group.querySelector("path")?.setAttribute("d",`M${left.x} ${left.y}V${y}H${right.x}V${right.y}M${left.x} ${y-4}V${y+4}M${right.x} ${y-4}V${y+4}`);
        const text=group.querySelector("text");text?.setAttribute("x",String(bound((left.x+right.x)/2,85,size.width-85)));text?.setAttribute("y",String(y+20));
      }
    }
    const binary=amount.current>=.5?1:0;if(binary!==reported.current){reported.current=binary;onAssembly?.(amount.current);}
    const canvas=gl.domElement;
    canvas.dataset.cameraView=plan>.9?"dimensions":inspection>.9?"mechanism":"product";canvas.dataset.cameraPosition=camera.position.toArray().map(n=>n.toFixed(2)).join(",");
    canvas.dataset.assemblyAmount=amount.current.toFixed(3);canvas.dataset.elapsed=t.toFixed(3);canvas.dataset.phase=manual?"manual":progress>.62?"dimensions":progress>.04?"assembly":"construction";canvas.dataset.renderCount=String(++tick.current);canvas.dataset.diameter=String(diameter);canvas.dataset.drawCalls=String(gl.info.render.calls);canvas.dataset.triangles=String(gl.info.render.triangles);
    if(tick.current===2)onReady?.();if(tick.current<2)invalidate();
  });
  return <>
    <color attach="background" args={[colors.background]}/><ambientLight intensity={.3}/><hemisphereLight args={[colors.white,colors.action,.4]}/>
    <directionalLight position={[-200,650,300]} intensity={2.5} castShadow shadow-radius={6} shadow-mapSize={[2048,2048]} shadow-camera-left={-650} shadow-camera-right={650} shadow-camera-top={650} shadow-camera-bottom={-650} shadow-camera-far={1800} shadow-bias={-.0002}/>
    <directionalLight position={[500,250,-300]} intensity={.65}/>
    <Workbench/>
    <group ref={model} position={[mobile?0:165,0,0]}>
      {parts.map((p,i)=>{const metal=/steel|alumin|metal/i.test(p.material),reference=p.role==="reference",coated=["base-floor","motor-plate"].includes(p.id),cover=p.id==="platter-cover";if(reference)return <group key={p.id} ref={m=>{meshes.current[i]=m;}} position={p.position} rotation={p.rotation}><LandingPayload size={p.size}/></group>;return <mesh castShadow receiveShadow key={p.id} ref={m=>{meshes.current[i]=m;}} position={p.position} rotation={p.rotation} geometry={geometries[i]}>
        <meshPhysicalMaterial color={reference?colors.action:coated?colors.action:cover?colors.primary:new THREE.Color(p.color).multiplyScalar(metal?.95:1)} metalness={coated?.65:metal?.88:0} roughness={coated?.32:metal?.25:.52} anisotropy={metal&&!coated?.65:0} roughnessMap={metal&&!coated?brushed:null} clearcoat={reference||coated||cover?.35:.05}/>
        <Edges threshold={30} color={reference?colors.primary:colors.text} transparent opacity={reference?.6:.12}/>
      </mesh>;})}
    </group>
  </>;
}
export default function LandingScene(props:Props){
  const [ready,setReady]=useState(false),[failed,setFailed]=useState(false);
  const annotations=useRef<SVGSVGElement>(null);
  const base=props.parts.find(p=>p.id==="base-floor")!;
  return <div className="landing-scene" data-testid="landing-scene" data-motion={props.playing&&!props.reduced?"playing":"paused"} data-assembly={props.separated?"separated":"assembled"} data-scroll={props.progress.toFixed(3)} data-diameter={props.diameter} data-ready={ready} aria-label={failed?"3D preview unavailable":"Motorized turntable on a workbench. The moving camera shows the product it can display."} role={failed?"region":"img"}>
    <PreviewBoundary onFailure={()=>setFailed(true)}><Canvas style={{position:"absolute",inset:0}} shadows="percentage" orthographic dpr={[1,1.5]} camera={{near:.1,far:3000}} gl={{antialias:true,preserveDrawingBuffer:true}} frameloop={props.playing&&!props.reduced?"always":"demand"}><Scene {...props} annotations={annotations} onReady={()=>setReady(true)}/></Canvas></PreviewBoundary>
    {ready&&!failed&&<svg className="landing-annotations" ref={annotations} aria-hidden="true">
      <g className="mechanism-annotations">{[["motor","Drive motor"],["shaft","Drive shaft"],["platter","Rotating platter"]].map(([id,label])=><g key={id} data-part={id}><path/><text>{label}</text></g>)}</g>
      <g className="dimension-annotations">{[["platter",`Platter ${props.diameter} mm`],["base-floor",`Base ${base.size[0]} mm`]].map(([id,label])=><g key={id} data-dimension={id}><path/><text textAnchor="middle">{label}</text></g>)}</g>
    </svg>}
    {!ready&&!failed&&<span className="landing-loading">Preparing the 3D design…</span>}
  </div>;
}
