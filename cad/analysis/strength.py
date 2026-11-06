"""Small-strain isotropic component elasticity, N/mm/MPa units, real tetrahedral FEA."""
from __future__ import annotations
import json
import math
from pathlib import Path
import subprocess
import sys
import warnings
import numpy as np
from scipy.sparse.linalg import MatrixRankWarning
from skfem import MeshTet, Basis, FacetBasis, ElementTetP2, ElementVector, LinearForm, asm, condense, solve
from skfem.models.elasticity import linear_elasticity, lame_parameters
from .common import StudyError, number, vec, prepare_geometry


def _boundary(mesh, region, label):
    if not isinstance(region, dict):
        raise StudyError(f"{label} must identify a boundary region")
    facets = mesh.boundary_facets()
    coordinates = mesh.p[:, mesh.facets[:, facets]]
    tolerance = number(region.get("toleranceMm", max(float(np.ptp(mesh.p, axis=1).max())*1e-7, 1e-8)), f"{label} tolerance", 1e-10, 10)
    if "min" in region and "max" in region:
        low, high = vec(region["min"], "Boundary min"), vec(region["max"], "Boundary max")
        if np.any(low > high):
            raise StudyError("Boundary minimum exceeds maximum")
        selected = np.all((coordinates >= low[:, None, None]-tolerance) & (coordinates <= high[:, None, None]+tolerance), axis=(0, 1))
    else:
        axis = region.get("axis")
        if axis not in ("x", "y", "z") or region.get("side") not in ("min", "max"):
            raise StudyError(f"{label} requires axis x/y/z and side min/max, or explicit min/max bounds")
        index = ("x", "y", "z").index(axis)
        target = (np.min if region["side"] == "min" else np.max)(mesh.p[index])
        selected = np.all(np.abs(coordinates[index]-target) <= tolerance, axis=0)
    result = facets[selected]
    if len(result) == 0:
        raise StudyError(f"{label} contains no complete boundary faces; choose an actual planar face or explicit region")
    return result


def _area(mesh, facets):
    points = mesh.p[:, mesh.facets[:, facets]]
    return float(np.linalg.norm(np.cross((points[:, 1]-points[:, 0]).T, (points[:, 2]-points[:, 0]).T), axis=1).sum()/2)


