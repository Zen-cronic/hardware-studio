"""Measured reconstruction: original identity, complete fit and honest unsupported geometry."""
from copy import deepcopy
import hashlib,json,subprocess,sys
import cadquery as cq
import numpy as np
import pytest
import trimesh
from cad.geometry import local_shape,world_shape
from cad.reconstruction import run,tessellate,verify


def plate():
 return {'id':'plate','name':'Source plate','shape':'box','size':[40,8,20],'position':[0,0,0],'color':'#72a6d7','material':'Aluminum','process':'machine','holes':[{'x':-8,'z':0,'diameter':4},{'x':8,'z':0,'diameter':4,'counterbore':{'diameter':7,'depth':3}}]}


def reconstruct(path,scale=1,index=0,tolerance=.1):
 return run({'action':'reconstruct','geometry':{'path':str(path),'format':path.suffix[1:],'scaleToMm':scale},'bodyIndex':index,'toleranceMm':tolerance})


def test_step_rotated_holes_counterbore_and_real_shrink(tmp_path):
 part=plate();part.update(rotation=[.4,.3,.2],position=[20,30,-10]);source=world_shape(part);path=tmp_path/'rotated.step';cq.exporters.export(source,str(path));original=path.read_bytes()
 result=reconstruct(path)
 assert result['status']=='reconstructed',result
 assert result['sourceHash']==hashlib.sha256(original).hexdigest()
 assert result['fit']['volume']['relativeDifference']<1e-8
 candidate=result['candidate'];assert len(candidate['holes'])==2
 assert sorted(h['diameter'] for h in candidate['holes'])==[4,4]
 assert next(h['counterbore'] for h in candidate['holes'] if 'counterbore'in h)==pytest.approx({'diameter':7,'depth':3})
 for diameter in [2,5]:
  changed=deepcopy(candidate);hole=next(h for h in changed['holes'] if 'counterbore'not in h);hole['diameter']=diameter
  actual=world_shape(changed);expected=source.Volume()+np.pi*(4**2-diameter**2)/4*8
  assert actual.Volume()==pytest.approx(expected,rel=1e-8)
 thicker=deepcopy(candidate);thicker['size'][1]=10
 assert world_shape(thicker).Volume()>source.Volume()
 assert path.read_bytes()==original


@pytest.mark.parametrize('format',['stl','obj','glb'])
def test_mesh_holes_and_counterbore_measured_fit(tmp_path,format):
 mesh=tessellate(local_shape(plate()),.01);scale=1000 if format=='glb' else 1
 if scale==1000:mesh.apply_scale(.001)
 path=tmp_path/('plate.'+format);mesh.export(str(path));result=reconstruct(path,scale)
 assert result['status']=='reconstructed',result
 assert result['fit']['accepted'];assert result['fit']['volume']['method'].startswith('65536')
 assert result['fit']['surface']['sampledMaxMm']<.1
 assert len(result['candidate']['holes'])==2
 assert sorted(h['diameter'] for h in result['candidate']['holes'])==pytest.approx([4,4],abs=1e-4)


def test_tube_and_plain_cylinder_step(tmp_path):
 for name,bore in [('tube',8),('cylinder',None)]:
  part=plate();part.update(shape=name,size=[20,25,20]);part.pop('holes')
  if bore:part['holeDiameter']=bore
  path=tmp_path/(name+'.step');cq.exporters.export(local_shape(part),str(path));result=reconstruct(path)
  assert result['status']=='reconstructed',result
  assert result['candidate']['shape']==name
  if bore:assert result['candidate']['holeDiameter']==8


def test_glb_body_selection_transforms_and_units(tmp_path):
 scene=trimesh.Scene();a=trimesh.creation.box([.04,.008,.02]);b=trimesh.creation.box([.02,.01,.01]);transform=trimesh.transformations.rotation_matrix(.4,[0,0,1]);transform[:3,3]=[.05,.03,.02]
 scene.add_geometry(a,node_name='placed plate',transform=transform);scene.add_geometry(b,node_name='other body');path=tmp_path/'placed.glb';scene.export(str(path))
 inspect=run({'geometry':{'path':str(path),'format':'glb','scaleToMm':1000}})
 assert inspect['bodyCount']==2
 index=next(b['index'] for b in inspect['bodies'] if b['name']=='placed plate');result=reconstruct(path,1000,index)
 assert result['status']=='reconstructed',result
 assert result['candidate']['position']==pytest.approx([50,30,20],abs=.001)
 assert sorted(result['candidate']['size'])==pytest.approx([8,20,40],abs=.001)
 assert result['bodies'][index]['transform'][0][3]==pytest.approx(.05)


def test_unsupported_details_preserve_source_preview(tmp_path):
 rounded=cq.Workplane('XY').box(40,20,8).edges().fillet(1).val();path=tmp_path/'rounded.step';cq.exporters.export(rounded,str(path));result=reconstruct(path)
 assert result['status']=='analysis_only';assert result['preview']['faces'];assert not result.get('candidate')
 box=cq.Workplane('XY').box(40,20,8).val();cross=cq.Solid.makeCylinder(2,50,cq.Vector(-25,0,0),cq.Vector(1,0,0));vertical=cq.Solid.makeCylinder(2,20,cq.Vector(8,0,-10),cq.Vector(0,0,1));path=tmp_path/'mixed.step';cq.exporters.export(box.cut(cross).cut(vertical),str(path));result=reconstruct(path)
 assert result['status']=='analysis_only';assert 'Mixed-axis' in result['error']


def test_open_and_coarse_mesh_cannot_be_accepted(tmp_path):
 mesh=trimesh.creation.box([40,8,20]);mesh.update_faces(np.arange(len(mesh.faces)-1));path=tmp_path/'open.stl';mesh.export(str(path));result=reconstruct(path)
 assert result['status']=='invalid_geometry';assert not result.get('candidate')
 mesh=trimesh.creation.cylinder(10,8,sections=8);path=tmp_path/'coarse.stl';mesh.export(str(path));result=reconstruct(path,tolerance=.001)
 assert result['status']!='reconstructed';assert not result.get('candidate')


def test_equal_volume_different_hole_location_fails_surface_and_volume_fit():
 source=plate();source['holes']=[{'x':-8,'z':0,'diameter':4}];candidate=deepcopy(source);candidate['holes'][0]['x']=8
 shape=local_shape(source);body={'shape':shape,'mesh':tessellate(shape,.01)}
 assert world_shape(candidate).Volume()==pytest.approx(shape.Volume())
 result,_=verify(body,candidate,.1)
 assert not result['accepted'];assert result['surface']['sampledMaxMm']>.1
 assert result['volume']['relativeDifference']>.01


def test_cli_emits_source_bound_json_and_missing_units(tmp_path):
 path=tmp_path/'plate.step';cq.exporters.export(local_shape(plate()),str(path));input_path=tmp_path/'input.json';payload={'action':'reconstruct','geometry':{'path':str(path),'format':'step','scaleToMm':1},'toleranceMm':.1};input_path.write_text(json.dumps(payload));result=subprocess.run([sys.executable,'-m','cad.reconstruction','--input',str(input_path)],capture_output=True,text=True)
 assert result.returncode==0,result.stderr
 parsed=json.loads(result.stdout.strip().splitlines()[-1]);assert len(parsed['inputHash'])==64;assert parsed['status']=='reconstructed'
 payload['geometry'].pop('scaleToMm');invalid=run(payload);assert invalid['status']=='needs_inputs'
