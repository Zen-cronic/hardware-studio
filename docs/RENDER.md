# Render deployment preparation

This configuration is prepared, not deployed or capacity-certified. One paid Linux x64 Docker web service serves the app, room sockets and shared Notes on the same port. It uses the 1 CPU / 2 GB plan in Ohio and a 10 GB persistent disk. Automatic deploys and preview environments are off; keep Blueprint auto-sync off too. The intended cost is US$25/month compute plus US$2.50/month storage before taxes, bandwidth/build overages and external AI charges. Confirm the reviewed plan and credit eligibility before creating resources.

The source files on this machine are `/opt/hardware-studio/render.yaml`, `/opt/hardware-studio/deploy/render.Dockerfile`, `/opt/hardware-studio/deploy/render-python.sh` and `/opt/hardware-studio/deploy/render-start.sh`.

## Runtime and inputs

The image installs Node 24.22.1, named pyenv-virtualenv Python 3.12.16, Poetry 2.5.1, locked CAD/FEA/reconstruction packages, matching Playwright Chromium and FFmpeg. It builds the frontend before pruning npm development dependencies. The build context uses an allowlist; local environment files, saved designs, recordings and Git history are excluded. No secret build arguments are used. The base image tag and Debian packages are not digest-locked: record the built image digest and package versions during release verification.

The startup script refuses a missing `/var/data` mount or symlink data path, creates only `/var/data/hardware-studio`, sets its ownership, then replaces itself with the non-root Node process through gosu. This is a mount-presence check, not proof of provider durability or mount identity. All database/files must remain under that directory. Node directly receives shutdown signals. The app uses Render's PORT, and shared WebSockets use `/collab`; do not create a second service for Notes. Render handles TLS. No standalone Nginx configuration is required.

The Blueprint bootstraps with AI disabled (`AI_BUDGET_USD=0`). Both provider keys are deliberately omitted, so later syncs cannot overwrite Environment credentials. After secure credential configuration, explicitly select `AI_PROVIDER=openai` (GPT-6 Astra) or `AI_PROVIDER=anthropic` (Claude Opus 5.5) and set the approved remaining allowance. There is no automatic provider fallback. Never place keys in source, build arguments, URLs or logs. Keep the deployment ledger separate from local saved data. The cumulative allowance is shared between both providers on this service; separate local instances need their own partition of the approved total, not another full allowance.

The approved aggregate allowance is US$10, including the November 9 smoke tests. Their conservative accounting consumed $0.032085, leaving at most **$9.967915** for the fresh public ledger. The initial provider smoke used synthetic disposable designs and did not copy local saved data. Do not reset an existing ledger or overwrite its reservations to replenish the allowance. Read the service's accumulated total before changing the cap. A later Blueprint sync restores the safe zero budget, so re-enablement must preserve the remaining allowance.

Render rejects a custom shutdown delay on disk-backed services. This configuration uses the platform default grace period (currently 30 seconds). AI requests are aborted during preClose; native workers are cancelled and drained during close. The request timeout is not a promise that shutdown may wait 60 seconds. A platform kill can leave interrupted work and conservative AI reservations; these survive restart. Actual restart and interrupted-job behavior must be checked on the service.

Proposed public limits are one heavy job running, two waiting, one AI operation, 500 saved designs, 60 creations/hour globally, and a 5 GiB free-space admission floor. These are conservative reviewable settings, not a complete rate/byte quota or automatic retention policy. They preserve existing saved data and reject new work when the limit is reached. Confirm these limits and the AI allowance before publishing.

## Verification before public readiness

No Docker or Podman runtime was available on the preparation machine. Neither the image build nor 2 GB capacity is established. Existing macOS tests and the separate native Actions recipe cannot prove this image. From this Mac checkout, with access to an authorized disposable Linux x64 Docker engine, run:

```bash
docker build --platform linux/amd64 -f /opt/hardware-studio/deploy/render.Dockerfile -t hardware-studio:render-check /opt/hardware-studio
docker run --rm --platform linux/amd64 --memory=2g --memory-swap=2g --cpus=1 --entrypoint node hardware-studio:render-check /app/scripts/runtime-preflight.mjs --require-linux
docker run --rm --platform linux/amd64 --memory=2g --memory-swap=2g --cpus=1 -e OPENAI_API_KEY= -e AI_BUDGET_USD=0 --entrypoint node hardware-studio:render-check --import tsx /app/scripts/runtime-workloads.ts --require-linux
```

Those absolute source paths describe a Linux Docker engine controlled from this Mac; in GitHub Actions use the actual absolute checkout path supplied by the runner. A remote runner's filesystem does not contain the Mac source path. No Actions run is triggered by this document. The runtime workloads use disposable temporary data. Inspect exit/OOM status and peak cgroup memory as well as application output; sampled process RSS alone omits kernel/cache memory. Leave headroom below 2 GB. If it fails, measure the failure before selecting a larger plan.

Before treating the deployment as judge-ready, verify the complete arm edit → analysis → acceptance → export workflow, all six examples, real clip/reconstruction jobs, two-user room and Notes editing over public TLS, reconnect, cancellation, restart persistence and backup restoration on the chosen service. Verify absence of capability-bearing URLs in provider logs; platform request logs are independent of app logging. Keep explicit stop/backup procedures for SQLite rather than relying only on disk snapshots. Check actual browser/FFmpeg/native distribution notices. The health route checks availability and interpreter existence, not all these capabilities.

The source remains private until separately approved. A Git provider connection must grant Render access to this repository. Plan with create-new behavior, not adoption of an unrelated service; review the resulting resource list and cost before approval. Do not schedule automatic deletion at a presumed judging cutoff. Keep the submitted version available through evaluation/publication and review the organizer's requirements before shutdown.

References checked November 9, 2026: [Blueprint specification](https://render.com/docs/blueprint-spec), [Docker runtime](https://render.com/docs/docker), [persistent disks](https://render.com/docs/disks), [pricing](https://render.com/pricing).
