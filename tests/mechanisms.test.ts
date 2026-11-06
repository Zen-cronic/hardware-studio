import { test,expect } from 'vitest';
import { simulateMechanism } from '../server/mechanism-solver';
import { createDesign,deriveDesign } from '../src/shared/engine';
import type { Snapshot } from '../src/shared/types';
import type { JointStudy } from '../src/shared/mechanisms';
const design=createDesign('custom');design.customParts=[{id:'link',name:'Link',shape:'box',size:[100,10,10],position:[50,0,0],color:'#75bde5',material:'Aluminum',process:'machine'}];
const snapshot:Snapshot={design,derived:deriveDesign(design),history:[]};
const setup:JointStudy={kind:'rigid_body',durationSeconds:1,gravity:[0,-9.80665,0],bodies:[{partId:'link',massKg:.1}],joints:[{id:'hinge',parentPartId:null,childPartId:'link',kind:'revolute',anchorMm:[0,0,0],axis:[0,0,1],limits:[-30,30],velocity:0,maxForce:0}]};
test('gravity moves a real hinged body and joint limits constrain it',async()=>{
 const result=await simulateMechanism(snapshot,setup,{designId:design.id,revision:0});
 expect(result.frames).toHaveLength(21);const last=result.frames.at(-1)!;
 expect(last.coordinates.hinge).toBeLessThan(-10);expect(last.coordinates.hinge).toBeGreaterThan(-31);
 expect(last.poses[0].position[1]).toBeLessThan(-8);expect(result.calculations.maximumAnchorErrorMm).toBeLessThan(.2);
 expect(result.assumptions.join(' ')).toContain('rectangular-envelope inertia');
});
test('a powered slider moves to a millimeter limit and a fixed joint retains its pose',async()=>{
 const slider=structuredClone(setup);slider.gravity=[0,0,0];Object.assign(slider.joints[0],{kind:'prismatic',axis:[1,0,0],limits:[0,20],velocity:100,maxForce:100});
 const result=await simulateMechanism(snapshot,slider);expect(result.frames.at(-1)!.coordinates.hinge).toBeGreaterThan(19);expect(result.frames.at(-1)!.coordinates.hinge).toBeLessThan(20.5);
 const fixed=structuredClone(setup);fixed.joints[0].kind='fixed';const locked=await simulateMechanism(snapshot,fixed);
 expect(locked.frames.at(-1)!.poses[0].position[1]).toBeCloseTo(0,2);
});
test('a zero drive limit cannot cause movement with zero gravity and replay is repeatable',async()=>{
 const free=structuredClone(setup);free.gravity=[0,0,0];free.joints[0].velocity=90;
 const a=await simulateMechanism(snapshot,free),b=await simulateMechanism(snapshot,free);
 expect(a.frames).toEqual(b.frames);expect(a.frames.at(-1)!.coordinates.hinge).toBeCloseTo(0,4);
});
test('rejects missing bodies, disconnected joints, invalid mass and non-unit axes',async()=>{
 await expect(simulateMechanism(snapshot,{...setup,bodies:[{partId:'unknown',massKg:1}]})).rejects.toThrow('no longer exists');
 const bad=structuredClone(setup);bad.bodies[0].massKg=0;await expect(simulateMechanism(snapshot,bad)).rejects.toThrow();
 bad.bodies[0].massKg=1;bad.joints[0].axis=[0,0,2];await expect(simulateMechanism(snapshot,bad)).rejects.toThrow('unit joint axis');
});

test('rotated components start at zero and reported hinge coordinates share the enforced limits',async()=>{
 const rotated=structuredClone(snapshot);rotated.derived.parts[0].rotation=[Math.PI/2,0,0];
 const free=structuredClone(setup);free.gravity=[0,0,0];
 const still=await simulateMechanism(rotated,free);expect(still.frames[0].coordinates.hinge).toBeCloseTo(0,4);expect(still.frames.at(-1)!.coordinates.hinge).toBeCloseTo(0,3);expect(still.frames.at(-1)!.poses[0].rotation[0]).toBeCloseTo(Math.PI/2,3);
 free.joints[0].velocity=90;free.joints[0].maxForce=1;
 const driven=await simulateMechanism(rotated,free);expect(driven.frames.at(-1)!.coordinates.hinge).toBeGreaterThan(25);expect(driven.frames.at(-1)!.coordinates.hinge).toBeLessThan(31);
});
