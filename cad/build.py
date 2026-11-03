"""Produce an immutable, revision-bound package of exact CAD and review documents."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.metadata
import io
import json
import math
import os
import shutil
import sys
import struct
import tempfile
import zipfile
from pathlib import Path

# Dependency caches must not prevent a local build in a restricted environment.
os.environ.setdefault("XDG_CACHE_HOME", str(Path(tempfile.gettempdir()) / "hardware-studio-cad-cache"))

import cadquery as cq
import OCP

from .geometry import DesignError, bounds, local_shape, safe_stem, validate_snapshot, world_shape
from .documents import write_documents

SCHEMA_VERSION = 2
KERNEL_VERSION = "OCCT " + getattr(OCP, "__version__", "unknown")
CADQUERY_VERSION = importlib.metadata.version("cadquery")


def manufacturing_parts(snapshot: dict) -> list[dict]:
    return [part for part in snapshot["derived"]["parts"] if part.get("role") != "reference" and not part["material"].startswith("Reference ")]


def canonical_input(snapshot: dict) -> dict:
    d = snapshot["design"]
    return {
        "design": {key: d[key] for key in ("id", "kind", "name", "revision", "params", "mechanismVersion") if key in d},
        "parts": snapshot["derived"]["parts"],
        "bom": snapshot["derived"]["bom"],
        "steps": snapshot["derived"]["steps"],
        "connections": snapshot["derived"]["connections"],
        "metrics": snapshot["derived"]["metrics"],
        "warnings": snapshot["derived"]["warnings"],
        "customParts": d.get("customParts"),
    }


def input_hash(snapshot: dict) -> str:
    raw = json.dumps(canonical_input(snapshot), sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    return hashlib.sha256(raw).hexdigest()


def exporter_hash() -> str:
    root = Path(__file__).parent
    return hashlib.sha256(b"".join((root / name).read_bytes() for name in ("build.py", "geometry.py", "documents.py"))).hexdigest()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compare_shapes(expected: cq.Shape, imported: cq.Shape, label: str, solid_count: int) -> dict:
    if not imported.isValid() or len(imported.Solids()) != solid_count:
        raise DesignError(f"Reopened STEP has invalid geometry or solid count: {label}")
    if not math.isclose(expected.Volume(), imported.Volume(), rel_tol=1e-7, abs_tol=1e-5):
        raise DesignError(f"Reopened STEP volume changed: {label}")
    before, after = bounds(expected), bounds(imported)
    max_delta = max(abs(x - y) for axis in ("min", "max") for x, y in zip(before[axis], after[axis]))
    if max_delta > 1e-4:
        raise DesignError(f"Reopened STEP dimensions changed by {max_delta:g} mm: {label}")
    return {"valid": True, "solids": solid_count, "volumeMm3": imported.Volume(), "boundsMm": after, "maxBoundsDeltaMm": max_delta}


def clean_snapshot(snapshot: dict, parts: list[dict]) -> dict:
    """Preserve design data, removing collaboration history and excluded reference BOM entries."""
    d = snapshot["design"]
    ids = {part["id"] for part in parts}
    derived = dict(snapshot["derived"])
    derived["bom"] = [item for item in derived["bom"] if item.get("id") in ids or item.get("id") not in {p["id"] for p in derived["parts"]}]
    return {"design": {key: d[key] for key in ("id", "kind", "name", "revision", "params", "createdAt", "updatedAt", "customParts", "mechanismVersion") if key in d}, "derived": derived, "history": []}


SOURCE_RUNNER = '''#!/usr/bin/env python3
"""Rebuild the accepted source or a locally edited primitive source.

Run with the project's named pyenv environment and Poetry:
  poetry run python source.py --output rebuilt
Edit design.json derived.parts dimensions for direct primitive edits.
For linked top-level parameters use parametric/recalculate.ts first.
"""
import argparse
import json
from pathlib import Path
from cad.build import build_package

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path(__file__).parent / "design.json")
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "rebuilt")
    args = parser.parse_args()
    result = build_package(json.loads(args.input.read_text()), args.output)
    print(json.dumps(result))
'''


def write_source(output: Path) -> None:
    (output / "source.py").write_text(SOURCE_RUNNER)
    source_root = Path(__file__).parent
    target = output / "cad"
    target.mkdir()
    for name in ("__init__.py", "geometry.py", "documents.py", "build.py"):
        shutil.copyfile(source_root / name, target / name)
    project_root = source_root.parent
    for name in ("pyproject.toml", "poetry.lock", ".python-version"):
        if (project_root / name).is_file():
            shutil.copyfile(project_root / name, output / name)
    # Carry the same authoritative dependency formulas rather than a competing Python copy.
    shared = project_root / "src" / "shared"
    if not shared.is_dir():
        shared = project_root / "parametric"
    if shared.is_dir():
        parametric = output / "parametric"
        parametric.mkdir()
        for name in ("engine.ts", "catalog.ts", "types.ts", "turntable.ts"):
            if (shared / name).is_file():
                shutil.copyfile(shared / name, parametric / name)
        (parametric / "recalculate.ts").write_text("""import {readFileSync, writeFileSync} from 'node:fs';
