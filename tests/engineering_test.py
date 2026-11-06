"""Numerical oracles, geometry fidelity and explicit failure boundaries."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import cadquery as cq
import numpy as np
import pytest
from cad.engineering import run
from cad.geometry import local_shape


def beam():
    return {"id":"beam","name":"Cantilever","shape":"box","size":[100,10,5],"position":[0,0,0],"color":"#5599ff","material":"Aluminum","process":"machine"}


def request():
    return {"type":"strength","source":{"designId":"oracle","revision":3,"snapshotHash":"fixture"},"part":beam(),"material":{"name":"Example aluminum","youngModulusMPa":70000,"poissonRatio":.3,"densityKgM3":2700},"supports":[{"axis":"x","side":"min"}],"loads":[{"axis":"x","side":"max","forceN":[0,0,-1]}],"mesh":{"maxSizeMm":4}}


@pytest.fixture(scope="module")
def baseline():
    return run(request())


def test_cantilever_oracle_and_equilibrium(baseline):
    assert baseline["status"] == "solved", baseline
    assert json.loads(json.dumps(baseline))["status"] == "solved"
    analytical = 1*100**3/(3*70000*(10*5**3/12))
    assert baseline["maxDisplacementMm"] == pytest.approx(analytical,rel=.02)
    assert baseline["reactionN"] == pytest.approx([0,0,1],abs=1e-7)
    assert np.linalg.norm(np.array(baseline["reactionMomentNmm"])+baseline["appliedMomentNmm"]) < 1e-6
    assert baseline["normalizedResidual"] < 1e-8
    assert baseline["diagnostics"]["meshVolumeRelativeError"] < 1e-8
    assert baseline["source"]["revision"] == 3
    assert baseline["fieldAssociations"] == {"displacement":"vertex","vonMises":"tetrahedron"}
    assert len(baseline["displacement"]) == len(baseline["mesh"]["vertices"])
    assert len(baseline["vonMises"]) == len(baseline["mesh"]["tets"])


def test_force_and_modulus_scaling(baseline):
    doubled = request(); doubled["loads"][0]["forceN"][2] = -2
    twice = run(doubled)
    stiffer = request(); stiffer["material"]["youngModulusMPa"] = 140000
    half = run(stiffer)
    assert twice["maxDisplacementMm"] == pytest.approx(2*baseline["maxDisplacementMm"],rel=1e-6)
    assert twice["maxVonMisesMPa"] == pytest.approx(2*baseline["maxVonMisesMPa"],rel=1e-6)
    assert half["maxDisplacementMm"] == pytest.approx(.5*baseline["maxDisplacementMm"],rel=1e-6)
    assert half["maxVonMisesMPa"] == pytest.approx(baseline["maxVonMisesMPa"],rel=1e-6)
    assert len({baseline["inputHash"],twice["inputHash"],half["inputHash"]}) == 3


def test_three_mesh_refinements():
    study=request(); study["mesh"]={"maxSizeMm":5,"refinements":2}
    result=run(study)
    assert result["status"] in ("solved","unconverged"), result
    levels=result["convergence"]["levels"]
    assert len(levels)==3
    assert levels[-1]["elements"] > levels[0]["elements"]
    assert result["convergence"]["displacementRelativeChange"] < .02
    assert all(level["volumeRelativeError"] < 1e-8 for level in levels)


def test_hole_geometry_is_not_filled():
    study=request();study["part"]["size"]=[60,6,20]
    study["part"]["holes"]=[{"x":0,"z":0,"diameter":8}]
    study["mesh"]={"maxSizeMm":3}
    result=run(study)
    assert result["status"]=="solved",result
    expected=60*6*20-np.pi*4**2*6
    assert result["diagnostics"]["sourceVolumeMm3"]==pytest.approx(expected)
    assert result["diagnostics"]["meshVolumeRelativeError"]<.015
    vertices=np.array(result["mesh"]["vertices"])
    centroids=vertices[np.array(result["mesh"]["tets"])].mean(axis=1)
    assert np.all(np.linalg.norm(centroids[:,[0,2]],axis=1)>3.5)


def test_step_import_equivalence_and_content_hash(baseline,tmp_path):
    filename=tmp_path/"source.step"
    cq.exporters.export(local_shape(beam()),str(filename))
    study=request();del study["part"]
    study["geometry"]={"path":str(filename),"format":"step","scaleToMm":1}
    imported=run(study)
    assert imported["status"]=="solved",imported
    assert imported["maxDisplacementMm"]==pytest.approx(baseline["maxDisplacementMm"],rel=.005)
    changed=beam();changed["size"][2]=6
    cq.exporters.export(local_shape(changed),str(filename))
    changed_result=run(study)
    assert changed_result["importedSourceHash"]!=imported["importedSourceHash"]
    assert changed_result["inputHash"]!=imported["inputHash"]


def test_unsupported_inputs_do_not_return_engineering_success():
    missing=request();del missing["material"]
    assert run(missing)["status"]=="needs_inputs"
    overlap=request();overlap["loads"][0]["side"]="min"
    assert run(overlap)["status"]=="needs_inputs"
    bad=request();bad["part"]["size"][2]=-1
    assert run(bad)["status"]=="invalid_geometry"
    disconnected=request();disconnected["supports"]=[]
    assert run(disconnected)["status"]=="needs_inputs"


def test_manufacturing_finds_actual_features():
    study={"type":"manufacturing","part":beam(),"profile":"cnc"}
    study["part"]["size"]=[20,8,10]
    study["part"]["channel"]={"width":2,"depth":7}
    result=run(study)
    assert result["status"]=="solved",result
    assert any(f["code"]=="channel-tool-access" and f["feature"]=="channel" for f in result["findings"])
    assert result["minimumSetupCount"]==2
    assert "example" in result["profileProvenance"]
    assert result["unassessed"]


def test_arm_and_rotary_oracles():
    study={"type":"mechanism","part":beam(),"material":{"densityKgM3":2700},"mechanism":{"kind":"arm","payloadKg":.5,"reachMm":100,"holdingTorqueNm":.1,"jointLimitsDeg":[-20,20],"angleDeg":30}}
    result=run(study)
    assert result["status"]=="solved",result
    assert result["payloadTorqueNm"]==pytest.approx(.5*9.80665*.1*np.cos(np.pi/6))
    assert not result["withinJointLimits"]
    assert {f["code"] for f in result["findings"]}=={"insufficient-holding-torque","joint-limit"}
    study["mechanism"]={"kind":"rotary","axis":"y","rpm":60,"accelerationSeconds":1,"availableTorqueNm":0}
    result=run(study)
    mass=100*10*5*1e-9*2700
    inertia=mass*(.1**2+.005**2)/12
    assert result["inertiaKgM2"]==pytest.approx(inertia,rel=1e-7)
    assert result["requiredDriveTorqueNm"]==pytest.approx(inertia*2*np.pi)
    assert result["findings"][0]["code"]=="insufficient-drive-torque"


@pytest.mark.parametrize("kind",["manufacturing","strength"])
def test_cli_input_file_and_revision_binding(tmp_path,kind):
    filename=tmp_path/"input.json"
    payload=request() if kind=="strength" else {"type":"manufacturing","source":{"designId":"demo","revision":4},"part":beam(),"profile":"fdm"}
    filename.write_text(json.dumps(payload))
    proc=subprocess.run([sys.executable,"-m","cad.engineering","--input",str(filename)],capture_output=True,text=True)
    assert proc.returncode==0,proc.stderr
    response=json.loads(proc.stdout.strip().splitlines()[-1])
    assert response["status"]=="solved"
    assert response["source"]==payload["source"]


@pytest.mark.parametrize("kind",["tube","counterbore","channel","sections","loop"])
def test_exact_feature_meshes_preserve_volume(kind):
    from cad.analysis.common import prepare_geometry
    from cad.analysis.strength import _mesh_geometry
    part=beam();part["size"]=[40,8,20]
    if kind=="tube":
        part.update(shape="tube",size=[20,10,20],holeDiameter=8)
    elif kind=="counterbore":
        part["holes"]=[{"x":0,"z":0,"diameter":4,"counterbore":{"diameter":8,"depth":3}}]
    elif kind=="channel":
        part["channel"]={"width":8,"depth":4}
    elif kind=="sections":
        part.update(shape="tube",size=[20,10,20],holeDiameter=8,sections=[{"height":5,"diameter":20,"bore":8},{"height":5,"diameter":12,"bore":8}])
    else:
        part.update(shape="tube",size=[60,5,20],holeDiameter=16,loopSpan=40)
    with tempfile.TemporaryDirectory() as folder:
        geometry=prepare_geometry({"part":part},folder)
        mesh,volume,error=_mesh_geometry(geometry,2.5,folder,0)
        assert mesh.nelements>0
        assert error < .02
        if kind in ("tube","sections"):
            centers=mesh.p[:,mesh.t].mean(axis=1).T
            assert np.min(np.linalg.norm(centers[:,[0,2]],axis=1))>3.7


def test_valid_stl_and_glb_transforms(baseline,tmp_path):
    import trimesh
    mesh=trimesh.creation.box(extents=[100,10,5])
    stl=tmp_path/"beam.stl";mesh.export(stl)
    study=request();del study["part"]
    study["geometry"]={"path":str(stl),"format":"stl","scaleToMm":1}
    result=run(study)
    assert result["status"]=="solved",result
    assert result["maxDisplacementMm"]==pytest.approx(baseline["maxDisplacementMm"],rel=.02)
    # A metre-based GLB node has a translation which must survive import.
    scene=trimesh.Scene()
    transform=np.eye(4);transform[:3,3]=[.02,.03,.04]
    scene.add_geometry(trimesh.creation.box(extents=[.1,.01,.005]),node_name="beam",transform=transform)
    glb=tmp_path/"beam.glb";scene.export(glb)
    study["type"]="manufacturing";study["profile"]="cnc"
    study["geometry"]={"path":str(glb),"format":"glb","scaleToMm":1000}
    imported=run(study)
    assert imported["status"]=="solved",imported
    assert imported["geometry"]["bounds"]["min"]==pytest.approx([-30,25,37.5],abs=1e-4)
    assert imported["geometry"]["volumeMm3"]==pytest.approx(5000,rel=1e-6)
    assert any("Imported freeform" in gap for gap in imported["unassessed"])


def test_open_and_intersecting_meshes_are_rejected(tmp_path):
    import trimesh
    mesh=trimesh.creation.box(extents=[20,10,5])
    mesh.update_faces(np.arange(len(mesh.faces)-1))
    path=tmp_path/"open.stl";mesh.export(path)
    study={"type":"manufacturing","geometry":{"path":str(path),"scaleToMm":1,"format":"stl"}}
    assert run(study)["status"]=="invalid_geometry"
    first=trimesh.creation.box(extents=[20,10,5]);second=first.copy();second.apply_translation([10,2,1])
    combined=trimesh.util.concatenate([first,second]);combined.export(path)
    response=run(study)
    assert response["status"]=="invalid_geometry",response
    assert "intersect" in response["error"]
