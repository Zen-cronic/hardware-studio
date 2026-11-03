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
    if "loopSpan" in part:
        span=finite(part["loopSpan"], "Loop span", .5, MAX_SIZE_MM)
        if part["shape"] != "tube" or not math.isclose(part["size"][0]-part["size"][2],span,abs_tol=1e-6) or any(k in part for k in ("sections","holes","channel")):
            raise DesignError("A loop requires tube geometry, matching span and no additional features")
    if part["shape"] != "box":
        if "loopSpan" not in part and not math.isclose(part["size"][0], part["size"][2], abs_tol=1e-6):
            raise DesignError(f"{part['id']} cylinder X/Z diameter must agree")
        if part["shape"] == "tube":
            bore = finite(part.get("holeDiameter"), f"{part['id']} bore", 0.001, MAX_SIZE_MM)
            if bore >= part["size"][2] - (0.5 if "loopSpan" in part else 0.002):
                raise DesignError(f"{part['id']} bore must leave positive wall thickness")
    sections = part.get("sections")
    if sections is not None:
        if part["shape"] == "box" or not isinstance(sections,list) or not 1 <= len(sections) <= 16:
            raise DesignError("Invalid axial sections")
        for i, section in enumerate(sections):
            if not isinstance(section,dict): raise DesignError("Invalid axial section")
            finite(section.get("height"), "Section height", .5, MAX_SIZE_MM)
            finite(section.get("diameter"), "Section diameter", .5, part["size"][0])
            finite(section.get("bore"), "Section bore", 0, section["diameter"]-.5)
            if i and min(section["diameter"],sections[i-1]["diameter"]) <= max(section["bore"],sections[i-1]["bore"])+.5:
                raise DesignError("Disconnected axial sections")
        if not math.isclose(sum(q["height"] for q in sections),part["size"][1],abs_tol=1e-6) or not math.isclose(max(q["diameter"] for q in sections),part["size"][0],abs_tol=1e-6):
            raise DesignError("Section dimensions do not match part")
    channel = part.get("channel")
    if "channel" in part:
        if part["shape"] != "box" or not isinstance(channel,dict): raise DesignError("Channel requires box geometry")
        finite(channel.get("width"), "Channel width", .5, part["size"][2]-1)
        finite(channel.get("depth"), "Channel depth", .5, part["size"][1]-.5)
    holes = part.get("holes",[])
    if not isinstance(holes,list) or len(holes)>128: raise DesignError("Invalid holes")
    for i,h in enumerate(holes):
        if not isinstance(h,dict): raise DesignError("Invalid hole")
        x=finite(h.get("x"),"Hole X"); z=finite(h.get("z"),"Hole Z")
        diameter=finite(h.get("diameter"),"Hole diameter",.5,MAX_SIZE_MM)
        cb=h.get("counterbore")
        if "counterbore" in h:
            if part["shape"] != "box" or not isinstance(cb,dict): raise DesignError("Counterbore requires box geometry")
            finite(cb.get("diameter"),"Counterbore diameter",diameter+.5,MAX_SIZE_MM)
            finite(cb.get("depth"),"Counterbore depth",.5,part["size"][1]-.5)
        hr=(cb["diameter"] if cb else diameter)/2
        if channel and abs(z)-hr < channel["width"]/2+.25: raise DesignError("Hole crosses underside channel")
        radius=math.hypot(x,z)
        if part["shape"]=="box":
            valid=abs(x)+hr <= part["size"][0]/2-.25 and abs(z)+hr <= part["size"][2]/2-.25
        else:
            rings=sections or [{"diameter":part["size"][0],"bore":part.get("holeDiameter",0) if part["shape"]=="tube" else 0}]
            valid=any(radius+hr < q["diameter"]/2 for q in rings) and all(radius-hr >= q["diameter"]/2+.25 or (radius+hr <= q["diameter"]/2-.25 and (not q["bore"] or radius-hr >= q["bore"]/2+.25)) for q in rings)
        if not valid or any(math.hypot(x-j["x"],z-j["z"]) < ((h.get("counterbore") or h)["diameter"]+(j.get("counterbore") or j)["diameter"])/2+.25 for j in holes[:i]):
            raise DesignError("Hole crosses a boundary or another hole")
    return part