def _mesh_geometry(geometry, size, folder, level):
    if geometry["volumeMm3"]/size**3 > 50000 or max(geometry["bounds"]["size"])/size > 5000:
        raise StudyError("Requested mesh size exceeds the component analysis budget; increase element size", "mesh_failed")
    target = Path(folder)/f"mesh-{level}.npz"
    manifest = Path(folder)/f"mesher-{level}.json"
    manifest.write_text(json.dumps({"path": geometry["path"], "format": geometry["format"], "maxSizeMm": size, "output": str(target)}))
    try:
        result = subprocess.run([sys.executable, "-m", "cad.analysis.mesher", str(manifest)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=90)
    except subprocess.TimeoutExpired as error:
        raise StudyError("Meshing exceeded 90 seconds; increase element size or simplify the explicitly selected geometry", "mesh_failed") from error
    if result.returncode != 0 or not target.is_file():
        detail = (result.stderr or result.stdout)[-1200:].strip()
        raise StudyError(f"Volume meshing failed: {detail}", "mesh_failed")
    with np.load(target) as data:
        vertices, elements = data["vertices"], data["tetrahedra"]
    if not np.isfinite(vertices).all():
        raise StudyError("Mesher returned non-finite vertices", "mesh_failed")
    mesh = MeshTet(vertices.T, elements.T, sort_t=False).oriented()
    determinant = mesh.mapping().detDF(np.zeros((3, 1)))[:, 0]
    if np.any(determinant <= 1e-14):
        raise StudyError("Mesh contains inverted or degenerate tetrahedra", "mesh_failed")
    volume = float(determinant.sum()/6)
    volume_error = abs(volume-geometry["volumeMm3"])/geometry["volumeMm3"]
    if volume_error > .05:
        raise StudyError(f"Mesh volume differs from source by {volume_error:.1%}; refine curved or thin features", "mesh_failed")
    return mesh, volume, volume_error


def _solve(mesh, material, supports, loads):
    young = number(material.get("youngModulusMPa"), "Young modulus (MPa)", .0001, 1e8)
    poisson = number(material.get("poissonRatio"), "Poisson ratio", -.9, .49)
    element = ElementVector(ElementTetP2())
    basis = Basis(mesh, element)
    if basis.N > 220000:
        raise StudyError("Quadratic system exceeds 220,000 degrees of freedom; increase element size", "mesh_failed")
    lamb, mu = lame_parameters(young, poisson)
    stiffness = asm(linear_elasticity(lamb, mu), basis)
    force = np.zeros(basis.N)
    support_facets = np.unique(np.concatenate([_boundary(mesh, s, "Support") for s in supports]))
    fixed = basis.get_dofs(facets=support_facets).all()
    load_regions = []
    requested_force = np.zeros(3)
    for load in loads:
        vector = vec(load.get("forceN"), "Load forceN")
        facets = _boundary(mesh, load, "Load")
        if np.intersect1d(facets, support_facets).size:
            raise StudyError("A load face overlaps a fixed support; select distinct physical regions")
        area = _area(mesh, facets)
        traction = vector/area
        @LinearForm
        def surface_force(test, w):
            return np.einsum("i,ijk->jk", traction, test)
        force += asm(surface_force, FacetBasis(mesh, element, facets=facets))
        requested_force += vector
        load_regions.append({"facets": facets.tolist(), "areaMm2": area, "forceN": vector.tolist()})
    if not np.any(force):
        raise StudyError("At least one nonzero load is required")
    with warnings.catch_warnings():
        warnings.simplefilter("error", MatrixRankWarning)
        try:
            displacement = solve(*condense(stiffness, force, D=fixed))
        except (MatrixRankWarning, RuntimeError, ValueError) as error:
            raise StudyError("Elastic system could not be solved; inspect supports and disconnected geometry", "invalid_geometry") from error
    if not np.isfinite(displacement).all():
        raise StudyError("Elastic solution is non-finite; inspect rigid-body constraints", "invalid_geometry")
    residual = stiffness@displacement-force
    free = basis.complement_dofs(fixed)
    normalized = float(np.linalg.norm(residual[free])/max(np.linalg.norm(force), 1e-15))
    components = basis.split_indices()
    reaction = np.array([residual[np.intersect1d(fixed, component)].sum() for component in components])
    balance = float(np.linalg.norm(reaction+requested_force)/max(np.linalg.norm(requested_force), 1e-15))
    # Include both vertex and edge basis DOFs in equilibrium/moment checks.
    reaction_moment = np.zeros(3)
    applied_moment = np.zeros(3)
    for i, indices in enumerate(components):
        unit = np.zeros(3); unit[i] = 1
        constrained = np.intersect1d(fixed, indices)
        reaction_moment += np.cross(basis.doflocs[:, constrained].T, residual[constrained, None]*unit).sum(axis=0)
        applied_moment += np.cross(basis.doflocs[:, indices].T, force[indices, None]*unit).sum(axis=0)
    gradient = basis.interpolate(displacement).grad
    strain = .5*(gradient+np.swapaxes(gradient, 0, 1))
    stress = 2*mu*strain
    trace = np.einsum("iikl->kl", strain)
    for i in range(3):
        stress[i, i] += lamb*trace
    mean = np.sum(stress*basis.dx[None, None, :, :], axis=3)/np.sum(basis.dx, axis=1)[None, None, :]
    mises = np.sqrt(.5*((mean[0,0]-mean[1,1])**2+(mean[1,1]-mean[2,2])**2+(mean[2,2]-mean[0,0])**2)+3*(mean[0,1]**2+mean[1,2]**2+mean[2,0]**2))
    nodal = displacement[basis.nodal_dofs].T
    max_displacement = float(np.linalg.norm(nodal, axis=1).max())
    if normalized > 1e-7 or balance > 1e-7:
        raise StudyError(f"Equilibrium check failed (residual {normalized:g}, balance {balance:g})", "unconverged")
    boundary_indices = mesh.boundary_facets()
    surfaces = mesh.facets[:, boundary_indices].T
    surface_index = {int(facet): index for index,facet in enumerate(boundary_indices)}
    for load in load_regions:
        load["surfaceTriangleIndices"] = [surface_index[facet] for facet in load.pop("facets")]
    moment_error = float(np.linalg.norm(reaction_moment+applied_moment)/max(np.linalg.norm(force)*float(np.ptp(mesh.p,axis=1).max()),1e-15))
    available = []
    for axis in ("x", "y", "z"):
        for side in ("min", "max"):
            try:
                found = _boundary(mesh, {"axis":axis,"side":side}, "Face")
                available.append({"axis": axis, "side": side, "areaMm2": _area(mesh, found)})
            except StudyError:
                pass
    return {"mesh": {"vertices": mesh.p.T.tolist(), "tets": mesh.t.T.tolist(), "surface": surfaces.tolist(), "vertexCount": int(mesh.nvertices), "elementCount": int(mesh.nelements), "degreesOfFreedom": int(basis.N)}, "displacement": nodal.tolist(), "vonMises": mises.tolist(), "fieldAssociations": {"displacement":"vertex", "vonMises":"tetrahedron"}, "maxDisplacementMm": max_displacement, "maxVonMisesMPa": float(mises.max()), "p95VonMisesMPa": float(np.percentile(mises,95)), "reactionN": reaction.tolist(), "appliedForceN": requested_force.tolist(), "reactionMomentNmm": reaction_moment.tolist(), "appliedMomentNmm": applied_moment.tolist(), "normalizedResidual": normalized, "forceBalanceRelativeError": balance, "momentBalanceRelativeError": moment_error, "supports": {"surfaceTriangleIndices": [surface_index[int(f)] for f in support_facets], "areaMm2": _area(mesh,support_facets)}, "loads": load_regions, "availableBoundaryFaces": available}


def strength(request, directory):
    geometry = prepare_geometry(request, directory)
    material = request.get("material")
    if not isinstance(material, dict):
        raise StudyError("Choose an engineering material with Young modulus and Poisson ratio")
    supports, loads = request.get("supports"), request.get("loads")
    if not isinstance(supports, list) or not 1 <= len(supports) <= 12 or not isinstance(loads, list) or not 1 <= len(loads) <= 12:
        raise StudyError("Specify one or more physical support and load regions")
    mesh_options = request.get("mesh", {})
    size = number(mesh_options.get("maxSizeMm", max(min(geometry["bounds"]["size"])/2,.5)), "Maximum element size", .05, 1000)
    refinements = mesh_options.get("refinements", 0)
    if isinstance(refinements, bool) or not isinstance(refinements,int) or not 0 <= refinements <= 2:
        raise StudyError("refinements must be 0, 1 or 2")
    history, result = [], None
    for level in range(refinements+1):
        current_size = size * .7**level
        mesh, volume, volume_error = _mesh_geometry(geometry,current_size,directory,level)
        result = _solve(mesh,material,supports,loads)
        history.append({"maxSizeMm":current_size, "elements":int(mesh.nelements), "volumeMm3":volume, "volumeRelativeError":volume_error, "maxDisplacementMm":result["maxDisplacementMm"], "p95VonMisesMPa":result["p95VonMisesMPa"]})
    convergence = {"status":"not_assessed", "levels":history}
    if refinements:
        previous, current = history[-2:]
        displacement_change = abs(current["maxDisplacementMm"]-previous["maxDisplacementMm"])/max(current["maxDisplacementMm"],1e-15)
        stress_change = abs(current["p95VonMisesMPa"]-previous["p95VonMisesMPa"])/max(current["p95VonMisesMPa"],1e-15)
        passed = refinements == 2 and displacement_change < .02 and stress_change < .05
        convergence.update(status="converged" if passed else "unconverged", displacementRelativeChange=displacement_change, p95StressRelativeChange=stress_change, displacementTolerance=.02, p95StressTolerance=.05)
    result["diagnostics"] = {"normalizedResidual":result["normalizedResidual"], "forceBalanceRelativeError":result["forceBalanceRelativeError"], "momentBalanceRelativeError":result["momentBalanceRelativeError"], "sourceVolumeMm3":geometry["volumeMm3"], "meshVolumeMm3":history[-1]["volumeMm3"], "meshVolumeRelativeError":history[-1]["volumeRelativeError"]}
    result.update(status="unconverged" if convergence["status"]=="unconverged" else "solved", type="strength", geometry={k:v for k,v in geometry.items() if k not in ("path","part")}, convergence=convergence, material=material, units={"length":"mm","force":"N","stress":"MPa","moment":"N mm"}, assumptions=["Single component, small-strain static isotropic linear elasticity.","Specified support faces are fully fixed; bolt/contact/preload behavior is not inferred.","Loads are uniformly distributed tractions on the selected faces.","Quadratic displacement interpolation on straight-sided tetrahedra.","Peak stress at sharp corners or clamp boundaries may be singular; convergence uses the 95th-percentile element stress.","Numerical verification does not establish physical manufacturing readiness."])
    if "densityKgM3" in material:
        result["massKg"] = geometry["volumeMm3"]*1e-9*number(material["densityKgM3"],"Density kg/m3",.01,1e6)
    if "yieldStrengthMPa" in material:
        strength_value = number(material["yieldStrengthMPa"],"Yield strength MPa",.001,1e7)
        result["yieldToPeakStressRatio"] = strength_value/max(result["maxVonMisesMPa"],1e-15)
    length = max(geometry["bounds"]["size"])
    if result["maxDisplacementMm"] > .05*length:
        result["assumptions"].append("Deflection exceeds 5% of component span; geometric nonlinearity may invalidate this linear study.")
        result["linearRegimeWarning"] = True
    return result
