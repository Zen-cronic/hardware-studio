"""Isolated native mesher: do not import CadQuery/OCP in this process."""
from __future__ import annotations
import json
from pathlib import Path
import sys
import numpy as np


def main():
    request = json.loads(Path(sys.argv[1]).read_text())
    path = request["path"]
    if request["format"] == "step":
        from netgen.occ import OCCGeometry
        geometry = OCCGeometry(path)
    elif request["format"] == "stl":
        from netgen.stl import STLGeometry
        geometry = STLGeometry(path)
    else:
        raise ValueError("Mesher accepts only validated STEP or STL")
    mesh = geometry.GenerateMesh(maxh=request["maxSizeMm"], optsteps3d=3)
    vertices = np.array([tuple(point.p) for point in mesh.Points()], dtype=float)
    tetrahedra = np.array([[vertex.nr-1 for vertex in e.vertices] for e in mesh.Elements3D()], dtype=np.int64)
    if tetrahedra.ndim != 2 or tetrahedra.shape[1] != 4 or not len(tetrahedra):
        raise ValueError("Mesher did not return linear tetrahedra")
    if len(tetrahedra) > 120000 or len(vertices) > 40000:
        raise ValueError("Mesh exceeds analysis resource limit; increase element size")
    np.savez_compressed(request["output"], vertices=vertices, tetrahedra=tetrahedra)


if __name__ == "__main__":
    main()
