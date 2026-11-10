# Third-party materials

Hardware Studio uses the components below. Versioned details, upstream package sources and hashes of installed license/notice files are recorded in [the runtime inventory](docs/third-party-runtime.json). Inventory checked November 6, 2026 against `package-lock.json` and `poetry.lock`.

The inventory covers 202 installed production npm packages and 88 packages in the declared Python runtime dependency closures on the checked platform. It lists installed dependencies, including packages not necessarily imported on a particular route. Platform-specific optional packages and development tools are not fully covered. Lockfiles remain the source of dependency versions. This is an attribution inventory, not a conclusion that every distribution obligation has been satisfied.

## Application libraries

| Component | Purpose | Declared license |
|---|---|---|
| [React / React DOM](https://github.com/facebook/react) | Interface | MIT |
| [Three.js](https://github.com/mrdoob/three.js), [React Three Fiber](https://github.com/pmndrs/react-three-fiber), [Drei](https://github.com/pmndrs/drei) | Interactive 3D viewport and previews | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) | Interface icons | ISC |
| [Fastify](https://github.com/fastify/fastify), [static](https://github.com/fastify/fastify-static), [websocket](https://github.com/fastify/fastify-websocket) | API, static delivery and sockets | MIT |
| [Yjs](https://github.com/yjs/yjs), [Hocuspocus](https://github.com/ueberdosis/hocuspocus) | Shared annotations and presence | MIT |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | Persistent design and job storage | MIT; embedded SQLite has its own notices |
| [Zod](https://github.com/colinhacks/zod) | Structured input validation | MIT |
| [tsx](https://github.com/privatenumber/tsx) | TypeScript server execution | MIT |
| [dotenv](https://github.com/motdotla/dotenv) | Local environment configuration | BSD-2-Clause for the installed version |

Transitive dependencies, including WebGL helpers and collaboration transports, are listed individually in the JSON inventory. Package license declarations do not replace the notices of embedded or bundled components.

## CAD and numerical libraries

- [CadQuery](https://github.com/CadQuery/cadquery), version 2.6.1: Apache-2.0. Used for exact solid construction and export.
- [OCP](https://github.com/CadQuery/OCP), installed `cadquery-ocp` 7.8.1.1.post1: its wrapper LICENSE is Apache-2.0. This application makes use of facilities provided by **Open CASCADE Technology**. The underlying [OCCT 7.8.1 LGPL-2.1 text](https://github.com/Open-Cascade-SAS/OCCT/blob/V7_8_1/LICENSE_LGPL_21.txt) and [Open Cascade exception](https://github.com/Open-Cascade-SAS/OCCT/blob/V7_8_1/OCCT_LGPL_EXCEPTION.txt) are separate from the wrapper license.
- [CasADi](https://github.com/casadi/casadi), version 3.8.2: installed metadata states LGPLv3 or later; see its [license](https://github.com/casadi/casadi/blob/main/LICENSE.txt). Installed through CadQuery; its wheel contains additional solver and third-party notices. Their paths and hashes are retained in the inventory. Presence does not mean every bundled solver is used.
- [VTK](https://vtk.org), version 9.3.1: BSD license with additional bundled notices; [NumPy](https://github.com/numpy/numpy), version 2.5.4: installed license expression `BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0`.
- Other CAD/runtime dependencies, including ezdxf, nlopt, matplotlib and trame, are identified in the JSON inventory with exact versions and notice locations.

No third-party CAD binaries are committed to this source repository. Before distributing a bundled runtime, installer or container, review that concrete artifact's embedded libraries, notices, corresponding-source and relinking requirements. This inventory does not substitute for that review.

Additional engineering and rendering dependencies:

- [scikit-fem](https://github.com/kinnala/scikit-fem), 12.0.2: BSD-3-Clause, verified from the installed license. Linear elasticity assembly and solution.
- [Netgen](https://github.com/NGSolve/netgen), 6.2.2608: LGPL-2.1 package declaration. Its separately installed `netgen-occt` 7.8.1 contains the LGPL-2.1 text. Binary distribution requires reviewing the exact OCCT/Netgen artifacts and any applicable exceptions; a separate worker process does not remove their obligations.
- [Trimesh](https://github.com/mikedh/trimesh), [SciPy](https://github.com/scipy/scipy), and [Open3D](https://github.com/isl-org/Open3D): MIT, BSD-3-Clause and MIT respectively, with additional numerical/binary notices recorded in the inventory. Used for geometry inspection, feature fitting and verification.
- [Rapier](https://github.com/dimforge/rapier), `@dimforge/rapier3d-compat` 0.21.0: Apache-2.0. Explicit rigid-body joint studies run in an isolated server worker.
- [Playwright](https://github.com/microsoft/playwright), 1.64.1: Apache-2.0. Chromium is a separately installed browser with its own notices. [FFmpeg](https://ffmpeg.org/legal.html) is a system executable; its build configuration determines LGPL/GPL obligations and codec availability. Neither browser nor FFmpeg binaries are committed to this repository.

## Fonts and assets

- **Archivo**, variable weight and width: vendored WOFF2 from [Fontsource](https://fontsource.org/fonts/archivo) (`@fontsource-variable/archivo` 5.3.0), SIL Open Font License 1.1. [Retained notice](public/fonts/licenses/archivo-OFL.txt).
- **Decorative part images** in `public/decor/` (propeller, gear, bolt, motor, bearing, spring, nut and washer, standoff) were generated for this project with an image model and cut out locally. They show generic parts with no brands or text.
- **Source Sans 3**, regular 400 and semibold 600: installed through [Fontsource](https://fontsource.org/fonts/source-sans-3), SIL Open Font License 1.1. The installed package's notice is included in the browser distribution.
- **IBM Plex Mono**, regular 400: installed through [Fontsource](https://fontsource.org/fonts/ibm-plex-mono), SIL Open Font License 1.1. The installed package's notice is included in the browser distribution. Barlow remains installed and inventoried but is not imported by the current interface.

The six example assemblies and generic primitive designs are generated by the application code. Bought-part shapes are simplified dimensional envelopes; supplier names and links identify candidate components, not endorsements. No supplier CAD meshes, purchased textures, Meshy meshes or Skybox panoramas are bundled in the current application. User uploads and user-created designs have their own provenance and are not covered by this inventory.

## External services and models

An optional hosted language model generates structured language/image proposals. One provider is selected explicitly per process with no automatic fallback: the OpenAI API with `gpt-6-astra` (default; see the [OpenAI Services Agreement](https://openai.com/policies/services-agreement/) and [Service Terms](https://openai.com/policies/service-terms/)) or the Anthropic API with `claude-opus-5-5` (see [Anthropic's Commercial Terms](https://www.anthropic.com/legal/commercial-terms)). Configuration details are in [docs/AI-PROVIDERS.md](docs/AI-PROVIDERS.md). These are hosted services, not redistributed models or weights packages. Application code validates proposals before accepting changes. No training dataset or model weights are bundled.

Voice input uses the browser's SpeechRecognition implementation when available; its processing and service terms depend on the browser. Video reference input samples a frame rather than claiming native video understanding. Meshy and Skybox integrations are not included in this release.

## Refreshing the inventory

Use the project's Python environment with dependencies installed. Point `--npm-root` at an installation made from the same lockfile with `npm ci --omit=dev`, or use the default current directory (packages marked development-only are excluded):

```sh
poetry run python scripts/third_party_inventory.py --npm-root .
```

The script reads installed metadata and notices, checks package versions against both lockfiles and writes `docs/third-party-runtime.json`. It makes no network calls or installations. Review changes, especially new license terms and dependencies with missing notices. Preserve applicable license texts in distributed browser assets and other release artifacts; this source-level index alone does not package those notices.

## Browser distribution notices

`npm run build` emits `dist/THIRD_PARTY_NOTICES.txt` and `dist/third-party-browser.json` from the bundled JavaScript module graph, imported CSS packages and vendored fonts. The HTML links to the notice text. Package license files and source-level block notices are copied into the text; the manifest records their hashes. Packages whose published archives omit their notice use only version-pinned, hash-checked upstream release notices listed in `scripts/browser-notice-overrides.json`. Missing notices, changed fallback bytes or mismatched installed versions fail the build. Server/CAD binary distribution remains a separate review.
