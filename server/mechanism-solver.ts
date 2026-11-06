import RAPIER from '@dimforge/rapier3d-compat';
import { Euler,Quaternion,Vector3 } from 'three';
import { createHash } from 'node:crypto';
import type { Snapshot } from '../src/shared/types';
import { jointStudySchema,type MechanismResult,type JointStudy } from '../src/shared/mechanisms';
let ready:Promise<void>|undefined;
const vec=(v:number[])=>({x:v[0],y:v[1],z:v[2]});
const identity={x:0,y:0,z:0,w:1};
const q=(value:{x:number;y:number;z:number;w:number})=>new Quaternion(value.x,value.y,value.z,value.w);
export async function simulateMechanism(snapshot:Snapshot,raw:unknown,source:unknown={}):Promise<MechanismResult>{
 const setup=jointStudySchema.parse(raw);
 const ids=new Set(setup.bodies.map(b=>b.partId));
 if(ids.size!==setup.bodies.length)throw new Error('Each moving component needs one declared mass.');
 if(new Set(setup.joints.map(j=>j.id)).size!==setup.joints.length)throw new Error('Give each joint a unique name.');
 for(const b of setup.bodies)if(!snapshot.derived.parts.some(p=>p.id===b.partId))throw new Error('A selected component no longer exists.');
 for(const j of setup.joints)if(!ids.has(j.childPartId)||(j.parentPartId!==null&&!ids.has(j.parentPartId))||j.parentPartId===j.childPartId)throw new Error('Every joint must connect distinct declared bodies or the fixed world.');
 const connected=new Set<string>();
 for(let pass=0;pass<setup.bodies.length;pass++)for(const j of setup.joints){if(j.parentPartId===null||connected.has(j.parentPartId))connected.add(j.childPartId);if(connected.has(j.childPartId)&&j.parentPartId)connected.add(j.parentPartId);}
 if(connected.size!==ids.size)throw new Error('Connect every moving component to the fixed world through a joint.');
 ready||=RAPIER.init();await ready;
 const world=new RAPIER.World(vec(setup.gravity));world.timestep=1/240;world.numSolverIterations=12;
 try{
  const fixed=world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const bodies=new Map<string,RAPIER.RigidBody>();
  for(const entry of setup.bodies){
   const part=snapshot.derived.parts.find(p=>p.id===entry.partId)!;
   const size=part.size.map(n=>n/1000),rotation=new Quaternion().setFromEuler(new Euler(...(part.rotation||[0,0,0])));
   const mass=entry.massKg;
   const inertia={x:mass*(size[1]**2+size[2]**2)/12,y:mass*(size[0]**2+size[2]**2)/12,z:mass*(size[0]**2+size[1]**2)/12};
   const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...part.position.map(n=>n/1000) as [number,number,number]).setRotation(rotation).setCanSleep(false).setAdditionalMassProperties(mass,{x:0,y:0,z:0},inertia,identity));
   bodies.set(part.id,body);
  }
  const localPoint=(body:RAPIER.RigidBody,anchor:number[])=>new Vector3(...anchor.map(n=>n/1000)).sub(body.translation()).applyQuaternion(q(body.rotation()).invert());
  const active=setup.joints.map(j=>{
   const a=j.parentPartId?bodies.get(j.parentPartId)!:fixed,b=bodies.get(j.childPartId)!;
   const anchorA=localPoint(a,j.anchorMm),anchorB=localPoint(b,j.anchorMm);
   const worldAxis=new Vector3(...j.axis).normalize(),axisA=worldAxis.clone().applyQuaternion(q(a.rotation()).invert()),axisB=worldAxis.clone().applyQuaternion(q(b.rotation()).invert());
   let data:RAPIER.JointData;
   if(j.kind==='fixed')data=RAPIER.JointData.fixed(anchorA,q(a.rotation()).invert(),anchorB,q(b.rotation()).invert());
   else if(j.kind==='revolute')data=RAPIER.JointData.revoluteWithAxes(anchorA,anchorB,axisA,axisB);
   else {data=RAPIER.JointData.prismatic(anchorA,anchorB,axisA);if(q(a.rotation()).angleTo(q(b.rotation()))>1e-5)throw new Error('Prismatic bodies must share an orientation. Rotate them consistently before this study.');}
   const joint=world.createImpulseJoint(data,a,b,true);
   joint.setContactsEnabled(false);
   // Both local joint frames share one initial world frame: the entered pose is zero.
   const worldFrame=new Quaternion().setFromUnitVectors(new Vector3(1,0,0),worldAxis);
   joint.setFrameX1(q(a.rotation()).invert().multiply(worldFrame));
   joint.setFrameX2(q(b.rotation()).invert().multiply(worldFrame));
   if(j.kind!=='fixed'){
    const unit=j.kind==='revolute'?Math.PI/180:1/1000,limited=joint as RAPIER.UnitImpulseJoint;
    limited.setLimits(j.limits[0]*unit,j.limits[1]*unit);
    limited.configureMotorModel(RAPIER.MotorModel.ForceBased);
    limited.configureMotorVelocity(j.velocity*unit,1);
    limited.setMotorMaxForce(j.maxForce);
   }
   return {input:j,a,b,anchorA,anchorB,joint};
  });
  const frames:MechanismResult['frames']=[];let maximumAnchorErrorMm=0,maximumSpeedMPerSecond=0;
  const sample=(time:number)=>{
   const coordinates:Record<string,number>={};
   for(const {input:j,a,b,anchorA,anchorB,joint} of active){
    const rotationA=q(a.rotation()),rotationB=q(b.rotation());
    const pointA=anchorA.clone().applyQuaternion(rotationA).add(a.translation()),pointB=anchorB.clone().applyQuaternion(rotationB).add(b.translation());
    const frameA=rotationA.clone().multiply(q(joint.frameX1())),frameB=rotationB.clone().multiply(q(joint.frameX2()));
    const delta=pointB.clone().sub(pointA),axis=new Vector3(1,0,0).applyQuaternion(frameA);
    const slide=delta.dot(axis);
    const error=j.kind==='prismatic'?delta.clone().addScaledVector(axis,-slide).length():delta.length();
    maximumAnchorErrorMm=Math.max(maximumAnchorErrorMm,error*1000);
    const relative=frameA.clone().invert().multiply(frameB);
    let angle=2*Math.atan2(relative.x,relative.w);if(angle>Math.PI)angle-=2*Math.PI;if(angle< -Math.PI)angle+=2*Math.PI;
    coordinates[j.id]=j.kind==='prismatic'?slide*1000:j.kind==='revolute'?angle*180/Math.PI:0;
   }
   frames.push({time,coordinates,poses:[...bodies].map(([partId,body])=>{
    const p=body.translation(),r=new Euler().setFromQuaternion(q(body.rotation()));const velocity=body.linvel();maximumSpeedMPerSecond=Math.max(maximumSpeedMPerSecond,Math.hypot(velocity.x,velocity.y,velocity.z));
    const values=[p.x,p.y,p.z,r.x,r.y,r.z];if(!values.every(Number.isFinite))throw new Error('This joint setup became numerically unstable. Reduce the forces or check its connections.');
    return {partId,position:[p.x*1000,p.y*1000,p.z*1000],rotation:[r.x,r.y,r.z]};
   })});
  };
  sample(0);const steps=Math.round(setup.durationSeconds*240);
  for(let step=1;step<=steps;step++){world.step();if(step%12===0||step===steps)sample(step/240);}
  return {status:'solved',solver:'Rapier 0.21.0 rigid-body dynamics',source,inputHash:createHash('sha256').update(JSON.stringify({source,setup,parts:snapshot.derived.parts})).digest('hex'),setup,frames,
   calculations:{durationSeconds:steps/240,maximumAnchorErrorMm,maximumSpeedMPerSecond},
   assumptions:['The entered masses, gravity, joint anchors, axes, limits and drive limits define this study.','Each moving part uses a uniform rectangular-envelope inertia at its displayed center. Holes, nonuniform materials and attached payloads require measured inertia or a separate declared body.','Fixed time step: 1/240 second; reported poses every 1/20 second. Joint coordinates are degrees for rotation and millimeters for sliding, relative to the entered starting pose.','Undeclared components remain outside the simulated mechanism.'],
   unassessed:['Flexible deformation and material strength','Contact, interference, friction and fastener strength','Motor heating, electrical demand and physical build validation']};
 }finally{world.free();}
}
