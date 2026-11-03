"""Independent nominal conveyor contacts, sweep samples and broken-geometry controls."""
import copy,itertools,json,math,subprocess
from pathlib import Path
import pytest
from cad.geometry import world_shape,bounds
from cad.documents import wiring_md
ROOT=Path(__file__).resolve().parents[1]
@pytest.fixture(scope='module')
def conveyors():
 code="""import {createDesign,deriveDesign} from './src/shared/engine.ts';console.log(JSON.stringify([[250,70,30],[250,200,180],[900,70,780],[900,200,30],[500,120,200]].map(([length,beltWidth,sensorPosition])=>{const design=createDesign('conveyor');Object.assign(design.params,{length,beltWidth,sensorPosition});return {design,derived:deriveDesign(design),history:[]}})));"""
 return json.loads(subprocess.check_output(['node','--import','tsx','--input-type=module','-e',code],cwd=ROOT))
@pytest.fixture(scope='module')
def models(conveyors):return [{p['id']:world_shape(p) for p in s['derived']['parts'] if p.get('role')!='reference'} for s in conveyors]
def overlap(a,b):
 aa,bb=bounds(a),bounds(b)
 if any(min(aa['max'][i],bb['max'][i])-max(aa['min'][i],bb['min'][i])<1e-6 for i in range(3)):return 0
 return a.intersect(b).Volume()
@pytest.mark.parametrize('index',range(5))
def test_only_explicit_motor_screw_engagement_intersects(models,index):
 for (aid,a),(bid,b) in itertools.combinations(models[index].items(),2):
  v=overlap(a,b)
  allowed=any(m in {aid,bid} and any(n.startswith(m+'-screw-') for n in (aid,bid)) for m in ['motor','gate-motor'])
  if allowed:assert v==pytest.approx(math.pi*1.5**2*2,abs=1e-6)
  else:assert v<1e-5,(index,aid,bid,v)
@pytest.mark.parametrize('index',range(5))
def test_gate_sweep_keeps_attached_parts_clear_of_fixed_assembly(models,conveyors,index):
 s=conveyors[index];sh=models[index];hub=next(p for p in s['derived']['parts'] if p['id']=='diverter');pivot=hub['position'];moving=[p['id'] for p in s['derived']['parts'] if p['id']=='diverter' or p.get('parentId')=='diverter']
 for angle in [0,15,30,45,60]:
  for aid in moving:
   a=sh[aid].rotate(tuple(pivot),(pivot[0],pivot[1]+1,pivot[2]),angle)
   for bid,b in sh.items():
    if bid not in moving:assert overlap(a,b)<1e-5,(index,angle,aid,bid)
def test_bearing_belt_frame_and_gate_contacts(models,conveyors):
 sh=models[4];s=conveyors[4]
 for name in ['in','out']:
  assert sh['belt'].distance(sh['roller-'+name])<1e-6
  for sign in [-1,1]:
   key=f'{name}-{sign}'
   for a,b in [(key+'-bearing',key+'-shoulder'),(key+'-bearing',key+'-retainer'),(key+'-bearing',key+'-inner-spacer'),(key+'-bearing',key+'-outer-spacer'),(key+'-collar',key+'-outer-spacer'),(key+'-inner-spacer','roller-'+name)]:assert sh[a].distance(sh[b])<1e-6,(a,b)
   assert sh[key+'-bearing'].distance(sh[key+'-seat'])==pytest.approx(.05,abs=1e-6)
 for a,b in [('bed','belt'),('bed','bed-beam-0'),('base','frame-front'),('base','frame-rear'),('base','motor-plate'),('gate-post','gate-mount'),('sensor-post','sensor-platform'),('sensor-platform','sensor-bracket'),('sensor','sensor-bracket'),('diverter','gate-arm'),('gate-arm','gate-blade')]:assert sh[a].distance(sh[b])<1e-6,(a,b)
 # Lowering the belt creates real drum interference; the oracle must catch it.
 assert overlap(sh['belt'].translate((0,-1,0)),sh['roller-in'])>1
 assert 'H-bridge' in wiring_md(s) and '12–24 V NPN' in wiring_md(s)
 # Coupling insertion: 8mm from motor side, 14mm from roller side, below14.7 limit.
 assert bounds(sh['motor-shaft'])['max'][2]-bounds(sh['coupling'])['min'][2]==pytest.approx(8)
 assert bounds(sh['coupling'])['max'][2]-bounds(sh['roller-out'])['min'][2]==pytest.approx(14)
def test_adjustable_idler_cartridges_retain_clearance_and_washers(models):
 sh=models[4]
 for sign in [-1,1]:
  key=f'in-{sign}'
  for dx in [-1,0,1]:
   for part in ['shoulder','seat','retainer']:
    moved=sh[key+'-'+part].translate((dx,0,0))
    for i in range(3):assert overlap(moved,sh[key+f'-screw-{i}'])<1e-6
   for i in range(3):assert sh[key+'-retainer'].translate((dx,0,0)).distance(sh[key+f'-washer-{i}'])<1e-6
   assert 4.5-(2.75+abs(dx))>=.75
  assert overlap(sh[key+'-seat'].translate((1.5,0,0)),sh[key+'-screw-0'])>0.01
