# Hardware Studio

**12/12 propagation fixtures pass; 6/6 invalid designs are rejected.** Recompute these bounded consistency checks with `npm run measure`; their scope is documented in [FACTS.md](FACTS.md).

Try a working hardware design, customize it together, and export a package that stays tied to the accepted design.

## Run locally

Node 24, Python 3.12, pyenv-virtualenv and Poetry are used.

```sh
npm ci
pyenv virtualenv 3.12.14 .victoria-hardware
export VIRTUAL_ENV="$HOME/.pyenv/versions/.victoria-hardware"
export PATH="$VIRTUAL_ENV/bin:$PATH"
poetry install
cp .env.example .env
npm run build
npm start
```

Create the Python environment only once. Set OPENAI_API_KEY in the private .env for language/visual proposals. Open http://127.0.0.1:4174. Annotation collaboration listens locally on port 4175. For development use npm run dev at http://127.0.0.1:5173.

## Start here

Open /judge for the guided path. Try the turntable, make a copy, change a dimension, invite a collaborator, inspect assembly and export. The catalog also contains a camera slider, sorting conveyor, articulated lamp, watering planter and work holder. New designs use the same validated primitive assembly format.

## Verification

```sh
npm test
npm run measure
npm run build
poetry run pytest
npm run test:e2e
```

The measurement script recomputes deterministic propagation and invalid-input checks, including a disconnected-dimension negative control. These are fixture results, not a manufacturing certification or measured user benefit. Tests and production browser checks are recorded separately.

## Design consistency

The model proposes structured changes. The server validates dimensions and dependencies before atomically accepting a new revision. Independently edited parameters can merge; conflicting assumptions require a fresh proposal. Geometry workers export an immutable snapshot, never whichever revision happens to finish last. Each package contains its revision, inputs, sources and hashes.

Yjs/Hocuspocus shares annotations; authoritative commands handle engineering changes. SQLite persists accepted revisions, operation history, annotation documents and build jobs. Share links carry viewer or editor capabilities: treat editor links like a password.

## What to review before fabrication

These are editable prototype designs, not validated load-bearing products or machine-ready instructions. Bought parts use simplified envelopes; confirm vendor dimensions and part availability. Review fasteners, fits, material, electrical protection, stability and process setup. STEP solid validation does not prove assembly fit or real-world performance. Wiring/control guides require review against the exact selected components. No machine-specific G-code is generated.

Visual input asks for missing dimensions. It cannot reliably infer hidden geometry, tolerances, torque or wiring from a photograph. Voice support depends on the browser; typed input remains available. Kinematic animations and water/sensor illustrations are explanatory models, not physical simulation.

When no AI key is available, explicit local dimension commands remain available and are identified in the proposal. Generated appearance assets and environments are optional; Meshy/Skybox accounts are not bundled. No real supplier quote is requested by this application.

## Services and data

- OpenAI: language and image input produces typed proposals for review.
- CadQuery/Open Cascade: constructs and verifies exact CAD solids.
- React Three Fiber/Three.js: interactive viewport and kinematic preview.
- Yjs/Hocuspocus: collaborative annotations and presence.

Local data lives in .data and stays out of Git. Do not expose this local preview to the internet without deployment access controls and operational review.
