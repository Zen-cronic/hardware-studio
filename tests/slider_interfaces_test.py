"""Nominal slider interface oracles, including deliberate broken-geometry controls."""
import copy,itertools,json,math,subprocess
from pathlib import Path
import pytest
from cad.geometry import world_shape,local_shape,bounds
from cad.documents import wiring_md,drawing_svg
ROOT=Path(__file__).resolve().parents[1]
@pytest.fixture(scope='module')
def sliders():
    code="""import {createDesign,deriveDesign} from './src/shared/engine.ts';
console.log(JSON.stringify([[150,60,50],[150,180,150],[1000,60,50],[1000,180,150],[500,100,75]].map(([travel,railSpacing,cameraWidth])=>{const design=createDesign('slider');Object.assign(design.params,{travel,railSpacing,cameraWidth});return {design,derived:deriveDesign(design),history:[]};})));"""
    return json.loads(subprocess.run(['node','--import','tsx','--input-type=module','-e',code],cwd=ROOT,text=True,capture_output=True,check=True).stdout)
@pytest.fixture(scope='module')
def models(sliders):
    return [{p['id']:world_shape(p) for p in s['derived']['parts'] if p.get('role')!='reference'} for s in sliders]
def overlap(a,b):
    aa,bb=bounds(a),bounds(b)
    if any(min(aa['max'][i],bb['max'][i])-max(aa['min'][i],bb['min'][i])<1e-6 for i in range(3)): return 0
    return a.intersect(b).Volume()
@pytest.mark.parametrize('index',range(5))
def test_static_interference_has_only_documented_motor_screw_entry(models,index):
    for (aid,a),(bid,b) in itertools.combinations(models[index].items(),2):
        v=overlap(a,b)
        if 'drive' in {aid,bid} and any(n.startswith('motor-screw-') for n in (aid,bid)):
            # Supplier body envelope omits four M3 blind holes, min4.5 deep.
            assert v==pytest.approx(math.pi*1.5**2*2,abs=1e-6)
        else: assert v<1e-5,(index,aid,bid,v)
@pytest.mark.parametrize('index',[0,1,2,3,4])
def test_full_carriage_sweep(models,sliders,index):
    snapshot=sliders[index]; travel=snapshot['design']['params']['travel'];sh=models[index]
    moving=[p['id'] for p in snapshot['derived']['parts'] if p['id']=='carriage' or (p.get('parentId')=='carriage' and p.get('role')!='reference')]
    fixed={k:v for k,v in sh.items() if k not in moving}
    for x in [-travel/2,-travel/4,0,travel/4,travel/2]:
        for aid in moving:
            a=sh[aid].translate((x,0,0))
            for bid,b in fixed.items():assert overlap(a,b)<1e-5,(index,x,aid,bid)
    for sign in (-1,1):
        end=sh['carriage'].translate((sign*travel/2,0,0))
        for side in (-1,1):assert end.distance(sh[f'stop-{sign}-{side}'])<1e-6
    # Overtravel must be detected by the actual stop geometry.
    assert overlap(sh['carriage'].translate((travel/2+1,0,0)),sh['stop-1-1'])>1

def test_guides_fasteners_pulleys_and_camera_have_contact_and_clearance(models,sliders):
    sh=models[4];p={p['id']:p for p in sliders[4]['derived']['parts']}
    for name in ['front','rear']:
        assert sh[f'block-{name}'].distance(sh[f'rail-{name}'])==pytest.approx(.1,abs=1e-6)
        assert sh['carriage'].distance(sh[f'block-{name}'])<1e-6
        assert sh[f'rail-{name}'].distance(sh[f'riser-{name}'])<1e-6
        assert sh[f'riser-{name}'].distance(sh['base'])<1e-6
        assert sh[f'rail-screw-{name}-0'].distance(sh[f'rail-{name}'])<1e-6
    assert overlap(sh['block-front'].translate((0,-1,0)),sh['rail-front'])>1
    for name in ['inner','outer']:
        assert sh[f'belt-clamp-{name}'].distance(sh['belt'])<1e-6
        assert sh[f'belt-clamp-{name}'].distance(sh['carriage'])<1e-6
    assert sh['belt'].distance(sh['carriage'])==pytest.approx(3.85,abs=1e-6)
    for name in ['lower','upper']:
        assert sh[f'idler-bearing-{name}'].distance(sh[f'idler-spacer-{name}'])<1e-6
        assert sh[f'idler-bearing-{name}'].distance(sh['idler'])<1e-6
    assert sh['idler-axle'].distance(sh['idler-spacer-upper'])<1e-6
    assert sh['camera-screw'].distance(sh['carriage'])<1e-6
    assert bounds(sh['camera-screw'])['max'][1]-bounds(sh['carriage'])['max'][1]==pytest.approx(4)
    assert min(bounds(sh['drive-shaft'])['max'][1],bounds(sh['drive-pulley'])['max'][1])-max(bounds(sh['drive-shaft'])['min'][1],bounds(sh['drive-pulley'])['min'][1])==pytest.approx(9)
    assert p['guide-screw-0']['position'][1]-p['guide-screw-0']['size'][1]/2==pytest.approx(74) # 3mm into77 top
    assert '200/60 full steps per mm' in wiring_md(sliders[4])

def test_tension_plate_retains_washer_coverage_at_adjustment_limits(models):
    sh=models[4]
    for dx in (-2,0,2):
        plate=sh['tension-plate'].translate((dx,0,0))
        assert plate.distance(sh['base'])<1e-6
        for i in range(4):
            assert overlap(plate,sh[f'tension-screw-{i}'])<1e-6
            assert plate.distance(sh[f'tension-washer-{i}'])<1e-6
        assert 12/2-(7/2+abs(dx))>=.5
    assert overlap(sh['tension-plate'].translate((2.2,0,0)),sh['tension-screw-0'])>0.01


def test_manufactured_thread_envelopes_are_identified_on_drawings(sliders):
    p={p['id']:p for p in sliders[4]['derived']['parts']}
    for name,mark in [('base','M3 thread envelopes'),('tension-plate','M5 centre-thread envelope'),('belt-clamp-inner','M3 thread envelopes'),('foot-1-1','M4-tapped')]:
        assert mark in drawing_svg(p[name],1)
