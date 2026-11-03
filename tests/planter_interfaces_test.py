"""Nominal mechanical/flow passages only: no leak, pump or watering performance inference."""
import itertools,json,subprocess
import cadquery as cq
import pytest
from cad.geometry import world_shape,bounds
from cad.documents import wiring_md
@pytest.fixture(scope='module')
def planters():
 code="""import {createDesign,deriveDesign} from './src/shared/engine.ts';console.log(JSON.stringify([[1,60,60],[1,150,120],[5,60,120],[5,150,60],[3,105.5,87.5]].map(([pots,potDiameter,reservoirHeight])=>{const design=createDesign('planter');Object.assign(design.params,{pots,potDiameter,reservoirHeight});return {design,derived:deriveDesign(design),history:[]}})));"""
 return json.loads(subprocess.check_output(['node','--import','tsx','--input-type=module','-e',code]))
def overlap(a,b):
 aa,bb=bounds(a),bounds(b)
 if any(min(aa['max'][i],bb['max'][i])-max(aa['min'][i],bb['min'][i])<1e-6 for i in range(3)):return 0
 return a.intersect(b).Volume()
@pytest.mark.parametrize('index',range(5))
def test_retained_parts_and_unblocked_water_passages(planters,index):
 s=planters[index];parts={p['id']:p for p in s['derived']['parts'] if p.get('role')!='reference'};sh={i:world_shape(p) for i,p in parts.items()};p=s['design']['params'];d=p['potDiameter'];n=p['pots'];H=p['reservoirHeight']+d*.65+10;M=H+35
 for (ai,a),(bi,b) in itertools.combinations(sh.items(),2):assert overlap(a,b)<1e-5,(index,ai,bi)
 for a,b in [('reservoir','wall-front'),('reservoir','wall-back'),('reservoir','wall-left'),('reservoir','wall-right'),('reservoir','pump-cradle'),('pump','pump-liner'),('pump-liner','pump-cradle'),('pump','pump-cap-0'),('pump','pump-cap-1'),('inlet','pump-outlet'),('inlet','inlet-tail'),('inlet-tail','manifold-lid'),('manifold','manifold-lid'),('manifold','manifold-cap-0'),('manifold','manifold-cap-1')]:assert sh[a].distance(sh[b])<1e-6,(a,b)
 for i in range(4):
  for a,b in [(f'support-{i}','reservoir'),(f'support-{i}','shelf'),(f'shelf-screw-{i}','shelf')]:assert sh[a].distance(sh[b])<1e-6,(a,b)
  assert bounds(sh[f'support-{i}'])['max'][1]-bounds(sh[f'shelf-screw-{i}'])['min'][1]==pytest.approx(8)
 for i in range(2):
  assert sh[f'manifold-support-{i}'].distance(sh['shelf'])<1e-6
  assert sh[f'manifold-support-{i}'].distance(sh['manifold-lid'])<1e-6
  for j in range(4):
   for a,b in [(f'pump-cap-{i}',f'pump-spacer-{j}'),(f'pump-cap-{i}',f'pump-screw-{i}-{j}')]:assert sh[a].distance(sh[b])<1e-6,(a,b)
 # Radius1 probes trace lumen from bought pump outlet through hose/header and each downward branch.
 px=parts['pump']['position'][0];z=parts['inlet']['position'][2];last=parts[f'pot-{n-1}']['position'][0]
 vertical=cq.Solid.makeCylinder(1,M+8-35.96,cq.Vector(px,35.96,z),cq.Vector(0,1,0))
 header=cq.Solid.makeCylinder(1,last-px,cq.Vector(px,M+8,z),cq.Vector(1,0,0))
 probes=[vertical,header]
 for i in range(n):
  x=parts[f'pot-{i}']['position'][0]
  probes += [cq.Solid.makeCylinder(1,M+8-(H+4),cq.Vector(x,H+4,z),cq.Vector(0,1,0)),cq.Solid.makeCylinder(1,H+3-6.01,cq.Vector(x,6.01,0),cq.Vector(0,1,0))]
  assert sh[f'pot-{i}'].distance(sh['shelf'])<1e-6
  assert sh[f'outlet-{i}'].distance(sh[f'outlet-tail-{i}'])<1e-6
  assert sh[f'outlet-tail-{i}'].distance(sh['manifold-lid'])<1e-6
  assert bounds(sh[f'outlet-{i}'])['min'][1]-bounds(sh[f'pot-{i}'])['max'][1]==pytest.approx(7)
  assert bounds(sh[f'pot-{i}'])['min'][1]-bounds(sh['wall-front'])['max'][1]==pytest.approx(4)
 for probe in probes:
  for identity,solid in sh.items():assert overlap(probe,solid)<1e-6,(index,identity,'blocked fluid passage')
 assert 42 > bounds(sh['pump'])['max'][1]
 assert p['reservoirHeight']-8 > bounds(sh['pump-outlet'])['max'][1]
 # A plug within the channel creates a detected blockage; omitted subtractive features cannot pass silently.
 plug=cq.Workplane('XY').box(2,8,8).translate(((px+last)/2,M+8,z)).val()
 assert overlap(header,plug)>1
 assert '3 V brushed DC' in wiring_md(s) and 'not measured delivered volume' in wiring_md(s)
