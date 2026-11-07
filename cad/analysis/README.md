# Engineering worker

The `cad.engineering` module accepts an `--input` flag containing an absolute JSON-file path. Without that flag it reads JSON stdin. It uses the project's existing Poetry Python environment. The calling server must resolve file paths inside an owned immutable upload/job directory; filesystem paths are not a public API.

The last stdout line is the JSON result. Native geometry logs go to stderr. Exit 0 means a result was calculated (`solved` or `unconverged`), not that a physical design is safe; exit 2 carries an actionable result (`needs_inputs`, `invalid_geometry`, `mesh_failed`, `unsupported_physics` or `failed`). Parse JSON on either exit code.

Every request includes a type and immutable `source` identity. Results echo source, schemaVersion1 and a SHA-256 inputHash. Imported bytes receive a separate importedSourceHash included in inputHash, so changing bytes at the same path changes identity. HTTP jobs must additionally freeze snapshots and prevent stale results from being shown as current.

## Geometry

Use `part` (existing Part contract), or `snapshot` plus `partId`. Generated parts are analyzed in their own local coordinates; the viewer applies the existing position/rotation to both undeformed and deformed fields.

Alternatively omit part/snapshot and pass `geometry: {path, format, scaleToMm, bodyIndex?}`. Supported formats are step/stp, stl, obj and glb. STEP imports use OCCT's unit normalization; additional scale normally equals1. Mesh scale converts source coordinates to mm; standard GLB coordinates use metres, so1000. STL/OBJ require the operator to establish units. GLB node transformations are retained. Multiple bodies need explicit bodyIndex. There is no inferred bonding, convex hull replacement, hole filling or surface thickening.

Imports must have a valid single solid. Mesh imports undergo watertightness, orientation, manifold, connectedness and self-intersection checks. Only coincident vertices at12decimal places are merged to interpret disconnected STL triangle records; no geometric gap repair is performed. Source data stays untouched. Mesh parsing uses in-memory bytes with materials disabled, so external material/texture paths are not followed. Surface-only and invalid geometry returns an explicit unsupported/invalid result.

## Strength

Inputs:

- `material: {name?, youngModulusMPa, poissonRatio, densityKgM3?, yieldStrengthMPa?, source?}`.
- `supports: [{axis: 'x'|'y'|'z', side: 'min'|'max'}]` fully fixes the selected complete planar boundary faces. Explicit local-coordinate `{min:[x,y,z],max:[x,y,z]}` regions are also supported.
- `loads: [{axis,side,forceN:[x,y,z]}]` distributes total force uniformly over selected faces; the explicit min/max region form is also supported.
- `mesh: {maxSizeMm?, refinements?:0|1|2}`. Three meshes are needed before convergence can be marked assessed/converged.

The component solid is exported to STEP and meshed in a separate Netgen process to avoid competing OCCT native-library instances. Validated mesh imports are normalized to STL. The solver uses scikit-fem quadratic displacement interpolation over straight-sided tetrahedra, isotropic small-strain static elasticity and fully fixed support regions. It includes consistent distributed loads, free-DOF residuals, force/moment equilibrium and volume diagnostics.

Results include `mesh:{vertices,surface,tets}`, per-vertex `displacement`, per-tetrahedron `vonMises`, explicit fieldAssociations, units, reactionN, reactionMomentNmm, maxDisplacementMm, maxVonMisesMPa, p95VonMisesMPa, diagnostics, availableBoundaryFaces, convergence and assumptions. `supports.surfaceTriangleIndices` and each `loads[].surfaceTriangleIndices` index the returned `mesh.surface` array. Convergence uses displacement change<2% and 95th-percentile cell stress change<5%; sharp-corner/clamp peak stresses can be singular. A coarse single solve says `not_assessed`, never converged.

The selected source must be one connected physical component. Bolted/contact/preload behavior, printed anisotropy, large deflection, thermal stresses, plasticity, fatigue, creep, flexible belts and coupled assembly mechanics are not supplied by this worker. A yield/peak-stress ratio is a calculation with declared material assumptions, not a strength-pass certification.

## Manufacturing

Use `profile:'fdm'|'cnc'|'turning'` and optional `processProfile` overrides. Numeric defaults are explicit editable example shop settings, not universal supplier requirements. Recognized features are compared against wall/web, hole, tool-reach/access, setup and machine-envelope constraints. Each finding identifies a part/feature and the governing profile. Imported unreconstructed geometry receives envelope checks with the missing feature checks explicitly listed. Workholding, CAM, actual machine capability and physical fits remain unassessed.

## Mechanisms

All cases require material.densityKgM3 and explicit `mechanism.kind`:

- `arm`: payloadKg, reachMm, optional angleDeg, centerOfMassReachMm, holdingTorqueNm and jointLimitsDeg. Reports payload/self-weight holding torque under stated levers.
- `rotary`: axis, rpm, accelerationSeconds, optional pivotLocalMm, efficiency, frictionTorqueNm, availableTorqueNm. Uses the complete solid's mass tensor, not a bounding-box inertia. Unspecified pivot is the center of mass.
- `linear`: speedMmS, travelMm, accelerationSeconds, optional payloadKg, efficiency, frictionForceN, availableForceN.
- `hydrostatic`: liquidDepthMm, liquidDensityKgM3 and wallWidthMm; static vertical rectangular wall resultant.

These are quasi-static/rigid-body calculations. A separate joint/contact dynamics implementation must supply any animated rigid-body simulation claim.
