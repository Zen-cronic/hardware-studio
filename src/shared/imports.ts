import type { Part } from './types';
export type ImportFormat = 'step'|'stl'|'obj'|'glb';
export interface ImportPreview { vertices:number[][];faces:number[][];simplifiedForDisplay:boolean }
export interface ImportBody { index:number;name:string;bounds:number[][];volumeMm3:number|null;transform:number[][];validationError:string|null }
export interface ReconstructionResult {
 status:string;sourceHash:string;inputHash:string;bodyIndex?:number;bodyCount?:number;bodies?:ImportBody[];
 preview?:ImportPreview;candidatePreview?:ImportPreview;candidate?:Part;error?:string;limitations?:string[];
 features?:{id:string;type:string;diameterMm?:number;centerLocalMm?:number[];fitResidualMm?:number;counterbore?:{diameter:number;depth:number};sizeMm?:number[];commonAxisWorld?:number[]}[];
 fit?:{accepted:boolean;toleranceMm:number;surface:{method:string;sampledMaxMm:number;originalToCandidateMaxMm:number;candidateToOriginalMaxMm:number};volume:{method:string;relativeDifference:number;upper95RelativeDifference:number;symmetricDifferenceMm3:number}};
}
export interface ImportJob {id:string;importId:string;action:'inspect'|'reconstruct';status:'queued'|'running'|'ready'|'failed';bodyIndex:number;scaleToMm:number;toleranceMm?:number;createdAt:string;finishedAt?:string;error?:string;result?:ReconstructionResult}
export interface ImportRecord {id:string;designId:string;filename:string;format:ImportFormat;byteLength:number;sourceHash:string;initialScaleToMm:number;createdAt:string;latestJobId:string;latestJob?:ImportJob;originalImportId?:string}
