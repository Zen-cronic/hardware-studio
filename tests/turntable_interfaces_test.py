"""Exact nominal assembly checks; not physical fit/load certification."""
import copy
import itertools
import json
import math
import subprocess
from pathlib import Path

import pytest
from cad.geometry import bounds, world_shape, local_shape, analytic_volume, DesignError
from cad.documents import drawing_svg, wiring_md

ROOT = Path(__file__).resolve().parents[1]

@pytest.fixture(scope="module")
def turntables():
    code = """
import {createDesign,deriveDesign,validateParts} from './src/shared/engine.ts';
console.log(JSON.stringify([[120,180],[400,180],[120,220],[400,220],[220,180]].map(([diameter,height])=>{
const design=createDesign('turntable'); Object.assign(design.params,{diameter,height});
const derived=deriveDesign(design); validateParts(derived.parts);return {design,derived,history:[]};})));
"""
    return json.loads(subprocess.run(["node","--import","tsx","--input-type=module","-e",code],cwd=ROOT,capture_output=True,text=True,check=True).stdout)

def overlap(a,b):
    ba,bb=bounds(a),bounds(b)
    if any(min(ba['max'][i],bb['max'][i])-max(ba['min'][i],bb['min'][i]) < 1e-6 for i in range(3)): return 0
    return a.intersect(b).Volume()

def unintended(parts, shapes):
    failures=[]
    for a,b in itertools.combinations(parts,2):
        # The supplier explicitly provides six M3 blind holes; the conservative
        # body envelope omits them. Only 2 mm of the mounting shank enters it.
        pair={a['id'],b['id']}
        if 'motor' in pair and any(q.startswith('motor-screw-') and not q.endswith('-head') for q in pair): continue
        v=overlap(shapes[a['id']],shapes[b['id']])
        if v>1e-5: failures.append((a['id'],b['id'],v))
    return failures

@pytest.mark.parametrize('index',range(5))
def test_standard_assembly_has_no_unreviewed_interference(turntables,index):
    parts=[p for p in turntables[index]['derived']['parts'] if p.get('role')!='reference']
    shapes={p['id']:world_shape(p) for p in parts}
    assert not unintended(parts,shapes)

@pytest.mark.parametrize('degrees',[0,45,90,135,180,270])
def test_rotating_assembly_clears_stationary_parts(turntables,degrees):
    parts=[p for p in turntables[4]['derived']['parts'] if p.get('role')!='reference']
    rotating=[p for p in parts if p.get('motion') or p.get('parentId')=='platter']
    fixed=[p for p in parts if p not in rotating]
    fixed_shapes={p['id']:world_shape(p) for p in fixed}
    for p in rotating:
        shape=world_shape(p).rotate((0,0,0),(0,1,0),degrees)
        for q in fixed:
            assert overlap(shape,fixed_shapes[q['id']])<1e-5,(degrees,p['id'],q['id'])

def test_seats_retention_clearances_and_negative_controls(turntables):
    snapshot=turntables[4]; p={p['id']:p for p in snapshot['derived']['parts']}
    s={k:world_shape(v) for k,v in p.items()}
    for name in ['lower','upper']:
        assert s[name+'-bearing'].distance(s[name+'-seat']) == pytest.approx(.05,abs=1e-6)
        assert s[name+'-bearing'].distance(s[name+'-support']) < 1e-6
        assert s[name+'-bearing'].distance(s[name+'-retainer']) < 1e-6
        assert s['shaft'].distance(s[name+'-support']) == pytest.approx(5,abs=1e-6)
        assert s[name+'-retainer'].distance(s[name+'-screw-0-head']) < 1e-6
    for i in range(6):
        # The only allowed intersections equal a 3 mm shank entering the
        # manufacturer's blind threaded face hole by exactly 2 mm, not 3+ mm.
        screw=s[f'motor-screw-{i}']
        assert overlap(screw,s['motor']) == pytest.approx(math.pi*1.5**2*2,abs=1e-6)
        assert overlap(screw.translate((0,-2,0)),s['motor']) > math.pi*1.5**2*3
    for i in range(3):
        for spacer,below,above in [('lower','base-floor','motor-plate'),('middle','motor-plate','lower-support'),('upper','lower-support','upper-support')]:
            assert s[f'post-{spacer}-{i}'].distance(s[below]) < 1e-6
            assert s[f'post-{spacer}-{i}'].distance(s[above]) < 1e-6
    assert s['coupling'].distance(s['collar']) == pytest.approx(2.2,abs=1e-6)
    assert s['motor'].distance(s['coupling']) == pytest.approx(8,abs=1e-6)
    assert s['motor-shaft'].distance(s['shaft']) == pytest.approx(11,abs=1e-6)
    assert s['shaft'].distance(s['platter']) < 1e-6
    assert s['platter-cover'].distance(s['platter-screw-0-head']) == pytest.approx(.5,abs=1e-6)
    assert s['platter-cover'].distance(s['product']) < 1e-6
    assert all(overlap(s['product'],shape)<1e-5 for key,shape in s.items() if key!='product')
    assert s['collar'].distance(s['lower-support']) == pytest.approx(1,abs=1e-6)
    # Collision oracle must catch a misplaced motor, not just confirm valid solids.
    broken=copy.deepcopy(p['motor']); broken['position'][1]+=70
    bad=world_shape(broken)
    assert overlap(bad,s['shaft'])>1
    # Retention oracle must catch a missing contact even when solids do not overlap.
    displaced=s['upper-retainer'].translate((0,2,0))
    assert displaced.distance(s['upper-bearing']) == pytest.approx(2,abs=1e-6)

def test_features_and_output_descriptions_agree(turntables):
    snap=turntables[4]
    for p in snap['derived']['parts']:
        assert local_shape(p).Volume()==pytest.approx(analytic_volume(p),rel=1e-8)
        svg=drawing_svg(p,3)
        for i,_ in enumerate(p.get('holes',[]),1): assert f'Hole {i}:' in svg
        for _ in p.get('sections',[]): assert 'Axial Y' in svg
    wiring=wiring_md(snap)
    assert '8400 counts' in wiring and 'STEP/DIR' not in wiring
    assert {r['id'] for r in snap['derived']['bom']}.isdisjoint({'motor-pilot','motor-shaft','motor-screw-0-head'})
    assert any('pololu.com/product/4756' in r.get('sourceUrl','') for r in snap['derived']['bom'])

@pytest.mark.parametrize('mutation',[{'sections':[{'height':2,'diameter':40,'bore':0}]},{'holes':[{'x':19,'z':0,'diameter':4}]},{'holes':[{'x':12,'z':0,'diameter':4},{'x':12,'z':0,'diameter':4}]}])
def test_reject_malformed_features(mutation):
    part={'id':'p','name':'Test','shape':'cylinder','size':[40,10,40],'position':[0,0,0],'material':'Steel','color':'#888888','process':'machine',**mutation}
    with pytest.raises(DesignError): local_shape(part)
