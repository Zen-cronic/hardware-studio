from __future__ import annotations

import copy
import hashlib
import json
import math
import struct
import subprocess
import sys
import zipfile
from pathlib import Path

import cadquery as cq
import pytest

from cad.build import build_package, input_hash, manufacturing_parts
from cad.geometry import DesignError, analytic_volume, bounds, local_shape, validate_snapshot, world_shape

ROOT = Path(__file__).resolve().parents[1]
KINDS = ["turntable", "slider", "conveyor", "lamp", "planter", "holder"]


@pytest.fixture(scope="session")
def snapshots():
    code = """
import {createDesign, deriveDesign} from './src/shared/engine.ts';
const edits={turntable:[['diameter',240],['shaftDiameter',9]],slider:[['travel',550],['railSpacing',110]],conveyor:[['length',550],['sensorPosition',210]],lamp:[['reach',325],['angle',50]],planter:[['pots',4],['reservoirHeight',80]],holder:[['opening',90],['jawWidth',100]]};
const out={};
for(const [kind,changes] of Object.entries(edits)){
 const base=createDesign(kind); out[kind]=[{design:base,derived:deriveDesign(base),history:[]}];
 for(const [key,value] of changes){const d=structuredClone(base);d.params[key]=value;d.revision++;out[kind].push({design:d,derived:deriveDesign(d),history:[]});}
}
console.log(JSON.stringify(out));
"""
    result = subprocess.run(["node", "--import", "tsx", "--input-type=module", "-e", code], cwd=ROOT, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


@pytest.fixture
def primitive():
    return {"id": "test-part", "name": "Test component", "shape": "box", "size": [30, 20, 10], "position": [0, 0, 0], "material": "Aluminium 6061", "color": "#C8CDD1", "process": "machine"}


def custom_snapshot(part):
    return {"design": {"id": "custom-test", "kind": "custom", "name": "Custom bracket", "revision": 3, "params": {"scale": 1}, "customParts": [part], "createdAt": "2026-11-02T00:00:00Z", "updatedAt": "2026-11-02T00:00:00Z"}, "derived": {"parts": [part], "bom": [{"id": part["id"], "name": part["name"], "quantity": 1, "material": part["material"], "process": part["process"], "specification": "Test size"}], "steps": [{"id": "place", "title": "Place part", "instruction": "Place at origin.", "partIds": [part["id"]], "check": "Stable."}], "connections": [], "metrics": [], "warnings": []}, "history": []}


@pytest.mark.parametrize("kind", KINDS)
def test_every_example_exports_reopened_exact_geometry(kind, snapshots, tmp_path):
    snapshot = snapshots[kind][0]
    result = build_package(snapshot, tmp_path / kind)
    output = Path(result["archive"]).parent
    manifest = json.loads(Path(result["manifest"]).read_text())
    assert manifest["designId"] == snapshot["design"]["id"]
    assert manifest["revision"] == snapshot["design"]["revision"]
    assert manifest["units"] == "mm"
    assert manifest["assemblyVerification"]["valid"] is True
    assert manifest["assemblyVerification"]["solids"] == len(manufacturing_parts(snapshot))
    assert len(manifest["parts"]) == len(manufacturing_parts(snapshot))
    assert manifest["artifacts"]
    for entry in manifest["artifacts"]:
        data = (output / entry["path"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == entry["sha256"]
        assert len(data) == entry["bytes"]
    with zipfile.ZipFile(result["archive"]) as archive:
        assert archive.testzip() is None
        assert {"design.json", "source.py", "assembly.step", "assembly.glb", "bom.csv", "assembly.md", "wiring.md", "process-notes.md", "quote-request.md", "manifest.json", "parametric/engine.ts", "parametric/catalog.ts", "parametric/recalculate.ts"} <= set(archive.namelist())
        assert all(not name.startswith("/") and ".." not in Path(name).parts for name in archive.namelist())
    for part in manifest["parts"]:
        assert part["verification"]["maxBoundsDeltaMm"] <= 0.0001
        assert part["verification"]["solids"] == 1
        assert "MILLI" in (output / part["files"]["step"]).read_text()
    bom = (output / "bom.csv").read_text()
    for identity in manifest["excludedReferences"]:
        assert f",{identity}," not in bom
        assert not any(part["id"] == identity for part in manifest["parts"])
    raw = (output / "assembly.glb").read_bytes()
    length = struct.unpack_from("<I", raw, 12)[0]
    doc = json.loads(raw[20:20+length])
    root = doc["nodes"][doc["scenes"][doc.get("scene", 0)]["nodes"][0]]
    assert root["scale"] == [0.001, 0.001, 0.001]
    # Identical input is idempotent and does not overwrite accepted artifacts.
    assert build_package(snapshot, output) == result


@pytest.mark.parametrize("kind", KINDS)
def test_two_heldout_changes_propagate_into_valid_solids(kind, snapshots):
    baseline, first, second = snapshots[kind]
    for changed in (first, second):
        assert input_hash(changed) != input_hash(baseline)
        assert changed["derived"]["parts"] != baseline["derived"]["parts"]
        # A pose/sensor placement edit changes geometry and instructions without buying new parts.
        before_specs = [(p["id"], p["size"], p.get("holeDiameter")) for p in manufacturing_parts(baseline)]
        after_specs = [(p["id"], p["size"], p.get("holeDiameter")) for p in manufacturing_parts(changed)]
        if before_specs != after_specs:
            assert changed["derived"]["bom"] != baseline["derived"]["bom"]
        else:
            assert changed["derived"]["bom"] == baseline["derived"]["bom"]
            assert changed["derived"]["metrics"] != baseline["derived"]["metrics"]
        for part in manufacturing_parts(changed):
            shape = local_shape(part)
            assert shape.isValid()
            assert shape.Volume() == pytest.approx(analytic_volume(part), rel=1e-8)
            assert bounds(shape)["size"] == pytest.approx(part["size"], abs=1e-6)
    broken = copy.deepcopy(first)
    broken["derived"]["parts"][0]["size"][0] = -1
    with pytest.raises(DesignError):
        validate_snapshot(broken)


def test_xyz_euler_rotation_matches_threejs_matrix(primitive):
    part = {**primitive, "rotation": [0.3, 0.5, 0.7], "position": [100, 200, 300]}
    actual = bounds(world_shape(part))
    x, y, z = part["rotation"]
    a,b,c,d,e,f = math.cos(x),math.sin(x),math.cos(y),math.sin(y),math.cos(z),math.sin(z)
    matrix = [[c*e,-c*f,d],[a*f+b*e*d,a*e-b*f*d,-b*c],[b*f-a*e*d,b*e+a*f*d,a*c]]
    extents = [sum(abs(matrix[i][j]) * part["size"][j] / 2 for j in range(3)) for i in range(3)]
    assert actual["min"] == pytest.approx([part["position"][i]-extents[i] for i in range(3)], abs=1e-6)
    assert actual["max"] == pytest.approx([part["position"][i]+extents[i] for i in range(3)], abs=1e-6)


@pytest.mark.parametrize("shape", ["box", "cylinder", "tube"])
def test_two_dimension_edits_each_primitive_and_invalid_input(shape, primitive):
    part = {**primitive, "shape": shape, "size": [30, 20, 30]}
    if shape == "tube":
        part["holeDiameter"] = 12
    before = analytic_volume(part)
    for size in ([35, 20, 35], [30, 25, 30]):
        edited = {**part, "size": size}
        assert local_shape(edited).Volume() == pytest.approx(analytic_volume(edited), rel=1e-8)
        assert analytic_volume(edited) != before
    invalid = {**part, "size": [float("nan"), 20, 30]}
    with pytest.raises(DesignError):
        local_shape(invalid)
    if shape == "tube":
        with pytest.raises(DesignError):
            local_shape({**part, "holeDiameter": 30})


def test_paths_are_safe_and_csv_does_not_execute_formulas(primitive, tmp_path):
    part = {**primitive, "id": "../../escape", "name": "=HYPERLINK(example)"}
    snapshot = custom_snapshot(part)
    package = build_package(snapshot, tmp_path / "safe")
    with zipfile.ZipFile(package["archive"]) as archive:
        names = archive.namelist()
        assert all(".." not in Path(name).parts for name in names)
        assert "'=HYPERLINK" in archive.read("bom.csv").decode()
    assert not (tmp_path / "escape.step").exists()


def test_incomplete_build_does_not_publish_output(primitive, tmp_path):
    broken = custom_snapshot({**primitive, "shape": "tube", "size": [30, 20, 30], "holeDiameter": 31})
    target = tmp_path / "failed"
    with pytest.raises(DesignError):
        build_package(broken, target)
    assert not target.exists()
    assert not list(tmp_path.glob(".cad-build-*"))


def test_existing_revision_cannot_be_overwritten(primitive, tmp_path):
    snapshot = custom_snapshot(primitive)
    target = tmp_path / "immutable"
    result = build_package(snapshot, target)
    original = Path(result["archive"]).read_bytes()
    snapshot["design"]["revision"] += 1
    with pytest.raises(DesignError, match="already exists"):
        build_package(snapshot, target)
    assert Path(result["archive"]).read_bytes() == original


def test_history_does_not_affect_geometry_identity(primitive):
    snapshot = custom_snapshot(primitive)
    initial = input_hash(snapshot)
    snapshot["history"] = [{"message": "not in manufacturing source"}]
    snapshot["role"] = "editor"
    snapshot["design"]["updatedAt"] = "2026-11-03T00:00:00Z"
    assert input_hash(snapshot) == initial


def test_source_rebuilds_without_original_repo(primitive, tmp_path):
    source = tmp_path / "source"
    result = build_package(custom_snapshot(primitive), source)
    rebuilt = tmp_path / "rebuilt"
    subprocess.run([sys.executable, str(source / "source.py"), "--output", str(rebuilt)], cwd=tmp_path, check=True, capture_output=True, text=True)
    a = json.loads(Path(result["manifest"]).read_text())
    b = json.loads((rebuilt / "manifest.json").read_text())
    assert a["inputHash"] == b["inputHash"]
    assert a["assemblyVerification"] == b["assemblyVerification"]
    assert (rebuilt / "parametric" / "engine.ts").is_file()

def test_exported_parameter_engine_recalculates_without_original_source(snapshots, tmp_path):
    snapshot = snapshots["turntable"][0]
    output = tmp_path / "portable"
    build_package(snapshot, output)
    exported = json.loads((output / "design.json").read_text())
    exported["design"]["params"]["diameter"] = 260
    exported["design"]["revision"] += 1
    (output / "design.json").write_text(json.dumps(exported))
    subprocess.run([str(ROOT / "node_modules" / ".bin" / "tsx"), str(output / "parametric" / "recalculate.ts"), str(output / "design.json")], cwd=tmp_path, check=True, capture_output=True, text=True)
    updated = json.loads((output / "design.json").read_text())
    platter = next(p for p in updated["derived"]["parts"] if p["id"] == "platter")
    assert platter["size"] == [260, 8, 260]
    assert updated["derived"]["bom"] != snapshot["derived"]["bom"]
    subprocess.run([sys.executable, str(output / "source.py"), "--output", str(tmp_path / "revised")], cwd=tmp_path, check=True, capture_output=True, text=True)
    rebuilt = json.loads((tmp_path / "revised" / "manifest.json").read_text())
    assert rebuilt["revision"] == updated["design"]["revision"]
    assert next(p for p in rebuilt["parts"] if p["id"] == "platter")["verification"]["boundsMm"]["size"] == pytest.approx([260, 8, 260])
