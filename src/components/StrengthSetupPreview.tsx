import { useId, useMemo } from 'react';
import { EdgesGeometry } from 'three';
import { featuredGeometry } from '../lib/partGeometry';
import type { Part, Vec3 } from '../shared/types';
import { directionLabel, endLabel, type Axis, type Side, type Direction } from '../lib/strengthSetup';

// Project the same local component geometry used by the design view, including holes.
// No assembly rotation is applied: the solver also operates in component coordinates.
export function componentDiagram(part: Part, axis: Axis) {
  const geometry = featuredGeometry(part), edges = new EdgesGeometry(geometry, 20);
  try {
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    const project = (p: number[]) => [p[0] - p[2] * .65, -p[1] + p[2] * .42 + p[0] * .12];
    const vertices = geometry.getAttribute('position'), edgePoints = edges.getAttribute('position');
    const vertex = (i: number) => [vertices.getX(i), vertices.getY(i), vertices.getZ(i)];
    const projected = Array.from({ length: vertices.count }, (_, i) => project(vertex(i)));
    const lo = [0, 1].map(a => Math.min(...projected.map(p => p[a])));
    const hi = [0, 1].map(a => Math.max(...projected.map(p => p[a])));
    const scale = Math.min(270 / Math.max(hi[0] - lo[0], 1), 140 / Math.max(hi[1] - lo[1], 1));
    const map = (p: number[]) => { const q = project(p); return [190 + (q[0] - (hi[0] + lo[0]) / 2) * scale, 118 + (q[1] - (hi[1] + lo[1]) / 2) * scale]; };
    const path = (points: number[][]) => points.map((p, i) => `${i ? 'L' : 'M'}${map(p).map(n => n.toFixed(2)).join(',')}`).join(' ');
    const outline = Array.from({ length: edgePoints.count / 2 }, (_, i) => path([0, 1].map(j => {
      const k = i * 2 + j; return [edgePoints.getX(k), edgePoints.getY(k), edgePoints.getZ(k)];
    }))).join(' ');
    const index = 'xyz'.indexOf(axis), low = bounds.min.getComponent(index), high = bounds.max.getComponent(index);
    const faces: Record<Side, string[]> = { min: [], max: [] };
    const indices = geometry.index;
    for (let i = 0; i < (indices?.count ?? vertices.count); i += 3) {
      const triangle = [0, 1, 2].map(j => vertex(indices ? indices.getX(i + j) : i + j));
      for (const side of ['min', 'max'] as const) {
        if (triangle.every(p => Math.abs(p[index] - (side === 'min' ? low : high)) < 1e-5)) faces[side].push(path(triangle) + ' Z');
      }
    }
    const end = (side: Side) => { const p = bounds.getCenter(bounds.min.clone()).toArray(); p[index] = side === 'min' ? low : high; return map(p); };
    return { outline, faces, ends: { min: end('min'), max: end('max') }, project };
  } finally { geometry.dispose(); edges.dispose(); }
}

export default function StrengthSetupPreview({ part, axis, supportSide, loadSide, direction, forceN }: {
  part: Part; axis: Axis; supportSide: Side; loadSide: Side; direction: Direction; forceN?: number;
}) {
  const marker = useId().replaceAll(':', '');
  const diagram = useMemo(() => componentDiagram(part, axis), [part, axis]);
  const start = diagram.ends[loadSide];
  const v: Vec3 = [0, 0, 0]; v['xyz'.indexOf(direction[1])] = direction[0] === '-' ? -1 : 1;
  const d = diagram.project(v), length = Math.hypot(...d);
  const finish = [start[0] + d[0] / length * 48, start[1] + d[1] / length * 48];
  return <figure className="strength-preview" aria-label="Component support and load preview">
    <figcaption><strong>{part.name}</strong><span>Local coordinates / mm</span></figcaption>
    <svg viewBox="0 0 380 240" role="img" aria-label={`${part.name}: fixed ${endLabel(axis, supportSide)}, loaded ${endLabel(axis, loadSide)}, force ${directionLabel(direction)}`}>
      <defs><marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" className="strength-force-fill"/></marker></defs>
      <path d={diagram.faces[supportSide].join(' ')} className="strength-fixed-face"/>
      <path d={diagram.faces[loadSide].join(' ')} className="strength-load-face"/>
      <path d={diagram.outline} className="strength-outline"/>
      <line x1={start[0]} y1={start[1]} x2={finish[0]} y2={finish[1]} className="strength-force" markerEnd={`url(#${marker})`}/>
      {(['min', 'max'] as const).map(side => <g key={side}><circle cx={diagram.ends[side][0]} cy={diagram.ends[side][1]} r="3" className="strength-end"/><text x={diagram.ends[side][0]} y={diagram.ends[side][1] - 13} textAnchor="middle" className="strength-end-label">{endLabel(axis, side)}</text></g>)}
      <g className="strength-axes"><path d="M38 206 L67 210 M38 206 L38 178 M38 206 L19 218"/><text x="72" y="216">+X</text><text x="31" y="172">+Y</text><text x="5" y="234">+Z</text></g>
    </svg>
    <div className="strength-preview-key"><span><i className="fixed-key"/>Fixed {endLabel(axis, supportSide)}</span><span><i className="load-key"/>Loaded {endLabel(axis, loadSide)}</span></div>
    <p>{part.size.join(' × ')} mm. {forceN !== undefined ? `${Number(forceN.toFixed(6))} N toward ${directionLabel(direction)}.` : 'Enter a valid load to review its force.'}</p>
  </figure>;
}