def validate_snapshot(snapshot: Any) -> dict:
    if not isinstance(snapshot, dict):
        raise DesignError("Snapshot must be an object")
    design = snapshot.get("design", {})
    if not isinstance(design, dict) or design.get("kind") not in ALLOWED_KINDS:
        raise DesignError("Unknown design kind")
    if "mechanismVersion" in design and (design["kind"] != "turntable" or design["mechanismVersion"] != 2):
        raise DesignError("Unsupported mechanism version")
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
    if "loopSpan" in part:
        span=part["loopSpan"]
        def capsule(diameter, height):
            solid=cq.Workplane("XY").box(span,height,diameter).val()
            for end in (-span/2,span/2):
                solid=solid.fuse(cq.Solid.makeCylinder(diameter/2,height,cq.Vector(end,-height/2,0),cq.Vector(0,1,0)))
            return solid.clean()
        shape=capsule(z,y).cut(capsule(part["holeDiameter"],y+2)).clean()
    elif part["shape"] == "box":
        shape = cq.Workplane("XY").box(x, y, z, centered=(True, True, True)).val()
    else:
        sections = part.get("sections") or [{"height": y, "diameter": x, "bore": part.get("holeDiameter",0) if part["shape"] == "tube" else 0}]
        offset=-y/2
        shape=None
        for section in sections:
            solid=cq.Solid.makeCylinder(section["diameter"]/2,section["height"],cq.Vector(0,offset,0),cq.Vector(0,1,0))
            if section["bore"]:
                solid=solid.cut(cq.Solid.makeCylinder(section["bore"]/2,section["height"]+2,cq.Vector(0,offset-1,0),cq.Vector(0,1,0)))
            shape=solid if shape is None else shape.fuse(solid)
            offset+=section["height"]
        shape=shape.clean()
    if part.get("channel"):
        c=part["channel"]
        cut=cq.Workplane("XY").box(x+2,c["depth"]+1,c["width"]).translate((0,-y/2+(c["depth"]-1)/2,0)).val()
        shape=shape.cut(cut)
    for hole in part.get("holes",[]):
        if hole.get("counterbore"):
            cb=hole["counterbore"]
            shape=shape.cut(cq.Solid.makeCylinder(cb["diameter"]/2,cb["depth"]+1,cq.Vector(hole["x"],y/2-cb["depth"],hole["z"]),cq.Vector(0,1,0)))
        shape=shape.cut(cq.Solid.makeCylinder(hole["diameter"]/2,y+2,cq.Vector(hole["x"],-y/2-1,hole["z"]),cq.Vector(0,1,0)))
    shape=shape.clean()
    if not shape.isValid() or len(shape.Solids()) != 1:
        raise DesignError(f"Kernel produced an invalid solid for {part['id']}")
    expected = analytic_volume(part)
    if not math.isclose(shape.Volume(), expected, rel_tol=1e-8, abs_tol=1e-6):
        raise DesignError(f"Analytic volume check failed for {part['id']}")
    return shape


def analytic_volume(part: dict) -> float:
    x,y,z=part["size"]
    if "loopSpan" in part:
        inner=part["holeDiameter"]
        return (part["loopSpan"]*(z-inner)+math.pi*(z*z-inner*inner)/4)*y
    if part["shape"] == "box":
        volume=x*y*z-sum(math.pi*h["diameter"]**2*y/4 for h in part.get("holes",[]))
        if part.get("channel"): volume-=x*part["channel"]["width"]*part["channel"]["depth"]
        for h in part.get("holes",[]):
            if h.get("counterbore"):
                cb=h["counterbore"]
                volume-=math.pi*(cb["diameter"]**2-h["diameter"]**2)*cb["depth"]/4
        return volume
    sections=part.get("sections") or [{"height":y,"diameter":x,"bore":part.get("holeDiameter",0) if part["shape"]=="tube" else 0}]
    return sum(math.pi*(q["diameter"]**2-q["bore"]**2-sum(h["diameter"]**2 for h in part.get("holes",[]) if math.hypot(h["x"],h["z"])+h["diameter"]/2 < q["diameter"]/2))*q["height"]/4 for q in sections)


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
