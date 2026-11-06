from __future__ import annotations
import hashlib
import io
import json
import math
from pathlib import Path
import numpy as np
from cad.geometry import DesignError, local_shape, validate_part, bounds


class StudyError(ValueError):
    def __init__(self, message: str, status: str = "needs_inputs"):
        super().__init__(message)
        self.status = status


def number(value, name, low=-1e12, high=1e12):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise StudyError(f"{name} must be a finite number between {low:g} and {high:g}")
    return float(value)


def vec(value, name):
    if not isinstance(value, list) or len(value) != 3:
        raise StudyError(f"{name} must have three numeric components")
    return np.array([number(v, name) for v in value])


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def select_part(request):
    part = request.get("part")
    if part is None and request.get("snapshot"):
        parts = request["snapshot"].get("derived", {}).get("parts", [])
        candidates = [p for p in parts if p.get("id") == request.get("partId")]
        if len(candidates) != 1:
            raise StudyError("Select exactly one component for this study")
        part = candidates[0]
    if part is not None:
        try:
            return validate_part(part)
        except DesignError as error:
            raise StudyError(str(error), "invalid_geometry") from error
    if request.get("geometry"):
        return None
    raise StudyError("Supply a part or a snapshot and partId")


def prepare_geometry(request, directory):
    """Produce a faithful local-coordinate solid and measured volume/bounds."""
    import cadquery as cq
    part = select_part(request)
    output = Path(directory) / "geometry.step"
    if part is not None:
        try:
            shape = local_shape(part)
        except DesignError as error:
            raise StudyError(str(error), "invalid_geometry") from error
        cq.exporters.export(shape, str(output))
        b = bounds(shape)
        return {"path": str(output), "format": "step", "volumeMm3": shape.Volume(), "bounds": b, "part": part, "sourceKind": "parametric"}
    source = request["geometry"]
    if not isinstance(source, dict):
        raise StudyError("geometry must be an object")
    filename = Path(source.get("path", ""))
    if not filename.is_file() or filename.stat().st_size > 50 * 1024 * 1024:
        raise StudyError("Imported source is missing or exceeds 50 MB", "invalid_geometry")
    kind = source.get("format", filename.suffix.lower().lstrip("."))
    scale = number(source.get("scaleToMm"), "geometry.scaleToMm", 1e-6, 1e6)
    if kind in ("step", "stp"):
        try:
            shape = cq.importers.importStep(str(filename)).val()
            if scale != 1:
                shape = shape.scale(scale)
            solids = shape.Solids()
            body = source.get("bodyIndex")
            if body is not None:
                if isinstance(body, bool) or not isinstance(body, int) or not 0 <= body < len(solids):
                    raise StudyError("Imported bodyIndex does not identify a solid")
                shape = solids[body]
            elif len(solids) != 1:
                raise StudyError("Select one imported solid; assembly contacts are not inferred", "unsupported_physics")
            if not shape.isValid() or shape.Volume() <= 0:
                raise StudyError("Imported STEP is not a valid positive-volume solid", "invalid_geometry")
            cq.exporters.export(shape, str(output))
            return {"path": str(output), "format": "step", "volumeMm3": shape.Volume(), "bounds": bounds(shape), "part": None, "sourceKind": "imported-step"}
        except StudyError:
            raise
        except Exception as error:
            raise StudyError(f"Cannot read STEP: {error}", "invalid_geometry") from error
    if kind not in ("stl", "obj", "glb"):
        raise StudyError("Supported engineering imports are STEP, STL, OBJ and GLB", "invalid_geometry")
    import trimesh
    try:
        scene = trimesh.load_scene(io.BytesIO(filename.read_bytes()), file_type=kind, process=False, skip_materials=True)
        # Scene node transforms must be applied, not lost through geometry.values().
        meshes = list(scene.dump())
        index = source.get("bodyIndex")
        if index is None and len(meshes) != 1:
            raise StudyError("Select one imported body; touching mesh objects are not bonded", "unsupported_physics")
        index = 0 if index is None else index
        if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < len(meshes):
            raise StudyError("Imported bodyIndex does not identify a mesh")
        mesh = meshes[index].copy()
        mesh.apply_scale(scale)
        if not np.isfinite(mesh.vertices).all() or len(mesh.faces) > 500000 or len(mesh.faces) < 4:
            raise StudyError("Invalid or excessive imported mesh", "invalid_geometry")
        # Only exact coincident vertices are combined; no dimensional repair or hole fill.
        mesh.merge_vertices(digits_vertex=12)
        if not mesh.is_watertight or not mesh.is_winding_consistent or mesh.volume <= 0 or not mesh.is_volume:
            raise StudyError("Solid analysis needs a closed, consistently oriented positive-volume mesh; source was not repaired", "invalid_geometry")
        import open3d as o3d
        inspection = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(mesh.vertices), o3d.utility.Vector3iVector(mesh.faces))
        if not inspection.is_edge_manifold(allow_boundary_edges=False) or not inspection.is_vertex_manifold() or not inspection.is_orientable() or inspection.is_self_intersecting():
            raise StudyError("Imported mesh has nonmanifold, nonorientable or self-intersecting geometry; source was not repaired", "invalid_geometry")
        components = mesh.split(only_watertight=False)
        if len(components) != 1:
            raise StudyError("Select a single connected physical body for component analysis", "unsupported_physics")
        path = Path(directory) / "geometry.stl"
        mesh.export(str(path))
        minimum, maximum = mesh.bounds
        return {"path": str(path), "format": "stl", "volumeMm3": float(mesh.volume), "bounds": {"min": minimum.tolist(), "max": maximum.tolist(), "size": (maximum-minimum).tolist()}, "part": None, "sourceKind": "imported-mesh", "notes": ["Polygonal geometry retains its source faceting; manifoldness, orientation and self-intersections were checked."]}
    except StudyError:
        raise
    except Exception as error:
        raise StudyError(f"Cannot read mesh: {error}", "invalid_geometry") from error
