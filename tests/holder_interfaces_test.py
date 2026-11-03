"""Sampled nominal geometry/kinematics only; not grip, stiffness or manufacturing proof."""
import itertools,json,subprocess,math
import pytest
from cad.geometry import world_shape,bounds
@pytest.fixture(scope='module')
def holders():
 code="""import {createDesign,deriveDesign} from './src/shared/engine.ts';import {motionPose} from './src/lib/motion.ts';console.log(JSON.stringify([[50,10,6,-40,0],[50,125,12,40,0],[160,250,16,-40,0],[160,250,6,40,0],[91.5,118.5,10,17,0],[90,80,10,-40,10],[90,80,10,0,10],[90,80,10,40,10],[50,10,6,-40,2],[160,250,16,40,10]].map(([jawWidth,opening,screwDiameter,angle,time])=>{const design=createDesign('holder');Object.assign(design.params,{jawWidth,opening,screwDiameter,angle});const derived=deriveDesign(design);return {design,derived:{...derived,parts:derived.parts.map(p=>({...p,...motionPose(p,derived.parts,time)}))},time}})));"""
 return json.loads(subprocess.check_output(['node','--import','tsx','--input-type=module','-e',code]))
def overlap(a,b):
 aa,bb=bounds(a),bounds(b)
 if any(min(aa['max'][i],bb['max'][i])-max(aa['min'][i],bb['min'][i])<1e-6 for i in range(3)):return 0
 return a.intersect(b).Volume()
@pytest.mark.parametrize('index',range(10))
def test_guides_retention_contact_and_clearance(holders,index):
 s=holders[index];parts={p['id']:p for p in s['derived']['parts']};sh={i:world_shape(p) for i,p in parts.items()}
 for (ai,a),(bi,b) in itertools.combinations(sh.items(),2):assert overlap(a,b)<1e-5,(index,ai,bi)
 for a,b in [('base','yoke-front'),('base','yoke-rear'),('guide','ear--1'),('guide','ear-1'),('guide','jaw-fixed'),('guide','nut'),('guide','jaw-moving'),('jaw-fixed','pad-fixed'),('jaw-moving','pad-moving'),('jaw-moving','thrust-front'),('jaw-moving','thrust-rear'),('screw','thrust-rear'),('journal-retainer','thrust-front'),('journal-screw','journal-retainer'),('screw','handle')]:assert sh[a].distance(sh[b])<1e-6,(index,a,b,sh[a].distance(sh[b]))
 for side,ear in [('front','ear--1'),('rear','ear-1')]:
  for a,b in [(ear,'pivot-friction-'+side),('pivot-friction-'+side,'yoke-'+side),('yoke-'+side,'pivot-washer-'+side),('pivot-washer-'+side,'pivot-screw-'+side)]:assert sh[a].distance(sh[b])<1e-6,(index,a,b)
 for i in range(2):
  for sign in [-1,1]:
   assert sh[f'bushing-{i}-{sign}'].distance(sh['jaw-moving'])<1e-6
   assert sh[f'bushing-{i}-{sign}'].distance(sh[f'rod-{i}'])==pytest.approx(.0125,abs=1e-6)
   for a,b in [(f'rod-washer-{i}-{sign}',f'rod-{i}'),(f'rod-screw-{i}-{sign}',f'rod-washer-{i}-{sign}')]:assert sh[a].distance(sh[b])<1e-6
 assert sh['pad-fixed'].distance(sh['pad-moving'])==pytest.approx(s['design']['params']['opening']-min(s['time']*4,s['design']['params']['opening']-2,40),abs=1e-6)
 assert min(bounds(q)['min'][1] for i,q in sh.items() if i not in ['base','yoke-front','yoke-rear'])>12
 # An axially displaced thrust washer enters the jaw and must be detected.
 a=math.radians(s['design']['params']['angle']);assert overlap(sh['thrust-rear'].translate((-math.cos(a)*.2,-math.sin(a)*.2,0)),sh['jaw-moving'])>1
