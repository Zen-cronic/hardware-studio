# Source imports and measured reconstruction

`cad.reconstruction` accepts a trusted JSON input file and emits its result as the last stdout line. Native-reader output is redirected to stderr. The browser never sends filesystem paths. The server stores original bytes under an opaque ID with a SHA-256, read-only permissions, explicit source units and an operation history. Inspection/reconstruction runs in a separate Python process with a 150-second timeout, 8 MB source cap, 16-body cap, 300,000-triangle per-body limit and 32 MB output cap.

The public flow is upload → inspect units/body → request reconstruction → review measured fit → explicitly accept a new custom design. The old source and the original design remain intact. The accepted design gets another authorized attachment to the same immutable original. All routes require a design capability; upload, reconstruction and acceptance require editor access. Downloads require viewing access and recheck source integrity. Acceptance is idempotent and bound to the latest job plus its input hash. Raw local paths are never returned by the API.

## Geometry and limits

STEP uses the exact OCCT B-rep for solid validity, planar/cylindrical extraction and volume comparison. Display tessellation is separate from the original solid. STL/OBJ/GLB use Trimesh scene loading, retain scene-node transforms, apply an explicit scale to millimetres, and require one watertight, positively oriented, manifold and non-self-intersecting connected body per selected object. The original bytes are unchanged; exact coincident mesh vertices are merged only in the working copy. OBJ external material references are skipped; file loading uses memory buffers without a filesystem resolver.

Editable candidates are boxes/plates, simple cylinders/tubes, through-holes and top-face counterbores along one common axis. The source can be rotated: recognition normalizes a right-handed local frame and stores that pose as the existing Part XYZ Euler rotation. Counterbores on a common bottom side can be normalized by flipping the frame. **This is a bounded feature vocabulary, not recovered CAD feature history.** It deliberately uses the existing Part schema instead of introducing general axis-aware features.

Fillets, chamfers, freeform surfaces, mixed-axis features, partial cylinders, blind holes, complex stepped shafts/bores and mixed-side counterbores are not silently dropped. They remain source-view/analysis-only when their solid is valid. Invalid/open/coarse meshes cannot become editable merely by increasing a bounding-box match. Very thin geometry may fail the finite occupancy sampling budget. One rotated binary STL exported from OCCT was conservatively rejected because Open3D reported near-coplanar self-intersections; the source was not repaired. Rotated STEP and a rotated GLB box pass. Prefer STEP for exact mechanical solids.

Mesh recognition uses connected smooth lateral patches, a bounded least-squares circle fit, full-circumference coverage and a planar frame. Circular-fit residuals are reported per recognized feature. STEP cylinders are extracted analytically (reported zero extraction residual); this does not mean zero whole-body tessellation distance. Mesh segmentation and source faceting limit accuracy; no claim of arbitrary CAD reconstruction is made.

## Measurement gate

Both directions are measured: original surface → candidate and candidate → original. Sample sets contain every mesh vertex, every face centroid, and a deterministic seeded area-weighted surface sample. The maximum is **sampled**, not a certified Hausdorff bound. It must be within the user-declared 0.001–1 mm tolerance.

STEP volumetric difference uses the exact B-rep symmetric difference divided by the union volume. Meshes use 65,536 deterministic Sobol occupancy points over the combined bounding box. Their differing occupied fraction is compared to the source/candidate union, with a Wilson-style conservative margin. That margin is a heuristic for quasi-random samples, not a rigorous 95% confidence interval. The existing JSON field is named `upper95RelativeDifference` for the nominal Wilson calculation, and `samplingMarginNote` explicitly records the limitation. Acceptance requires this volume measure to be at most 1%, in addition to the bidirectional surface gate. Equal total volume alone is insufficient.

The new Part is generated again using the same CAD geometry engine used by other designs. Once accepted, enlarging or shrinking a recognized hole, or changing thickness, produces new CAD from dimensions. The original imported source is always separately available. Fit acceptance is not manufacturing certification.

## Imported strength studies

`resolveImportGeometry(store, designId, importId)` returns an internal trusted path, format, scale, selected body and original hash after checking source ownership, finished inspection, solid validity and file integrity. The engineering API owns authorization and passes this geometry internally to the existing real elasticity worker. The UI supplies declared elastic properties, actual force components, fixed/loaded end faces and mesh size. Source coordinates are scaled import/world coordinates; supports and loads are not inferred from assembly adjacency. Study output and all unsupported-physics limitations belong to the actual engineering result.

## Verification

Run from the product directory, using the established pyenv environment:

```bash
cd /opt/hardware-studio
export VIRTUAL_ENV="$(pyenv root)/versions/.victoria-hardware"
export PATH="$VIRTUAL_ENV/bin:$PATH"
poetry run python -m pytest /opt/hardware-studio/tests/reconstruction_test.py -q
npx vitest run /opt/hardware-studio/tests/imports.test.ts
```

The Python tests cover rotated STEP holes/counterbores, actual diameter enlarge/shrink and thickness regeneration, STL/OBJ/GLB counterparts, cylinders/tubes, GLB units/body placements, unsupported fillet/mixed-axis sources, open/coarse rejection, different hole locations with equal total volume, source hashing and the CLI protocol. The Node test uses real Python workers and checks authorization, unsafe filenames, unchanged downloads/hashes, cross-design rejection, fit/hash-gated acceptance, idempotency, source linkage and subsequent editable hole shrink. Browser journeys additionally cover editable acceptance and source-based strength analysis.

Reconstruction uses the pinned CadQuery/OCP, Trimesh, SciPy, NumPy and Open3D dependencies; see the engineering dependency/license inventory.
