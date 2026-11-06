import type { Part, Vec3 } from '../shared/types';

export const GRAVITY = 9.80665;
export type Axis = 'x' | 'y' | 'z';
export type Side = 'min' | 'max';
export type Direction = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
export type LoadMode = 'payload' | 'force';
export type StudyJob = { id: string; partId?: string; setup?: any; revision: number; status: string; type: string; stale?: boolean; result?: any; error?: string };
export type StrengthInputs = {
  revision: number; part: Part; material: Record<string, string | number>; axis: Axis;
  supportSide: Side; loadSide: Side; direction: Direction; mode: LoadMode;
  value: string; meshSize: string; refinements: number;
};

export function forceMagnitude(value: string, mode: LoadMode): number {
  const amount = Number(value);
  const maximum = mode === 'payload' ? 1000 : 1_000_000;
  if (!value.trim() || !Number.isFinite(amount) || amount <= 0 || amount > maximum)
    throw new Error(mode === 'payload' ? 'Enter a payload above 0 and up to 1000 kg.' : 'Enter a force above 0 and up to 1,000,000 N.');
  return mode === 'payload' ? amount * GRAVITY : amount;
}

export function forceVector(value: string, mode: LoadMode, direction: Direction): Vec3 {
  if (!/^[+-][xyz]$/.test(direction)) throw new Error('Choose a local force direction.');
  const force: Vec3 = [0, 0, 0];
  force['xyz'.indexOf(direction[1])] = forceMagnitude(value, mode) * (direction[0] === '-' ? -1 : 1);
  return force;
}

export function planarAxis(part: Part, axis: Axis): boolean {
  return ['x', 'y', 'z'].includes(axis) && (part.shape === 'box' || axis === 'y');
}

function validateMaterial(material: any) {
  if (!material || !Number.isFinite(material.youngModulusMPa) || material.youngModulusMPa < .0001 || material.youngModulusMPa > 1e8 ||
    !Number.isFinite(material.poissonRatio) || material.poissonRatio < -.9 || material.poissonRatio > .49 ||
    !Number.isFinite(material.densityKgM3) || material.densityKgM3 < .01 || material.densityKgM3 > 1e6 ||
    !Number.isFinite(material.yieldStrengthMPa) || material.yieldStrengthMPa < .001 || material.yieldStrengthMPa > 1e7)
    throw new Error('Review the material values. Use positive modulus, density and yield strength, and a Poisson ratio from −0.9 to 0.49.');
}

export function strengthRequest(input: StrengthInputs) {
  const { part, axis, supportSide, loadSide, material } = input;
  if (!part || part.role === 'reference') throw new Error('Select a physical component.');
  if (!Number.isInteger(input.revision) || input.revision < 0) throw new Error('Review the current design revision.');
  if (!planarAxis(part, axis)) throw new Error('This component has no planar end on that axis. Choose local Y.');
  if (![supportSide, loadSide].every(side => ['min', 'max'].includes(side)) || supportSide === loadSide)
    throw new Error('The fixed end and loaded end must be different faces.');
  validateMaterial(material);
  const size = Number(input.meshSize);
  if (!input.meshSize.trim() || !Number.isFinite(size) || size < .05 || size > 1000)
    throw new Error('Starting mesh size must be between 0.05 and 1000 mm.');
  if (![0, 1, 2].includes(input.refinements)) throw new Error('Choose 0, 1 or 2 mesh refinements.');
  return {
    type: 'strength' as const, revision: input.revision, partId: part.id,
    material: structuredClone(material),
    supports: [{ axis, side: supportSide }],
    loads: [{ axis, side: loadSide, forceN: forceVector(input.value, input.mode, input.direction) }],
    mesh: { maxSizeMm: size, refinements: input.refinements },
  };
}

export function refinementRequest(job: StudyJob, revision: number, isEditor: boolean, parts: Part[]) {
  if (!isEditor) throw new Error('An editor can refine this study.');
  if (job.stale || revision !== job.revision) throw new Error('The design changed. Review a new study on the current revision.');
  if (job.type !== 'strength' || job.status !== 'ready' || job.result?.status !== 'unconverged')
    throw new Error('Only a completed, unconverged strength study can be refined.');
  const setup = job.setup, part = parts.find(p => p.id === setup?.partId);
  if (!part || setup?.importId || setup?.supports?.length !== 1 || setup?.loads?.length !== 1)
    throw new Error('Review a new component study before refining this setup.');
  const support = setup.supports[0], load = setup.loads[0];
  if (support.axis !== load.axis || support.min || support.max || load.min || load.max)
    throw new Error('This setup needs a new review of its boundary regions.');
  const vector = load.forceN;
  if (!Array.isArray(vector) || vector.length !== 3 || vector.some(v => !Number.isFinite(v)) || !Math.hypot(...vector))
    throw new Error('The recorded force is invalid. Review a new study.');
  if (!Number.isFinite(setup.mesh?.maxSizeMm) || setup.mesh.maxSizeMm < .1)
    throw new Error('The minimum starting mesh size is reached. Review the geometry and setup.');
  const nextSize = setup.mesh.maxSizeMm / 2;
  // Validate the recorded setup, never the currently edited form.
  strengthRequest({ revision: job.revision, part, material: setup.material, axis: support.axis,
    supportSide: support.side, loadSide: load.side, direction: '+x', mode: 'force',
    value: String(Math.hypot(...vector)), meshSize: String(nextSize), refinements: 2 });
  return { ...structuredClone(setup), type: 'strength' as const, revision: job.revision,
    mesh: { ...structuredClone(setup.mesh), maxSizeMm: nextSize, refinements: 2 } };
}

export const endLabel = (axis: Axis, side: Side) => `${side === 'min' ? '−' : '+'}${axis.toUpperCase()} end`;
export const directionLabel = (direction: Direction) => `Local ${direction[0] === '-' ? '−' : '+'}${direction[1].toUpperCase()}`;
