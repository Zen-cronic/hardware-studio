"""Read-only physical assembly audit of actual export archives. No fabrication claim.

Run: poetry run python tests/physical_build_audit.py
Writes diagnostics only to .artifacts/mic-build; does not modify source packages.
Intersections are candidates for engineering triage, not automatic failures:
coincident representations, adhesives, seals, and vendor envelopes need context.
"""
from __future__ import annotations
import hashlib
import itertools
import json
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import cadquery as cq
from cad.geometry import bounds, world_shape

OUT = ROOT / '.artifacts' / 'mic-build'
PACKAGES = ROOT / '.artifacts' / 'verified-packages'


def overlap_volume(a, b):
    aa, bb = bounds(a), bounds(b)
    if any(aa['max'][i] < bb['min'][i] - 1e-6 or bb['max'][i] < aa['min'][i] - 1e-6 for i in range(3)):
        return 0.0
    return sum(s.Volume() for s in a.intersect(b).Solids())


def pair_measure(a, b):
    return {'distanceMm': round(a.distance(b), 6), 'overlapMm3': round(overlap_volume(a, b), 6)}


def audit(entry, tmp):
    archive_path = PACKAGES / entry['file']
    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    assert digest == entry['sha256'], f"Archive hash changed: {entry['kind']}"
    with zipfile.ZipFile(archive_path) as z:
        assert all(not n.startswith('/') and '..' not in Path(n).parts for n in z.namelist())
        snapshot = json.loads(z.read('design.json'))
        manifest = json.loads(z.read('manifest.json'))
        assert all(hashlib.sha256(z.read(a['path'])).hexdigest() == a['sha256'] for a in manifest['artifacts'])
        parts = {p['id']: p for p in snapshot['derived']['parts'] if p.get('role') != 'reference'}
        shapes = {}
        for p in manifest['parts']:
            target = tmp / (entry['kind'] + '-' + p['id'] + '.step')
            target.write_bytes(z.read(p['files']['step']))
            local = cq.importers.importStep(str(target)).val()
            assert local.isValid() and len(local.Solids()) == 1
            shapes[p['id']] = world_shape(parts[p['id']], local)
    overlaps = []
    touching = []
    for a, b in itertools.combinations(shapes, 2):
        m = pair_measure(shapes[a], shapes[b])
        if m['overlapMm3'] > 0.001:
            overlaps.append({'a': a, 'b': b, **m})
        elif m['distanceMm'] < 0.001:
            touching.append({'a': a, 'b': b, **m})
    nearest = []
    for a in shapes:
        neighbors = sorted(({'id': b, **pair_measure(shapes[a], shapes[b])} for b in shapes if b != a), key=lambda p: p['distanceMm'])
        nearest.append({'id': a, 'nearest': neighbors[0] if neighbors else None})
    critical_pairs = {'turntable': [('base', 'bridge-left'), ('base', 'base-floor'), ('motor', 'mount-0'), ('hub', 'shaft'), ('platter', 'shaft')], 'slider': [('rail-front', 'carriage')], 'lamp': [('shade', 'led')], 'planter': [('pump', 'manifold'), ('pot-0', 'reservoir')], 'holder': [('pivot', 'guide')]}
    critical = [{'a': a, 'b': b, **pair_measure(shapes[a], shapes[b])} for a, b in critical_pairs.get(entry['kind'], [])]
    physical_links = []
    for c in snapshot['derived']['connections']:
        if c['from'] in shapes and c['to'] in shapes:
            physical_links.append({**c, **pair_measure(shapes[c['from']], shapes[c['to']])})
    return {
        'kind': entry['kind'], 'revision': snapshot['design']['revision'],
        'sha256': digest, 'params': snapshot['design']['params'],
        'reopenedValidParts': len(shapes), 'overlapCandidates': overlaps, 'touchingPairs': touching,
        'nearestComponents': nearest, 'criticalPairMeasurements': critical, 'declaredConnectionMeasurements': physical_links,
        'parts': [{'id': p['id'], 'shape': p['shape'], 'size': p['size'], 'position': p['position'],
                   'process': p['process'], 'boreMm': p.get('holeDiameter'),
                   'worldBoundsMm': bounds(shapes[p['id']])} for p in parts.values()],
        'bomNames': [b['name'] for b in snapshot['derived']['bom']],
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    index = json.loads((PACKAGES / 'index.json').read_text())
    with tempfile.TemporaryDirectory(prefix='hardware-physical-audit-') as temp:
        results = [audit(e, Path(temp)) for e in index['packages']]
    report = {'scope': 'Static exact CAD, actual six verified revision-1 export ZIPs; no physical build, motion sweep, load, electrical or watertightness proof.',
              'sourceCommit': index['productCommit'], 'toleranceMm': 0.001,
              'intersectionThresholdMm3': 0.001, 'packages': results}
    (OUT / 'physical-audit.json').write_text(json.dumps(report, indent=2) + '\n')
    for r in results:
        print(json.dumps({'kind': r['kind'], 'validParts': r['reopenedValidParts'], 'overlapCandidates': r['overlapCandidates'],
                          'isolatedParts': [p for p in r['nearestComponents'] if p['nearest']['distanceMm'] > 0.001]}))

if __name__ == '__main__':
    main()
