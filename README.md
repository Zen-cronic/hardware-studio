# Hardware Studio

**Point at any part and say what to change.**
Hardware Studio redesigns it in 3D, tests that it still holds, and lets you see it in your room before you build it.

In its strength simulation, making a part 4 → 6 mm thick cuts its bending by 70% under the same stated load: the camera drone's front-right arm goes from 1.19 to 0.36 mm under 1 kgf (9.8 N) of peak motor thrust, and the camera arm's upper link from 0.25 to 0.076 mm under a 0.5 kg (4.9 N) payload.

Live app: https://hardware-studio-8bev.onrender.com. No sign-in. For a five-step guided path, open https://hardware-studio-8bev.onrender.com/judge.

![Hardware Studio with a camera drone open. The pointer rests on one arm, a blue circle sits under it, and a label names the exact surface: "Arm, rear right, top face". The bar at the bottom says to hold Space or the mic, point at a part and say what to change.](docs/images/studio-pointing.png)

## What it does

The guided path at `/judge` walks through these five steps on the camera drone.

1. **Open the camera drone.** Start from one of eight working designs (a camera drone, a desk camera arm, a turntable, a camera slider, a sorting conveyor, a task lamp, a watering planter and a work holder), from simple shapes, or from an imported STEP, STL, OBJ or GLB file. A new request starts from the closest working design.
2. **Describe a change.** A blue circle follows the pointer and names the exact part or feature under it, for example "Arm, rear right, top face" or "Upper arm link · Ø6.4 mm hole 1". You can also draw a circle around a part to select it. Hold Space (or the mic button) and talk, or type. The target freezes when you start speaking, so moving the mouse mid-sentence does not change what you meant. The assistant answers out loud through the browser's speech synthesis (you can mute it), and its own circle moves to the part it is talking about. If a request is ambiguous, such as "make the hole 8 mm" on a part with two holes, it asks "Which hole?" instead of guessing.
3. **Check it still holds.** Before you apply a change, the check runs the same linear strength simulation on the old and the new part under the same stated load. On the drone, thickening the arms from 4 to 6 mm makes the front-right arm bend 1.19 → 0.36 mm (−70%) under 1 kgf (9.8 N) of peak motor thrust, and its 95th-percentile stress falls from 22.3 to 10.6 MPa (−52%). On the camera arm, the upper link going from 4 to 6 mm bends 0.25 → 0.076 mm (−70%) under a 0.5 kg (4.9 N) payload. The card also says where the part is held, where the load is applied and which material was used.
4. **See it in your room.** "See it in your room" shows a QR code. Scan it with an iPhone or Android phone to open a view-only page that places the design at real size, using model-viewer with AR Quick Look, Scene Viewer or WebXR. The phone model is prepared when the sheet opens, and the QR code appears once it is ready.
5. **Get build files.** "Get build files" packages CAD (STEP, STL and GLB), a parts list and assembly steps. Every file is tied to the accepted revision and listed with its SHA-256 hash.

![The change review for the camera drone. The request "Make these arms stiffer" points at the front-right arm. The card says all four arms go from 4 to 6 mm thick and shows 70% less bending, 1.19 mm before and 0.36 mm after, under the same 1 kgf (9.8 N) peak motor thrust. The tested arm is marked on the model.](docs/images/strength-check.jpg)

Two people can edit the same design live from a share link. Dimensions, components and history sit in the engineering details panel. A separate engineering view holds the strength setup, manufacturing checks against FDM, milling and turning profiles, mechanism studies, product-video export, proposed versions and scoped agent connections.

## Who it's for

Makers, students and small hardware teams who want a part designed and checked without learning 3D design software. You point, say what you want and read a plain answer; the exact dimensions, strength setup and build files stay available when you need them.

## How the AI is used

Every change goes through the same four stages: propose, validate, check, accept.

1. **Propose.** The request, the pointed target (part, feature, hit point and surface normal) and the current design go to the language model: OpenAI `gpt-6-astra` by default, or Anthropic `claude-opus-5-5` when selected explicitly (no automatic fallback). It returns a structured change made of parts, parameters and operations, never code to run. Words such as "this" or "that hole" bind to the pointed feature.
2. **Validate.** The server recomputes the pointed feature from the current geometry, rejects a target that no longer matches, and checks dimensions, dependencies and revision conflicts. A request it cannot resolve becomes a question. A fully specified edit of the pointed feature is resolved locally without a model call.
3. **Check.** The strength simulation compares the original and the proposed part under the same recorded part, material, held end, load and mesh settings. A mismatched, unconverged, failed or outdated study is labeled as such instead of compared.
4. **Accept.** Nothing changes until the person accepts. The accepted revision then drives the 3D view, the room view and the build files.

Voice input uses the browser's Web Speech API, and spoken replies use the browser's speech synthesis. Typing works in every browser. When no AI key is configured, direct dimension and part controls still work.

### Requests it wasn't prepared for

<!-- unseen-requests-table -->

## What we'll tell you before you find it

