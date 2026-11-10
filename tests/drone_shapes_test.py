from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path

import cadquery as cq
import pytest

from cad.build import build_package
from cad.geometry import DesignError, analytic_volume, bounds, find_interferences, local_shape

ROOT = Path(__file__).resolve().parents[1]
BASE = {"id": "p", "name": "Part", "material": "PA12 nylon, printed", "color": "#69737F", "process": "print", "position": [0, 0, 0]}


@pytest.fixture(scope="session")
def drones():
    code = """
import {createDesign, deriveDesign} from './src/shared/engine.ts';
import {droneParts} from './src/shared/drone.ts';
const out={};
for (const [key, ducts] of [['open', false], ['ducted', true]]) {
  const d={...createDesign('custom','Camera drone',droneParts({ducts})),id:'drone-'+key,createdAt:'2026-11-10T00:00:00.000Z',updatedAt:'2026-11-10T00:00:00.000Z'};
  out[key]={design:d,derived:deriveDesign(d),history:[]};
}
console.log(JSON.stringify(out));
"""
    result = subprocess.run(["node", "--import", "tsx", "--input-type=module", "-e", code], cwd=ROOT, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


@pytest.mark.parametrize("extra", [
    {"shape": "ellipsoid", "size": [26, 26, 26]},
    {"shape": "ellipsoid", "size": [60, 150, 60], "rotation": [0, 0, math.pi / 2]},
    {"shape": "ellipsoid", "size": [80, 30, 80]},
    {"shape": "box", "size": [121, 30, 56], "edgeRadius": 12},
    {"shape": "box", "size": [121, 30, 56], "edgeRadius": 12, "wall": 2},
])
def test_new_shapes_are_exact_and_survive_step(extra, tmp_path):
    part = {**BASE, **extra}
    shape = local_shape(part)
    assert shape.isValid() and len(shape.Solids()) == 1
    assert math.isclose(shape.Volume(), analytic_volume(part), rel_tol=1e-8)
    assert all(math.isclose(a, b, abs_tol=1e-4) for a, b in zip(bounds(shape)["size"], part["size"]))
    path = tmp_path / "part.step"
    cq.exporters.export(shape, str(path), "STEP")
    reopened = cq.importers.importStep(str(path)).val()
    assert math.isclose(reopened.Volume(), shape.Volume(), rel_tol=1e-7)


def test_rounded_box_volume_matches_a_sphere_swept_box():
    part = {**BASE, "shape": "box", "size": [40, 20, 30], "edgeRadius": 5}
    a, b, c, r = 30, 10, 20, 5
    assert math.isclose(analytic_volume(part), a * b * c + 2 * r * (a * b + b * c + c * a) + math.pi * r * r * (a + b + c) + 4 / 3 * math.pi * r ** 3)
    hollow = {**part, "wall": 2}
    assert analytic_volume(hollow) < analytic_volume(part) / 2


@pytest.mark.parametrize("extra", [
    {"shape": "ellipsoid", "size": [26, 26, 20]},
    {"shape": "ellipsoid", "size": [26, 26, 26], "holeDiameter": 4},
    {"shape": "ellipsoid", "size": [26, 26, 26], "holes": [{"x": 0, "z": 0, "diameter": 3}]},
    {"shape": "box", "size": [20, 10, 20], "edgeRadius": 5},
    {"shape": "cylinder", "size": [20, 10, 20], "edgeRadius": 2},
    {"shape": "box", "size": [20, 10, 20], "edgeRadius": 2, "holes": [{"x": 0, "z": 0, "diameter": 3}]},
    {"shape": "box", "size": [20, 10, 20], "wall": 1},
    {"shape": "box", "size": [20, 10, 20], "edgeRadius": 2, "wall": 2},
])
def test_invalid_new_shapes_are_rejected(extra):
    with pytest.raises(DesignError):
        local_shape({**BASE, **extra})


@pytest.mark.parametrize("variant", ["open", "ducted"])
def test_drone_parts_do_not_overlap(variant, drones):
    assert find_interferences(drones[variant]["derived"]["parts"]) == []


def test_interference_check_finds_an_overlap():
    a = {**BASE, "id": "a", "shape": "box", "size": [10, 10, 10]}
    b = {**BASE, "id": "b", "shape": "ellipsoid", "size": [10, 10, 10], "position": [5, 0, 0]}
    c = {**BASE, "id": "c", "shape": "box", "size": [10, 10, 10], "edgeRadius": 2, "position": [0, 10, 0]}
    found = find_interferences([a, b, c])
    assert [(f["a"], f["b"]) for f in found] == [("a", "b")]
    assert math.isclose(found[0]["volumeMm3"], 2 / 3 * math.pi * 125, rel_tol=1e-3)


def test_drone_package_exports_every_part_with_its_shape(drones, tmp_path):
    snapshot = drones["open"]
    result = build_package(snapshot, tmp_path / "out")
    assert result["ok"]
    manifest = json.loads((tmp_path / "out" / "manifest.json").read_text())
    ids = {p["id"] for p in manifest["parts"]}
    assert ids == {p["id"] for p in snapshot["derived"]["parts"] if p.get("role") != "reference"}
    assert {"body-shell", "camera", "battery", "status-light"} <= ids
    glb = (tmp_path / "out" / "assembly.glb").read_bytes()
    assert glb[:4] == b"glTF"
    gltf = json.loads(glb[20:20 + int.from_bytes(glb[12:16], "little")])
    assert len(gltf["meshes"]) >= len(ids)


def test_glb_carries_declared_finishes(drones, tmp_path):
    build_package(drones["open"], tmp_path / "out")
    glb = (tmp_path / "out" / "assembly.glb").read_bytes()
    gltf = json.loads(glb[20:20 + int.from_bytes(glb[12:16], "little")])
    finishes = {node["name"].rsplit("-", 1)[0]: gltf["materials"][gltf["meshes"][node["mesh"]]["primitives"][0]["material"]]["pbrMetallicRoughness"] for node in gltf["nodes"] if "mesh" in node}
    # glTF's default is bare rough metal, which renders a printed shell almost black.
    assert finishes["body-shell"]["metallicFactor"] == 0.0
    assert finishes["motor-front-right"]["metallicFactor"] == 0.7
    assert all("metallicFactor" in m["pbrMetallicRoughness"] for m in gltf["materials"])
