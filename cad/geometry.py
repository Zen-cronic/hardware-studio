"""Validated primitive geometry. Dimensions are mm; rotations match Three.js XYZ Euler."""
from __future__ import annotations

import math
import re
from typing import Any

import cadquery as cq
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib

MAX_PARTS = 256
MAX_SIZE_MM = 10000
ALLOWED_KINDS = {"turntable", "slider", "conveyor", "lamp", "planter", "holder", "custom"}


class DesignError(ValueError):
    """An input cannot be converted to an unambiguous valid solid."""


def finite(value: Any, label: str, minimum: float = -100000, maximum: float = 100000) -> float:
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise DesignError(f"{label} must be a finite number")
    if not minimum <= value <= maximum:
        raise DesignError(f"{label} must be between {minimum:g} and {maximum:g}")
    return float(value)


def vector(value: Any, label: str, minimum: float = -100000, maximum: float = 100000) -> list[float]:
    if not isinstance(value, list) or len(value) != 3:
        raise DesignError(f"{label} must have three components")
    return [finite(v, f"{label}[{i}]", minimum, maximum) for i, v in enumerate(value)]


def validate_part(part: Any) -> dict:
    if not isinstance(part, dict):
        raise DesignError("Every part must be an object")
    for key in ("id", "name", "material"):
        if not isinstance(part.get(key), str) or not part[key].strip() or len(part[key]) > 240:
            raise DesignError(f"Part {key} must be a nonempty string under 241 characters")
    if part.get("shape") not in {"box", "cylinder", "tube"}:
        raise DesignError(f"Unsupported shape for {part['id']}")
    vector(part.get("size"), f"{part['id']} size", 0.01, MAX_SIZE_MM)
    vector(part.get("position"), f"{part['id']} position")
    vector(part.get("rotation", [0, 0, 0]), f"{part['id']} rotation", -20 * math.pi, 20 * math.pi)
    if part.get("process") not in {"print", "machine", "buy", "cut"}:
        raise DesignError(f"Unknown process for {part['id']}")
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", part.get("color", "")):
        raise DesignError(f"{part['id']} color must be a six-digit hex color")
    if part["shape"] != "box":
        if not math.isclose(part["size"][0], part["size"][2], abs_tol=1e-6):
            raise DesignError(f"{part['id']} cylinder X/Z diameter must agree")
        if part["shape"] == "tube":
            bore = finite(part.get("holeDiameter"), f"{part['id']} bore", 0.001, MAX_SIZE_MM)
            if bore >= part["size"][0] - 0.002:
                raise DesignError(f"{part['id']} bore must leave positive wall thickness")
    return part


def validate_snapshot(snapshot: Any) -> dict:
    if not isinstance(snapshot, dict):
        raise DesignError("Snapshot must be an object")
    design = snapshot.get("design", {})
    if not isinstance(design, dict) or design.get("kind") not in ALLOWED_KINDS:
        raise DesignError("Unknown design kind")
    if not isinstance(design.get("id"), str) or not design["id"]:
        raise DesignError("Design id is required")
    revision = design.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise DesignError("Revision must be a nonnegative integer")
    if not isinstance(design.get("name"), str) or not design["name"].strip():
        raise DesignError("Design name is required")
    params = design.get("params")
    if not isinstance(params, dict):
        raise DesignError("Design params must be an object")
    for key, value in params.items():
        finite(value, f"Parameter {key}")
    derived = snapshot.get("derived", {})
    if not isinstance(derived, dict):
        raise DesignError("Derived design must be an object")
    parts = derived.get("parts")
    if not isinstance(parts, list) or not 1 <= len(parts) <= MAX_PARTS:
        raise DesignError(f"A build must have 1–{MAX_PARTS} parts")
    seen = set()
    for part in parts:
        validate_part(part)
        if part["id"] in seen:
            raise DesignError(f"Duplicate part id: {part['id']}")
        seen.add(part["id"])
    for key in ("bom", "steps", "connections", "metrics", "warnings"):
        if not isinstance(derived.get(key), list):
            raise DesignError(f"Derived {key} must be a list")
    for row in derived["bom"]:
        if not isinstance(row, dict) or not isinstance(row.get("name"), str):
            raise DesignError("Invalid BOM row")
        finite(row.get("quantity"), f"BOM quantity for {row['name']}", 0.001, 100000)
    for step in derived["steps"]:
        if not isinstance(step, dict) or not isinstance(step.get("partIds"), list):
            raise DesignError("Invalid assembly step")
        unknown = set(step["partIds"]) - seen
        if unknown:
            raise DesignError(f"Assembly step references missing parts: {', '.join(sorted(unknown))}")
    return snapshot


def local_shape(part: dict) -> cq.Shape:
    validate_part(part)
    x, y, z = part["size"]
    if part["shape"] == "box":
        shape = cq.Workplane("XY").box(x, y, z, centered=(True, True, True)).val()
    else:
        shape = cq.Solid.makeCylinder(x / 2, y, cq.Vector(0, -y / 2, 0), cq.Vector(0, 1, 0))
        if part["shape"] == "tube":
            bore = cq.Solid.makeCylinder(part["holeDiameter"] / 2, y + 2, cq.Vector(0, -y / 2 - 1, 0), cq.Vector(0, 1, 0))
            shape = shape.cut(bore)
    if not shape.isValid() or len(shape.Solids()) != 1:
        raise DesignError(f"Kernel produced an invalid solid for {part['id']}")
    expected = analytic_volume(part)
    if not math.isclose(shape.Volume(), expected, rel_tol=1e-8, abs_tol=1e-6):
        raise DesignError(f"Analytic volume check failed for {part['id']}")
    return shape


def analytic_volume(part: dict) -> float:
    x, y, z = part["size"]
    if part["shape"] == "box":
        return x * y * z
    inner = part.get("holeDiameter", 0) if part["shape"] == "tube" else 0
    return math.pi * (x * x - inner * inner) * y / 4


def world_shape(part: dict, local: cq.Shape | None = None) -> cq.Shape:
    shape = local if local is not None else local_shape(part)
    rx, ry, rz = part.get("rotation", [0, 0, 0])
    # Three.js intrinsic XYZ is the matrix Rx*Ry*Rz: apply fixed-axis Z,Y,X.
    for radians, axis in ((rz, (0, 0, 1)), (ry, (0, 1, 0)), (rx, (1, 0, 0))):
        if radians:
            shape = shape.rotate((0, 0, 0), axis, math.degrees(radians))
    return shape.translate(tuple(part["position"]))


def bounds(shape: cq.Shape) -> dict:
    # Ignore cached tessellation: STL export must not perturb exact STEP bounds.
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape.wrapped, box, False, False)
    xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
    return {"min": [xmin, ymin, zmin], "max": [xmax, ymax, zmax], "size": [xmax-xmin, ymax-ymin, zmax-zmin]}


def safe_stem(identity: str) -> str:
    import hashlib
    plain = re.sub(r"[^A-Za-z0-9_-]", "-", identity).strip("-")[:60] or "part"
    return plain + "-" + hashlib.sha256(identity.encode()).hexdigest()[:8]