import {deriveDesign} from './engine';
const input=process.argv[2] || 'design.json';
const snapshot=JSON.parse(readFileSync(input,'utf8'));
snapshot.derived=deriveDesign(snapshot.design);
snapshot.history=[];
writeFileSync(input,JSON.stringify(snapshot,null,2)+'\\n');
console.log('Recalculated geometry and build information from design parameters.');
""")
        (parametric / "package.json").write_text(json.dumps({"name": "hardware-design-source", "private": True, "type": "module", "scripts": {"recalculate": "tsx recalculate.ts ../design.json"}, "devDependencies": {"tsx": "^4.20.0", "typescript": "^5.9.0"}}, indent=2) + "\n")
    (output / "SOURCE-README.md").write_text(
        "# Editable design source\n\n"
        "This package binds every output to the accepted revision in manifest.json. STEP is geometry exchange, not feature history. The parametric source is included separately.\n\n"
        "1. For linked design changes, edit design.json → design.params (or design.customParts for a custom assembly), then run npm install and npm run recalculate inside parametric/. The included TypeScript is the same parameter/dependency engine used by the application.\n"
        "2. For independent primitive edits, change derived.parts in design.json; do not run the parameter recalculation afterward because it will regenerate those parts.\n"
        "3. Use Python 3.12 with pyenv virtualenv .victoria-hardware, activate that environment explicitly, run poetry install, then poetry run python source.py --output rebuilt.\n"
        "4. Review the new package. Local source edits are independent of the application's collaboration history. Change the design revision when making a new version.\n\n"
        "Reference objects remain in design.json for context but are excluded from manufacturing STEP/STL, BOM, process lists and assembly.glb. Purchased components are nominal envelopes and require the exact supplier model before manufacture or ordering.\n"
    )


def glb_millimetres_to_metres(path: Path) -> None:
    # OCCT 7.8 writes model units unchanged. glTF defines metres; wrap scene roots.
    raw = path.read_bytes()
    magic, version, total = struct.unpack_from("<4sII", raw)
    if magic != b"glTF" or version != 2 or total != len(raw):
        raise DesignError("Invalid GLB export header")
    json_length, json_kind = struct.unpack_from("<II", raw, 12)
    if json_kind != 0x4E4F534A:
        raise DesignError("GLB JSON chunk missing")
    doc = json.loads(raw[20:20+json_length])
    for scene in doc.get("scenes", []):
        unit_node = {"name": "millimetres-to-metres", "children": scene.get("nodes", []), "scale": [0.001, 0.001, 0.001]}
        scene["nodes"] = [len(doc["nodes"])]
        doc["nodes"].append(unit_node)
    encoded = json.dumps(doc, separators=(",", ":")).encode()
    encoded += b" " * ((-len(encoded)) % 4)
    remaining = raw[20+json_length:]
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, 20+len(encoded)+len(remaining)) + struct.pack("<II", len(encoded), json_kind) + encoded + remaining)


def build_package(snapshot: dict, output: Path | str) -> dict:
    validate_snapshot(snapshot)
    output = Path(output).resolve()
    parts = manufacturing_parts(snapshot)
    if not parts:
        raise DesignError("No manufacturing components remain after excluding reference objects")
    digest = input_hash(snapshot)
    code_hash = exporter_hash()
    if output.exists():
        manifest_path = output / "manifest.json"
        archive = output / "package.zip"
        if manifest_path.is_file() and archive.is_file():
            existing = json.loads(manifest_path.read_text())
            if existing.get("inputHash") == digest and existing.get("kernelVersion") == KERNEL_VERSION and existing.get("exporterHash") == code_hash:
                with zipfile.ZipFile(archive) as z:
                    if z.testzip() is not None:
                        raise DesignError("Existing build archive is corrupt")
                for entry in existing.get("artifacts", []):
                    artifact = output / entry["path"]
                    if not artifact.is_file() or sha256(artifact) != entry["sha256"]:
                        raise DesignError("Existing build artifact hash mismatch")
                return {"ok": True, "archive": str(archive), "manifest": str(manifest_path)}
        raise DesignError("Output directory already exists with a different or incomplete build")
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".cad-build-", dir=output.parent))
    try:
        (stage / "parts").mkdir()
        saved = clean_snapshot(snapshot, parts)
        (stage / "design.json").write_text(json.dumps(saved, indent=2, ensure_ascii=False, allow_nan=False) + "\n")
        file_map = {part["id"]: safe_stem(part["id"]) for part in parts}
        validations, world_solids = [], []
        assembly = cq.Assembly(name=safe_stem(snapshot["design"]["name"]))
        for part in parts:
            local = local_shape(part)
            world = world_shape(part, local)
            stem = file_map[part["id"]]
            step_path, stl_path = stage / "parts" / (stem + ".step"), stage / "parts" / (stem + ".stl")
            cq.exporters.export(local, str(step_path), "STEP")
            cq.exporters.export(local, str(stl_path), "STL", tolerance=0.05, angularTolerance=0.1)
            imported = cq.importers.importStep(str(step_path)).val()
            verification = compare_shapes(local, imported, part["id"], 1)
            color = tuple(int(part["color"][i:i + 2], 16) / 255 for i in (1, 3, 5))
            assembly.add(world, name=stem, color=cq.Color(*color))
            world_solids.append(world)
            validations.append({"id": part["id"], "name": part["name"], "files": {"step": f"parts/{stem}.step", "stl": f"parts/{stem}.stl", "drawing": f"drawings/{stem}.svg"}, "placement": {"positionMm": part["position"], "rotationRadiansXYZ": part.get("rotation", [0, 0, 0])}, "verification": verification})
        compound = cq.Compound.makeCompound(world_solids)
        assembly.save(str(stage / "assembly.step"), exportType="STEP")
        reopened = cq.importers.importStep(str(stage / "assembly.step")).val()
        assembly_verification = compare_shapes(compound, reopened, "assembly", len(world_solids))
        # Our source is already Y-up; cancel CadQuery's assumed Z-up conversion.
        assembly.loc = cq.Location((0, 0, 0), (1, 0, 0), 90)
        assembly.save(str(stage / "assembly.glb"), exportType="GLTF", tolerance=0.05, angularTolerance=0.1)
        glb_millimetres_to_metres(stage / "assembly.glb")
        doc_snapshot = {**saved, "derived": {**saved["derived"], "parts": parts}}
        write_documents(doc_snapshot, stage, file_map)
        write_source(stage)
        artifacts = [{"path": str(path.relative_to(stage)), "sha256": sha256(path), "bytes": path.stat().st_size} for path in sorted(stage.rglob("*")) if path.is_file()]
        manifest = {
            "schemaVersion": SCHEMA_VERSION, "designId": snapshot["design"]["id"], "revision": snapshot["design"]["revision"],
            "inputHash": digest, "exporterHash": code_hash, "kernelVersion": KERNEL_VERSION, "cadqueryVersion": CADQUERY_VERSION,
            "units": "mm", "coordinates": "Y-up; XYZ Euler radians; local centred part exports",
            "meshToleranceMm": 0.05, "angularToleranceRadians": 0.1,
            "parts": validations, "assemblyVerification": assembly_verification,
            "excludedReferences": [p["id"] for p in snapshot["derived"]["parts"] if p["id"] not in file_map],
            "artifacts": artifacts, "notes": [
                "Exact analytic solids reopened from STEP and checked for validity, solid count, volume and bounds.",
                "STL is unitless; interpret coordinates as millimetres.",
                "GLB uses metres via an explicit 0.001 scene-root scale, preserving browser Y-up axes.",
                "No physical fabrication, load testing, electrical validation or machine-specific CAM is represented by these checks.",
            ],
        }
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False, allow_nan=False) + "\n")
        with zipfile.ZipFile(stage / "package.zip", "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(stage.rglob("*")):
                if path.is_file() and path.name != "package.zip":
                    info = zipfile.ZipInfo(str(path.relative_to(stage)), (2026, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o644 << 16
                    archive.writestr(info, path.read_bytes())
        stage.rename(output)
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    return {"ok": True, "archive": str(output / "package.zip"), "manifest": str(output / "manifest.json")}


def main() -> int:
    parser = argparse.ArgumentParser(description="Build an immutable hardware CAD package")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.input.stat().st_size > 10_000_000:
            raise DesignError("Input exceeds the 10 MB limit")
        snapshot = json.loads(args.input.read_text())
        # Native exporters can write progress information; keep CLI stdout machine-readable.
        with contextlib.redirect_stdout(sys.stderr):
            result = build_package(snapshot, args.output)
        print(json.dumps(result))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc), "type": type(exc).__name__}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
