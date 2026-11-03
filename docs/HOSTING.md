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
