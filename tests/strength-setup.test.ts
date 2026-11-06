import { describe, expect, test } from 'vitest';
import { deskArmParts } from '../src/shared/desk-arm';
import { forceMagnitude, forceVector, strengthRequest, refinementRequest, type StrengthInputs, type StudyJob } from '../src/lib/strengthSetup';
import { componentDiagram } from '../src/components/StrengthSetupPreview';

const part = { ...deskArmParts().find(p => p.id === 'upper-arm')!, size: [110, 6, 24] as [number, number, number] };
const inputs: StrengthInputs = { revision: 3, part, material: { name: 'Test stock', youngModulusMPa: 70000, poissonRatio: .33, densityKgM3: 2700, yieldStrengthMPa: 240 }, axis: 'x', supportSide: 'min', loadSide: 'max', direction: '-y', mode: 'payload', value: '.5', meshSize: '8', refinements: 2 };
const job = (): StudyJob => ({ id: 'test-study', revision: 3, type: 'strength', status: 'ready', partId: part.id, result: { status: 'unconverged' }, setup: strengthRequest(inputs) });

describe('reviewed component strength inputs', () => {
  test('converts a declared payload to newtons with standard gravity and preserves force entry', () => {
    expect(forceMagnitude('0.5', 'payload')).toBe(4.903325);
    expect(forceVector('0.5', 'payload', '-y')).toEqual([0, -4.903325, 0]);
    expect(forceVector('12', 'force', '+z')).toEqual([0, 0, 12]);
    expect(forceVector('12', 'force', '-x')).toEqual([-12, 0, 0]);
  });
  test.each(['', ' ', '0', '-1', 'NaN', 'Infinity', '1001'])('rejects invalid payload %j', value => {
    expect(() => forceMagnitude(value, 'payload')).toThrow();
  });
  test('records the chosen fixed end, load end, direction, mesh and immutable material', () => {
    const request = strengthRequest({ ...inputs, axis: 'z', supportSide: 'max', loadSide: 'min', direction: '+x', meshSize: '4' });
    expect(request.supports).toEqual([{ axis: 'z', side: 'max' }]);
    expect(request.loads).toEqual([{ axis: 'z', side: 'min', forceN: [4.903325, 0, 0] }]);
    expect(request.mesh).toEqual({ maxSizeMm: 4, refinements: 2 });
    request.material.youngModulusMPa = 3;
    expect(inputs.material.youngModulusMPa).toBe(70000);
  });
  test('rejects overlapping and nonexistent planar ends, invalid meshes and material', () => {
    expect(() => strengthRequest({ ...inputs, loadSide: 'min' })).toThrow('different faces');
    expect(() => strengthRequest({ ...inputs, part: deskArmParts().find(p => p.id === 'column')! })).toThrow('no planar end');
    expect(() => strengthRequest({ ...inputs, meshSize: '.01' })).toThrow('mesh size');
    expect(() => strengthRequest({ ...inputs, material: { ...inputs.material, poissonRatio: .5 } })).toThrow('material');
    expect(() => strengthRequest({ ...inputs, part: { ...part, role: 'reference' } })).toThrow('physical component');
  });
  test('diagram comes from the selected local geometry and retains its mounting holes', () => {
    const actual = componentDiagram(part, 'y'), solid = componentDiagram({ ...part, holes: [] }, 'y');
    expect(actual.outline).not.toBe(solid.outline);
    expect(actual.faces.min.length).toBeGreaterThan(solid.faces.min.length);
    expect(actual.faces.max.length).toBeGreaterThan(0);
    const rotated = componentDiagram({ ...part, position: [999, 99, 999], rotation: [1, 2, 3] }, 'y');
    expect(rotated.outline).toEqual(actual.outline);
    expect(rotated.faces).toEqual(actual.faces);
    expect(rotated.ends).toEqual(actual.ends);
  });
});

describe('immutable mesh refinement', () => {
  test('halves only mesh size and preserves every recorded input and revision', () => {
    const source = job(), before = structuredClone(source);
    const refined = refinementRequest(source, 3, true, [part]);
    expect(refined).toEqual({ ...source.setup, type: 'strength', revision: 3, mesh: { maxSizeMm: 4, refinements: 2 } });
    refined.loads[0].forceN[1] = -100;
    refined.material.youngModulusMPa = 4;
    expect(source).toEqual(before);
  });
  test('rejects viewers, stale revisions, missing parts, in-flight or invalid results', () => {
    expect(() => refinementRequest(job(), 3, false, [part])).toThrow('editor');
    expect(() => refinementRequest(job(), 4, true, [part])).toThrow('design changed');
    expect(() => refinementRequest({ ...job(), stale: true }, 3, true, [part])).toThrow('design changed');
    expect(() => refinementRequest(job(), 3, true, [])).toThrow('new component study');
    expect(() => refinementRequest({ ...job(), status: 'running' }, 3, true, [part])).toThrow('completed');
    expect(() => refinementRequest({ ...job(), result: { status: 'needs_inputs' } }, 3, true, [part])).toThrow('completed');
  });
  test('rejects malformed recorded force, overlapping ends and further refinement below the bound', () => {
    const source = job(); source.setup.loads[0].forceN = [0, 0, 0];
    expect(() => refinementRequest(source, 3, true, [part])).toThrow('force');
    const overlap = job(); overlap.setup.loads[0].side = 'min';
    expect(() => refinementRequest(overlap, 3, true, [part])).toThrow('different faces');
    const minimum = job(); minimum.setup.mesh.maxSizeMm = .05;
    expect(() => refinementRequest(minimum, 3, true, [part])).toThrow('minimum');
  });
});
