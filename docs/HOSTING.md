# Hosting configuration

Run one persistent instance with Node 24, the documented Python environment and a persistent data directory. The process keeps SQLite, shared annotations and CAD build jobs; an ephemeral function is not a suitable runtime. This document prepares configuration; it does not provision a host or establish public readiness.

Build with `npm ci && npm run build`. After building, `npm ci --omit=dev` keeps the `tsx` runtime used by `npm start`. Native dependencies still need a supported platform and their install scripts. Set `CAD_PYTHON` to the installed Python interpreter and `DATA_DIR` to an absolute writable persistent directory. Keep the private environment outside the source and never put API keys in `VITE_` variables.

Defaults are API `127.0.0.1:4174` and annotations `127.0.0.1:4175`. `HOST`, `PORT`, `COLLAB_HOST` and `COLLAB_PORT` can change these explicitly. Ports must differ and be from 1 to 65535. Use loopback when the proxy is on the same host; use the appropriate private interface when it is in a different container. Bind `0.0.0.0` only when the host's network policy is ready for it.

## One HTTPS origin

Terminate TLS at the reverse proxy. Send ordinary HTTP and `/api/rooms/…` WebSocket upgrades to the API listener. Send `/collab` WebSocket upgrades to the annotation listener. Preserve the path and query string, upgrade headers, and long-lived socket connections. Do not log capability-bearing query strings or editor invitation fragments.

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

The worker guard does not add authentication, per-client/design request limits, durable storage quotas or automatic deletion. Those public-abuse and retention decisions remain release requirements. Test real Linux native imports, representative CAD/study/reconstruction/video jobs, cancellation, restart persistence and backup restoration on the chosen host before claiming deployment readiness.
