"""Exact lamp clearance/contact checks; no inference of physical holding or lighting performance."""
import copy,itertools,json,subprocess,math
import pytest
from cad.geometry import world_shape,bounds
from cad.documents import wiring_md
@pytest.fixture(scope='module')
def lamps():
 code="""import {createDesign,deriveDesign} from './src/shared/engine.ts';console.log(JSON.stringify([[150,100,15],[150,250,80],[550,200,15],[550,250,80],...[15,30,45,60,80].map(a=>[300,160,a])].map(([reach,baseDiameter,angle])=>{const design=createDesign('lamp');Object.assign(design.params,{reach,baseDiameter,angle});return {design,derived:deriveDesign(design),history:[]}})));"""
 return json.loads(subprocess.check_output(['node','--import','tsx','--input-type=module','-e',code]))
def overlap(a,b):
 aa,bb=bounds(a),bounds(b)
 if any(min(aa['max'][i],bb['max'][i])-max(aa['min'][i],bb['min'][i])<1e-6 for i in range(3)):return 0
 return a.intersect(b).Volume()
@pytest.mark.parametrize('index',range(9))
def test_clearance_contacts_and_retention_at_accepted_poses(lamps,index):
 s=lamps[index];sh={p['id']:world_shape(p) for p in s['derived']['parts']}
 for (aid,a),(bid,b) in itertools.combinations(sh.items(),2):assert overlap(a,b)<1e-5,(index,aid,bid)
 for a,b in [('base-pad','base'),('base','base-foot'),('base-foot','pivot-lower'),('head-lug','head-cap'),('head-cap','shade'),('head-cap','spreader'),('spreader','thermal-pad'),('thermal-pad','led'),('shade','diffuser-retainer'),('diffuser','diffuser-retainer')]:assert sh[a].distance(sh[b])<1e-6,(a,b)
 for key,a,b in [('base-joint','pivot-lower','lower-arm'),('elbow-joint','lower-arm','upper-arm'),('head-joint','upper-arm','head-lug')]:
  for first,second in [(a,key+'-friction'),(b,key+'-friction'),(a,key+'-washer-front'),(b,key+'-washer-rear'),(key+'-screw',key+'-washer-front'),(key+'-washer-rear',key+'-nut')]:assert sh[first].distance(sh[second])<1e-6,(first,second)
  assert bounds(sh[key+'-screw'])['max'][2]-bounds(sh[key+'-nut'])['max'][2]==pytest.approx(2.8)
 # Deliberately moving the adhesive into the spreader must be caught.
 assert overlap(sh['thermal-pad'].translate((0,.1,0)),sh['spreader'])>1
 # Clear housing cavity and cap exit; diffuser is radially clear, axially retained.
 assert sh['diffuser'].distance(sh['shade'])==pytest.approx(.5,abs=1e-6)
 assert bounds(sh['diffuser-retainer'])['min'][1]>bounds(sh['base'])['max'][1]
 assert '5 V DC' in wiring_md(s) and 'not an external constant-current' in wiring_md(s)
