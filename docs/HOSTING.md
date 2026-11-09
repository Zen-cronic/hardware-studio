# Hosting configuration

Run one persistent instance with Node 24, the documented Python environment and a persistent data directory. The process keeps SQLite, shared annotations and CAD build jobs; an ephemeral function is not a suitable runtime. This document prepares configuration; it does not provision a host or establish public readiness.

Build with `npm ci && npm run build`. After building, `npm ci --omit=dev` keeps the `tsx` runtime used by `npm start`. Native dependencies still need a supported platform and their install scripts. Set `CAD_PYTHON` to the installed Python interpreter and `DATA_DIR` to an absolute writable persistent directory. Keep the private environment outside the source and never put API keys in `VITE_` variables.

Defaults are API `127.0.0.1:4174` and annotations `127.0.0.1:4175`. `HOST`, `PORT`, `COLLAB_HOST` and `COLLAB_PORT` can change these explicitly. Ports must be from 1 to 65535 and must differ when using separate listeners. Use loopback when the proxy is on the same host; use the appropriate private interface when it is in a different container. Bind `0.0.0.0` only when the host's network policy is ready for it.

## Optional shared listener

Set `COLLAB_TRANSPORT=shared` to serve the API, room WebSockets and shared Notes/sketches through the API listener. `/api/rooms/…` and `/collab` both use `HOST` and `PORT`; no separate Notes listener starts. This is useful for a host that exposes one application port. The default `COLLAB_TRANSPORT=separate` retains ports 4174 and 4175. Unknown values fail before opening the database. `COLLAB_HOST` and `COLLAB_PORT` remain validated settings but do not bind a listener in shared mode.

For a local HTTP shared-listener build, set `VITE_COLLAB_PATH=/collab` at build time. HTTPS already uses `/collab`. A shared-listener host can forward every HTTP/WebSocket route to the one API port; do not retain an old `/collab` proxy pointing to an unused port 4175. This does not select a provider, enable TLS or establish production readiness.

Room messages retain their 64 KiB bound before parsing. Notes allows messages up to 1,000,000 bytes and persisted documents up to 2,000,000 bytes. Editor and viewer capabilities apply in both transport modes. The application owns termination signals; it closes raw collaboration sockets, waits for document loading and pending stores/unloads, and only then closes SQLite. This includes unauthenticated sockets and updates still within the Notes save debounce. Shutdown remains subject to the host's termination grace period; verify host restart and reconnection behavior separately.

## One HTTPS origin

For the default separate-listener mode, terminate TLS at the reverse proxy. Send ordinary HTTP and `/api/rooms/…` WebSocket upgrades to the API listener. Send `/collab` WebSocket upgrades to the annotation listener. Preserve the path and query string, upgrade headers, and long-lived socket connections. Do not log capability-bearing query strings or editor invitation fragments.

An HTTPS page automatically connects annotations to `wss://<page-origin>/collab`, including a nondefault HTTPS port. A local HTTP page retains the direct port 4175 default. To use an HTTP proxy or another same-origin path, set `VITE_COLLAB_PATH=/collab` before building; it is a build-time setting. External origins, queries, fragments and traversal are rejected. The development server also proxies `/collab` when that build-time setting is used.

