# CAD build worker

The worker converts an accepted design revision into exact CadQuery/OCCT solids and review documents. It does not execute model-generated Python.

## Run

Python 3.12 is managed by pyenv-virtualenv and Poetry:

```sh
pyenv virtualenv 3.12.14 .victoria-hardware
export VIRTUAL_ENV="$HOME/.pyenv/versions/.victoria-hardware"
export PATH="$VIRTUAL_ENV/bin:$PATH"
poetry install
poetry run python -m cad.build --input snapshot.json --output output/new-revision
poetry run pytest tests/cad_exports_test.py -q
```

The CLI returns one JSON object on stdout with the archive and manifest paths. Errors are JSON on stderr with a nonzero exit code. The Node API chooses the output directory; the worker refuses to overwrite a different accepted build.

## Geometry contract

- Millimetres, Y up, XYZ intrinsic Euler rotations in radians.
- Box dimensions are X/Y/Z. Cylinder/tube size is outer diameter / axial height / outer diameter; their local axis is Y.
- Individual STEP/STL exports use centered local part coordinates. Assembly STEP carries placed parts. Drawings show local orthographic views and nominal dimensions.
- GLB carries placed geometry in metres, with an explicit conversion node and preserved Y-up axes.
- Reference envelopes are excluded from manufacturing exports and BOM. Purchased components remain simplified geometry and are identified as bought parts.
- Analytic box, cylinder and through-bored tube solids are supported. Thread form, bosses, arbitrary holes, toleranced fits and arbitrary curved surfaces are not inferred.

## Package contents

STEP assembly and individual parts, individual STL meshes, GLB assembly, dimensioned SVG drawings, BOM CSV, assembly sequence, wiring/control intent, process preparation and a quote-request document. `design.json` and `manifest.json` bind these to one revision.

`source.py` and the included `cad/` module rebuild the package. `parametric/` contains the same TypeScript dependency engine and catalog as the application; edit top-level design parameters and run its documented recalculation command before rebuilding. Independent primitive dimensions can also be edited directly. Local edits do not update collaborative server history.

## Verification and limits

Each STEP is reopened, checked for valid solids and compared against its source volume and exact bounds. Bounds ignore cached tessellation so STL export cannot change the dimensional oracle. The assembly is checked for expected solid count. Artifact hashes and exporter/kernel identity are recorded; mismatched or altered cached builds are rejected. ZIP contents have safe relative paths, and CSV cells escape spreadsheet formula prefixes.

The tests exercise all six actual engine examples, twelve held-out parameter changes, invalid dimensions, three primitive types, Three.js-compatible compound rotations, immutable output, source rebuilds and reference filtering. These are geometry and consistency tests, not physical manufacture, strength, electrical certification or CAM verification. Source links and exact purchased parts still need review. No fabrication quote is sent.