- **One part at a time.** The strength check simulates a single part, not the whole assembly. Joints, contact and fasteners are not modeled, and the held end approximates a pinned or bolted joint.
- **A simulation under a stated load.** The check is linear-elastic finite-element analysis under the load shown on the card. It is not a physical test or a certification, and a different load or support would give different numbers.
- **No flight, battery or printing claims.** Nothing here says the drone will fly, how long a battery will last, or that a part can be printed or machined without review. Review fasteners, fits, material, electrical protection and process setup before you build.
- **New requests start from the closest working design.** The assistant edits and combines supported parts. It does not invent arbitrary new mechanisms or freeform shapes.
- **Voice depends on the browser.** Speech recognition works best in desktop Chrome, and some browsers do not offer it. Typing always works.
- **Bought parts are simplified envelopes.** Motors, propellers, bearings, cameras and electronics are simplified shapes with nominal sizes. Confirm vendor dimensions and availability.
- **No G-code.** Build files contain CAD, a parts list and assembly steps, not machine instructions.
- **Native browser agent tools are optional.** They need a browser that exposes the experimental `document.modelContext` API. Registration and cleanup are tested against the current API contract, but they have not been observed in a browser that enables them.
- **Pointing reads the design, not the screen.** It recognizes the features each part declares (holes, bores, channels, flat faces and round outer surfaces). Anything else is described as a face with its direction and position.
- **Photos ask for missing dimensions.** A reference image cannot reveal hidden geometry, tolerances, torque or wiring.
- **Motion is illustrative.** Catalog motion and water or sensor animations explain how a design works. The separate mechanism study runs rigid-body dynamics from entered masses, joints, gravity and drive limits, and leaves out bending, collisions and friction.
- **One shared server.** The public app runs on a single instance. CAD packages take seconds; a product video takes several minutes. Generated appearance assets, supplier quotes and provider subscriptions are not included.

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

The `pyenv virtualenv` step is needed once. For language and image proposals, set the selected provider's key in `.env`: `OPENAI_API_KEY` for the default `AI_PROVIDER=openai`, or `ANTHROPIC_API_KEY` with `AI_PROVIDER=anthropic` (see [docs/AI-PROVIDERS.md](docs/AI-PROVIDERS.md)). Open http://127.0.0.1:4174. Annotation collaboration listens locally on port 4175. For development, `npm run dev` serves http://127.0.0.1:5173. Voice input needs a browser with speech recognition, such as desktop Chrome.

## Verification

```sh
npm test
npm run measure
npm run build
poetry run python -m pytest
npm run test:e2e
```

`npm run measure` recomputes the deterministic design-consistency fixtures: 12/12 propagation fixtures pass and 6/6 invalid designs are rejected, including a disconnected-dimension negative control. These are fixture results, not a manufacturing certification or a measured user benefit. Their scope is recorded in [FACTS.md](FACTS.md).

## Design consistency

The model proposes structured changes. The server checks dimensions and dependencies before atomically accepting a new revision. Independently edited parameters can merge; conflicting assumptions require a fresh proposal. Geometry workers export an immutable snapshot, never whichever revision happens to finish last. Each package records its revision, inputs, sources and hashes.

Proposed versions let collaborators and scoped agents experiment without changing the main design; accepting one requires review of both current revisions. Yjs/Hocuspocus shares annotations, while authoritative commands handle engineering changes. SQLite persists accepted revisions, operation history, annotation documents and build jobs. Share links carry viewer or editor capabilities: treat an editor link like a password.

## Engineering workspace

Strength studies run linear-elastic finite-element analysis on the selected solid and show displacement and stress fields. Review the part-local held end, loaded end and force direction, then enter the payload or force, material values and mesh settings. The before-and-after card is built from saved study records and reports maximum displacement, 95th-percentile stress and mesh convergence for each side. An unconverged result can be refined from its recorded inputs; editing the setup form does not change an earlier study, and outdated results need a new review. After acceptance, the card shows whether the latest build package came from the accepted revision, with the SHA-256 of its archive.

Manufacturing checks compare recognized features with editable FDM, milling or turning profiles. Mechanism studies use explicit connections and entered masses, with rectangular-envelope inertia and visible motion limits.

## Imports

Import STEP, STL, OBJ or GLB originals and confirm units and the selected body. Supported common-axis plates, cylinders, tubes, holes and counterbores can become editable after measured surface and volume comparisons. Unsupported freeform or mixed-axis features stay viewable and can still be analyzed, but not edited. Original files are kept, and a concurrent change to the import configuration requires another review before analysis.

## Agents and MCP

The design agent proposes measured changes; the engineering agent reads that revision and runs part checks. Both work inside a proposed version. External MCP credentials are limited to that version and are revoked on acceptance or rejection. Native browser tools are optional and need a browser exposing the experimental `document.modelContext` API.

## Product video export

Product video export creates a 20-second, 1080p, 30 fps MP4 from one frozen design revision. The preview and the export share the same frame-based camera, motion and exploded-view timeline. Install Chromium with `npx playwright install chromium` and provide FFmpeg on the server. Jobs support cancellation and authenticated downloads.

## Services and data

- OpenAI `gpt-6-astra` (default) or Anthropic `claude-opus-5-5` (explicit alternative, no automatic fallback): turns language and image input into typed proposals for review.
- Web Speech API and speech synthesis (in the browser): voice requests and spoken replies.
- CadQuery/Open Cascade: builds and checks exact CAD solids.
- Netgen and scikit-fem: part meshing and linear-elastic strength analysis.
- Rapier: rigid-body mechanism studies.
- React Three Fiber/Three.js: interactive viewport and motion preview.
- model-viewer and qrcode: the phone room view and the QR code that opens it.
- Yjs/Hocuspocus: collaborative annotations and presence.

Local data lives in `.data` and stays out of Git. Do not expose a local copy to the internet without deployment access controls and an operational review.

## Hosting

See [hosting configuration](docs/HOSTING.md) for persistent storage, listener settings and same-origin HTTPS collaboration. Public hosting and access controls are configured separately from a local copy.

## Third-party materials

See [third-party attribution](THIRD_PARTY.md) for libraries, CAD dependencies, fonts, hosted services and the versioned runtime inventory.