Example Nginx location bodies, within an existing TLS server configuration. Upgrade forwarding follows the [official Nginx WebSocket documentation](https://nginx.org/en/docs/http/websocket.html):

```nginx
location /collab {
    proxy_pass http://127.0.0.1:4175;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    access_log off;
}
location /api/rooms/ {
    proxy_pass http://127.0.0.1:4174;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    access_log off;
}
location / {
    proxy_pass http://127.0.0.1:4174;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
}
```

Configure request limits and access controls at the deployment boundary before making the service public. The local application exposes design creation and capability-protected editing; provider spending and CAD work need an explicit public-access policy. A deployment must not silently make the private API budget available to unrestricted traffic.

## Persistent data and verification

Keep one replica while SQLite and the in-process build queue are authoritative. Back up SQLite consistently, including pending WAL state; do not copy only a live database file. Keep build packages with the database so existing download jobs remain valid. Do not ship development `.data` or editor invitations as seed data.

Before release verify health, a real two-browser note and sketch exchange through the public origin, edit conflict behavior, a revision-bound CAD download, restart persistence, and anonymous access to the intended public surfaces. A local proxy check does not establish public TLS, firewall, backup or uptime behavior. Select and approve the host and public-access policy before deployment.

Repeated authorized build requests for the same design revision share its queued or running job, including when the waiting queue is full. Different revisions remain separate; completed or failed jobs may be rebuilt. This reduces duplicate work but does not replace public request limits, storage controls or the single-instance requirement.

CAD timeouts and output limits wait for process exit before releasing queue capacity. On POSIX, cancellation signals the worker process group with SIGTERM, then SIGKILL after a one-second grace if needed, including descendants that outlive their immediate parent. Windows retains direct-child termination. Graceful shutdown waits for the active worker and records queued jobs as interrupted before closing SQLite. Abrupt host termination still relies on startup recovery.

## Engineering and video workers

Use the committed Python runtime dependencies for CAD, meshing and reconstruction; the expanded runtime inventory includes their installed notices. Review numerical worker memory, CPU and disk requirements on the actual host. They are bounded server processes, not edge/serverless functions.

The video queue needs the production Playwright package, a compatible installed Chromium (`npx playwright install chromium`) and an FFmpeg executable on PATH. Browser and FFmpeg binary notices must be included according to the concrete deployment artifacts. The renderer only loads the application's loopback render route and injects a frozen authenticated project; it does not navigate client-supplied URLs. Keep storage private and persistent, set resource/storage policy before public access, and do not expose capability tokens in logs.

## Shared worker and budget admission

CAD exports, component studies, imported-geometry work and product clips share one execution slot by default. `HEAVY_WORKER_CONCURRENCY` controls slots (1–16); `HEAVY_WORKER_QUEUE_LIMIT` bounds additional accepted jobs across all four queues (0–100, default 8). Existing queue limits and duplicate-job reuse still apply. A waiting job remains queued; cancellation/shutdown removes waiting work, and a running worker retains capacity until its process exits. The shared slot is acquired by actual numerical/render work, never by an agent waiting for its own study.

`MIN_FREE_DISK_BYTES` checks available space before admitting work/upload bytes and again before starting a worker. Local default 0 preserves existing behavior. A proposed public setting is 5368709120 (5 GiB). An unavailable/full storage check returns 503 without admitting a new job; a full shared queue returns 429. This threshold is not a hard per-job output quota or retention policy, and already-running work can consume more disk. Keep a host-level disk quota and monitoring appropriate to the approved public policy.

`AI_BUDGET_USD` and `AI_REQUEST_RESERVATION_USD` configure the existing transactional ledger. Absent settings preserve the local 50/1 USD defaults. A zero budget denies new provider reservations; reservation must be at least US$1 to retain the existing conservative per-call bound. Unknown-charge failures retain their originally recorded reservation, including after a configuration change. Configure a separate approved public allowance before exposure. These values do not establish a provider account-wide cap or per-client throttling.

`AI_PROVIDER_CONCURRENCY` limits active AI provider operations shared by direct design requests and agent roles (1–16, default 2). A full limit returns HTTP 429 with `AI_BUSY` immediately, before a provider call or spending reservation. Local measured proposals use no provider slot. Each slot remains occupied through response-body consumption, validation and accounting; budget refusal and every settled outcome release it. Direct-request disconnects, agent cancellation and the 60-second timeout abort the provider request. Shutdown stops admission and aborts provider work before waiting for agents, and keeps SQLite open until accounting finishes. Unknown charges retain their recorded reservation; restart starts with empty in-memory slots and preserves all budget rows, including interrupted reservations. This is a per-process limit, not a limit across replicas or provider accounts.

The worker guard does not add authentication, per-client/design request limits, byte quotas or automatic deletion. Those public-abuse and retention decisions remain release requirements. Test real Linux native imports, representative CAD/study/reconstruction/video jobs, cancellation, restart persistence and backup restoration on the chosen host before claiming deployment readiness.

## Durable design-creation admission

`MAX_SAVED_DESIGNS` caps the number of retained design rows. `DESIGN_CREATIONS_PER_WINDOW` caps successful new-design admissions globally for each fixed window; `DESIGN_CREATION_WINDOW_SECONDS` sets the duration (1–604800 seconds, default 3600). The two limits default to 0 (disabled) to preserve local behavior. Configure explicit values for the selected public-access policy before deployment. They are independent: either limit can be enabled alone.

The shared creation boundary covers new designs, copies, proposed versions and accepted imported reconstructions. Existing rows—including proposed versions—count toward capacity without a migration rewrite. Creation and its bounded singleton counter commit together in an immediate SQLite transaction. Failed insertions or rolled-back parent operations consume no admission. The counter survives process restarts and uses the same database across connections; do not delete or reset it to restart the server. A window starts at its first successful admission and keeps its recorded expiry when settings change. Backward clock changes do not reset it. No client identifier or request body is retained for this limiter.

At the creation-window limit, HTTP 429 includes `DESIGN_RATE_LIMIT`, a `Retry-After` header in seconds and `retryAfterSeconds` in the response body. Wait before retrying; retrying a rejected request does not consume capacity. At the retained-design limit, HTTP 503 reports `DESIGN_CAPACITY`. Existing designs, editing and downloads stay available even if the configured cap is below the current count. Increase the configured capacity after reviewing storage and restart the service to apply it. There is no automatic cleanup or deletion.

These are global count/admission limits, not per-client throttling, hard byte quotas, output reservations or retention rules. Existing design histories and completed packages, studies, imports and videos can continue growing. Keep the separate public request policy, worker/output quotas, filesystem monitoring, host-level limits and explicit backup/retention choices on the release checklist. Keep one application replica; durable creation transactions do not make the in-process work queues multi-instance safe.

## Rehearsal and data recovery

The private Linux runtime recipe, dependency preflight, rehearsal service template and quiesced backup/restore procedure are documented in `/srv/hardware-studio/current/docs/RELEASE-REHEARSAL.md`. The tooling verifies a local private snapshot and relocates runtime archive/import pointers without resetting designs, annotations, AI reservations or creation windows. Stop every app/worker first; its explicit stop confirmation is an operator prerequisite, not proof that processes are stopped. Local macOS verification does not establish Linux/native, public TLS/WebSocket or production restore readiness.

## Optional persistent-data startup guard

For a Linux deployment that requires a mounted data filesystem, the optional example at `/srv/hardware-studio/current/deploy/hardware-studio-volume-guard.service.example` runs `/srv/hardware-studio/current/scripts/data-volume-guard.mjs` before application startup. It does not alter the ordinary local startup or existing rehearsal unit. Do not install/enable it until the storage layout, service paths and resource floors are chosen and verified on the actual host.

Configure all six required values in the private `/etc/hardware-studio/mounted-data.env`: `DATA_DIR`, `DATA_MOUNT_PATH`, `DATA_MOUNT_SOURCE`, `DATA_MOUNT_ROOT`, `DATA_MOUNT_MIN_FREE_BYTES`, and `DATA_MOUNT_MIN_FREE_INODES`. Paths must be absolute canonical existing directories; symlink aliases are rejected. The mount path cannot be `/`. Source and root must match the decoded fields from the intended mount in `/proc/self/mountinfo`; bind mounts require their exact bind root. No provider, device name or resource floor is selected by this utility. Floors are explicit nonnegative integers; zero explicitly disables that pressure threshold, but unavailable inode reporting still refuses startup.

The example assumes `/var/lib/hardware-studio` as the intended mount. Adapt `RequiresMountsFor`, `ReadWritePaths`, configured mount/data paths and runtime paths together. `RequiresMountsFor` orders the mount; the pre-start guard additionally refuses a missing or mismatched mount rather than falling back to a root-filesystem directory. It refuses nested/stacked mounts affecting the data directory, read-only mounts, path escape, device mismatch and unavailable or insufficient free-byte/inode inspection. Existing data directories must be provisioned separately; the guard creates nothing, opens no database and never deletes data. Output contains only fixed status codes.

Fixture tests establish guard logic, not actual Linux boot/systemd behavior. Verify normal startup, missing mount refusal, wrong-device refusal, read-only/pressure refusal and service restart on the selected Linux host before release. This is a startup observation, not a mount lock, ongoing monitor or disk quota: later unmounts, concurrent remounts and already-running job growth need host controls. Keep the data mount stable during pre-start and application startup; preserve the existing graceful shutdown and backup procedure.
