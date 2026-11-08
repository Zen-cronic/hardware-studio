# Linux release rehearsal

This is an unexecuted recipe for one **Ubuntu24.04 x86-64** persistent host. Local macOS checks do not establish Linux readiness. Provisioning, package installation and external execution are separate actions; this document does not authorize or perform them. Keep the rehearsal private, use disposable designs and no provider key.

## Runtime and layout

Use Node **24.22.1**, Python **3.12.16**, Poetry **2.5.1**, and the committed npm/Poetry lockfiles. These patch versions include the October security releases ([Node release](https://nodejs.org/en/blog/release/v24.22.1), [Python release](https://www.python.org/downloads/release/python-31216/)). Recheck advisories before a later public release; changing versions requires another native/runtime rehearsal. Existing local verification used Node24.20.0/Python3.12.14 and does not establish the newer combination.

Expected private paths on the Linux host:

| Purpose | Absolute path |
|---|---|
| Exact clean source checkout | `/srv/hardware-studio/current` |
| Verified official Node distribution | `/opt/node-v24.22.1-linux-x64` |
| pyenv installation, with pyenv-virtualenv | `/srv/hardware-studio/.pyenv` |
| Named Python environment | `/srv/hardware-studio/.pyenv/versions/.victoria-hardware` |
| Chromium cache | `/srv/hardware-studio/.cache/ms-playwright` |
| Disposable data volume | `/var/lib/hardware-studio-rehearsal` |
| Private configuration | `/etc/hardware-studio/rehearsal.env` |
| Private backup parent | `/var/backups/hardware-studio` |
| Private writable restore parent | `/var/lib/hardware-studio-restores` |

Use a dedicated non-root `hardware-studio` service account. Give it ownership of data/cache/backups and the restore parent and read access to its exact source/runtime. Configuration, snapshots and restored data contain editor capabilities; use directories0700 and files0600 and keep them off the public web root. No personal development database is seed data.

Before running any snapshot command, an administrator creates the parents; the dedicated account must not need write access to root-owned `/var/lib` itself:

```sh
sudo install -d -m 0700 -o hardware-studio -g hardware-studio /var/lib/hardware-studio-rehearsal /var/lib/hardware-studio-restores /var/backups/hardware-studio /srv/hardware-studio/.cache/ms-playwright
```

Run backup/restore as `hardware-studio`, never as root. The final restore directory is created by the tool inside the owned parent; do not pre-create that final directory.

The selected host must have build tools for Python/native Node modules, Python build libraries, `ffmpeg` with **libx264**, `ffprobe`, the locked Playwright Chromium browser and its Linux system dependencies. A concrete Ubuntu package starting point is:

```sh
sudo apt-get update
sudo apt-get install --no-install-recommends build-essential git curl ca-certificates xz-utils ffmpeg libssl-dev zlib1g-dev libbz2-dev libreadline-dev libsqlite3-dev libffi-dev liblzma-dev libncursesw5-dev libgdbm-dev tk-dev uuid-dev
```

Record the exact installed package versions and image identifier in the host receipt. The package list is a recipe, not a guarantee that this native stack works. Obtain Node from its official release and verify the archive against the official signed checksum list before extracting it to `/opt/node-v24.22.1-linux-x64`. Install pyenv/pyenv-virtualenv and Poetry through a reviewed, version-pinned bootstrap; do not pipe an unchecked installer to a shell. Ensure pyenv lists Python3.12.16 before continuing. This recipe assumes those bootstrap tools already exist; it does not silently download a different toolchain.

As the dedicated service account, after placing the approved clean source at `/srv/hardware-studio/current`:

```sh
cd /srv/hardware-studio/current
export PYENV_ROOT=/srv/hardware-studio/.pyenv
export PATH=/opt/node-v24.22.1-linux-x64/bin:/srv/hardware-studio/.pyenv/bin:$PATH
pyenv install -s 3.12.16
pyenv virtualenv 3.12.16 .victoria-hardware
export VIRTUAL_ENV=/srv/hardware-studio/.pyenv/versions/.victoria-hardware
export PATH=/srv/hardware-studio/.pyenv/versions/.victoria-hardware/bin:$PATH
poetry config virtualenvs.create false --local
poetry install --no-interaction
npm ci
export PLAYWRIGHT_BROWSERS_PATH=/srv/hardware-studio/.cache/ms-playwright
npx --no-install playwright install --with-deps chromium
npm run build
CAD_PYTHON=/srv/hardware-studio/.pyenv/versions/.victoria-hardware/bin/python node /srv/hardware-studio/current/scripts/runtime-preflight.mjs --require-linux
```

Create the named environment only once; on an existing host verify its Python version before reusing it. Do not replace it with a project `.venv` or use bare pip. `--with-deps` installs host packages and may need administrator approval. Browser setup follows [Playwright's documented installation](https://playwright.dev/docs/browsers#install-system-dependencies). The preflight makes no provider request, uses temporary data and removes its own temporary files.

The preflight checks Node/Python major versions, native SQLite with WAL, a valid exact CAD solid, separate Netgen/OCC import, numerical/Open3D imports, Rapier stepping, a Chromium WebGL pixel and one actual browser frame encoded with libx264 and inspected by ffprobe. It checks existing built assets/notices. It reports the actual OS/architecture, memory capacity and temporary-volume free space. `--require-linux` fails on macOS or a non-x86-64 machine. **It is not full workload, performance, security or deployment proof.** Native OCC libraries deliberately run in separate processes.

## Private runtime settings

`/srv/hardware-studio/current/deploy/rehearsal.env.example` is a key-free rehearsal template. Its AI allowance is0; it has bounded creation/worker admission and a5GiB free-disk floor. These are disposable rehearsal values, not a selected public usage/retention policy. A host-level volume quota, monitoring, public request policy and a separate provider allowance remain necessary before public exposure. Nothing automatically deletes old designs or files.

After review, copy the template to `/etc/hardware-studio/rehearsal.env`, secure its permissions and use `/srv/hardware-studio/current/deploy/hardware-studio-rehearsal.service` as the proposed unit. The service stays on loopback4174/4175. The template does not configure a public proxy, domain or certificate. Do not start the service until its account, file ownership, runtime and data directory exist. Follow the same-origin HTTP/WebSocket proxy requirements in `/srv/hardware-studio/current/docs/HOSTING.md` when the public host is approved.

## Quiesced private backup and restore

Use `/srv/hardware-studio/current/scripts/data-snapshot.py` only for **trusted local snapshots** after every app/worker using the source data has stopped. The explicit `--confirm-stopped` flag records the administrator's confirmation; it cannot establish that all processes have stopped. The tool rejects queued/running recorded jobs, holds a SQLite write transaction during collection and detects ordinary file/inventory changes. Those are secondary checks, **not an online filesystem snapshot protocol**. Stop the actual supervisor and verify that the entire service control group has exited before setting the flag.

The standard filename must be `/var/lib/hardware-studio-rehearsal/studio.sqlite`; custom `dbPath` locations are unsupported. The tool uses SQLite's backup API to include committed WAL data, writes a self-contained snapshot database, copies only the `builds`, `imports`, `engineering` and `clips` artifact trees, checks required ready downloads/import originals, and records byte lengths/SHA256. Private environment/configuration, source code and unrelated files are excluded. Descendant symlinks, external file references and unsafe paths fail. Source databases, unknown AI reservations, design windows and existing artifacts are never erased.

With a new snapshot path and every writer stopped:

```sh
sudo systemctl stop hardware-studio-rehearsal.service
sudo systemctl show hardware-studio-rehearsal.service -p ActiveState -p SubState -p MainPID -p ControlGroup
```

Then, as the dedicated `hardware-studio` account, with all service processes confirmed stopped:

```sh
cd /srv/hardware-studio/current
export VIRTUAL_ENV=/srv/hardware-studio/.pyenv/versions/.victoria-hardware
export PATH=/srv/hardware-studio/.pyenv/versions/.victoria-hardware/bin:$PATH
poetry run python /srv/hardware-studio/current/scripts/data-snapshot.py backup --source /var/lib/hardware-studio-rehearsal --destination /var/backups/hardware-studio/rehearsal-snapshot-001 --confirm-stopped
poetry run python /srv/hardware-studio/current/scripts/data-snapshot.py verify --source /var/backups/hardware-studio/rehearsal-snapshot-001
poetry run python /srv/hardware-studio/current/scripts/data-snapshot.py restore --source /var/backups/hardware-studio/rehearsal-snapshot-001 --destination /var/lib/hardware-studio-restores/rehearsal-001 --confirm-stopped
```

Backup and restore always require a **new nonexistent destination** whose parent already exists. They never overwrite an existing directory, even an empty one. On failure they remove only the new destination they themselves created. The restore verifies every copied byte, then relocates stored build-archive and imported-original pointers. It preserves original output bytes, design/history/proposed-version rows, annotations/sketches, capabilities, spending and creation counters. Historical worker input JSON is preserved for provenance; its old filesystem paths are not rewritten for manual replay. A manifest is an integrity receipt, not a cryptographic signature or proof of trusted origin. Store it securely with the private snapshot.

Verify the isolated restored app on different loopback ports and a key-free environment before changing a service's real data path. Compare the saved revision, notes and sketch, ready package and original-geometry downloads, study result, product clip, unknown charge reservations and unexpired creation window. Do not reset ledger/window rows to make the restored demo look fresh. Only after a reviewed restore should an administrator choose whether to update the service data path or resume the original service. If selecting the restored copy, an administrator must update **both** `DATA_DIR=/var/lib/hardware-studio-restores/rehearsal-001` in `/etc/hardware-studio/rehearsal.env` and `ReadWritePaths=/var/lib/hardware-studio-restores/rehearsal-001` in the installed unit `/etc/systemd/system/hardware-studio-rehearsal.service`, then reload systemd before starting that service. `ProtectSystem=strict` otherwise keeps the restored path read-only even when Unix ownership is correct. The repository template deliberately retains the original rehearsal path until that separate choice is made. Verify the restored directory remains owned by `hardware-studio` and0700; do not change ownership to root or widen permissions to bypass a failure.

## Evidence still needed on Linux and the selected host

Run the focused backup test against the locked source, then representative actual CAD, strength study, import reconstruction and browser product-film jobs with disposable data. Check cancellation/process exit, graceful and interrupted restart, persistent notes, two simultaneous browsers and restored output downloads. Record input/output hashes, actual elapsed time and peak process-tree memory/disk. The one-frame preflight does not replace those jobs.

After any production-only dependency install, rerun the preflight and real jobs: `tsx` and Playwright must remain present. Preserve the actual installed Python/native, Chromium and FFmpeg distribution notices and configuration; browser notices alone do not cover server binaries. The host's final HTTPS/WebSocket behavior, firewall, backup schedule, off-host storage, uptime and anonymously accessible demo are separate release evidence. No Linux execution, VM, public source change or deployment is claimed by this document.
