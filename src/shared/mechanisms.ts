import { z } from "zod";
const finite=z.number().finite();
const vector=z.tuple([finite,finite,finite]);
export const jointStudySchema=z.object({
 kind:z.literal('rigid_body'),durationSeconds:finite.min(.1).max(10),
 gravity:vector.refine(v=>v.every(n=>Math.abs(n)<=100),'Gravity must be within ±100 m/s².'),
 bodies:z.array(z.object({partId:z.string().min(1).max(100),massKg:finite.min(.0001).max(1000)}).strict()).min(1).max(20),
 joints:z.array(z.object({id:z.string().min(1).max(100),parentPartId:z.string().max(100).nullable(),childPartId:z.string().min(1).max(100),
  kind:z.enum(['revolute','prismatic','fixed']),anchorMm:vector.refine(v=>v.every(n=>Math.abs(n)<=10000)),axis:vector.refine(v=>Math.hypot(...v)>.99&&Math.hypot(...v)<1.01,'Use a unit joint axis.'),
  limits:z.tuple([finite,finite]).refine(v=>v[0]<v[1]&&v.every(n=>Math.abs(n)<=10000),'Joint limits must be ordered and finite.'),
  velocity:finite.min(-1000).max(1000),maxForce:finite.min(0).max(10000),
 }).strict()).min(1).max(20),
}).strict();
export type JointStudy=z.infer<typeof jointStudySchema>;
export type MechanismPose={partId:string;position:[number,number,number];rotation:[number,number,number]};
export interface MechanismResult {
 status:'solved';solver:string;source:unknown;inputHash:string;setup:JointStudy;
 frames:{time:number;poses:MechanismPose[];coordinates:Record<string,number>}[];
 calculations:{durationSeconds:number;maximumAnchorErrorMm:number;maximumSpeedMPerSecond:number};
 assumptions:string[];unassessed:string[];
}
