# Hardware Studio

**12/12 propagation fixtures pass; 6/6 invalid designs are rejected.** Recompute these bounded consistency checks with `npm run measure`; their scope is documented in [FACTS.md](FACTS.md).

Try a working hardware design, customize it together, and export a package that stays tied to the accepted design.

Live app: https://hardware-studio-8bev.onrender.com (guided path at https://hardware-studio-8bev.onrender.com/judge).

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

Create the Python environment only once. For language/visual proposals, set the selected provider's key in the private .env: `OPENAI_API_KEY` for the default `AI_PROVIDER=openai`, or `ANTHROPIC_API_KEY` with `AI_PROVIDER=anthropic` (see [docs/AI-PROVIDERS.md](docs/AI-PROVIDERS.md)). Open http://127.0.0.1:4174. Annotation collaboration listens locally on port 4175. For development use npm run dev at http://127.0.0.1:5173.

## Start here

Open /judge for the guided path. Try the turntable, make a copy, change a dimension, invite a collaborator, inspect assembly and export. The catalog also contains a camera slider, sorting conveyor, articulated lamp, watering planter and work holder. New designs use the same validated primitive assembly format.

## Verification

```sh
npm test
npm run measure
npm run build
poetry run python -m pytest
npm run test:e2e
```

The measurement script recomputes deterministic propagation and invalid-input checks, including a disconnected-dimension negative control. These are fixture results, not a manufacturing certification or measured user benefit. Tests and production browser checks are recorded separately.

## Design consistency

The model proposes structured changes. The server validates dimensions and dependencies before atomically accepting a new revision. Independently edited parameters can merge; conflicting assumptions require a fresh proposal. Geometry workers export an immutable snapshot, never whichever revision happens to finish last. Each package contains its revision, inputs, sources and hashes.

Yjs/Hocuspocus shares annotations; authoritative commands handle engineering changes. SQLite persists accepted revisions, operation history, annotation documents and build jobs. Share links carry viewer or editor capabilities: treat editor links like a password.

## Develop a design

Select or circle a visible part to edit its supported dimensions, holes and walls. Preview the change before accepting it. Turn on Voice, hover over a named part, then speak your request and review the proposal before accepting. Proposed versions let collaborators and scoped agents experiment without changing the main design; acceptance requires review of both current revisions.

The engineering workspace runs linear-elastic finite-element studies on the actual selected solid, shows displacement and stress fields, and compares results using identical setups. Review the component-local fixed end, loaded end and force direction before running. Enter a declared payload or force, material values and mesh settings explicitly. An unconverged result can be refined using its recorded inputs; changing the setup form does not change that earlier study, and outdated results require a new review. Manufacturing checks compare recognized features with editable FDM, milling or turning profiles. Rigid-body studies use explicit connections and entered masses, with rectangular-envelope inertia and visible motion limits.

Import STEP, STL, OBJ or GLB originals and confirm units and the selected body. Supported common-axis plates, cylinders, tubes, holes and counterbores can become editable after measured surface/volume comparisons. Unsupported freeform or mixed-axis features remain view/analysis-only. Original files are retained, and a concurrent import configuration change requires another review before analysis.

The design agent proposes measured changes; the engineering agent reads that revision and runs component checks. Both work inside the proposed version. External MCP credentials are restricted to that version and are revoked on acceptance or rejection. Native browser tools are optional and require a browser exposing the experimental `document.modelContext` API. Registration and cleanup are tested against the current API contract; use in an enabled browser has not yet been observed.

Product video export creates a 20-second, 1080p, 30 fps MP4 from one frozen design revision. The preview and export use the same frame-based camera, motion and exploded-view timeline. Install Chromium with `npx playwright install chromium` and provide FFmpeg on the server. Jobs support cancellation and authenticated downloads.

## What to review before fabrication

These are editable prototype designs, not validated load-bearing products or machine-ready instructions. Bought parts use simplified envelopes; confirm vendor dimensions and part availability. Review fasteners, fits, material, electrical protection, stability and process setup. STEP solid validation does not prove assembly fit or real-world performance. Wiring/control guides require review against the exact selected components. No machine-specific G-code is generated.

Visual input asks for missing dimensions. It cannot reliably infer hidden geometry, tolerances, torque or wiring from a photograph. Voice uses browser speech recognition to transcribe one request at a time; it does not provide spoken replies, and real microphone recognition quality has not been verified. Typed input remains available. The default catalog motion and water/sensor illustrations are explanatory kinematics. The separate mechanism study runs rigid-body dynamics from explicitly entered masses, joints, gravity and drive limits; it excludes bending, collisions and friction.

When no AI key is available, explicit whole-design dimension commands remain available and are identified in the proposal. Selected-part requests return a clarification; supported part controls remain available. Generated appearance assets and environments are optional; Meshy/Skybox accounts are not bundled. No real supplier quote is requested by this application.

## Services and data

- OpenAI `gpt-6-astra` (default) or Anthropic `claude-opus-5-5` (explicit alternative, no automatic fallback): language and image input produces typed proposals for review.
- CadQuery/Open Cascade: constructs and verifies exact CAD solids.
- React Three Fiber/Three.js: interactive viewport and kinematic preview.
- Yjs/Hocuspocus: collaborative annotations and presence.

Local data lives in .data and stays out of Git. Do not expose this local preview to the internet without deployment access controls and operational review.

## Hosting preparation

See [hosting configuration](docs/HOSTING.md) for persistent storage, listener settings and same-origin HTTPS collaboration. Public hosting and access controls must be configured separately from the local preview.

## Third-party materials

See [third-party attribution](THIRD_PARTY.md) for libraries, CAD dependencies, fonts, hosted services and the versioned runtime inventory.
