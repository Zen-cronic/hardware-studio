#!/usr/bin/env bash
set -euo pipefail
umask 077
# Never create a database on the image's ephemeral filesystem.
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo 'Linux x64 required.' >&2; exit 1; }
[[ "${DATA_DIR:-}" == /var/data/hardware-studio ]] || { echo 'Unexpected data path.' >&2; exit 1; }
mountpoint -q /var/data || { echo 'Persistent disk is not mounted.' >&2; exit 1; }
[[ ! -L /var/data && ! -L "$DATA_DIR" ]] || { echo 'Data path cannot be a symlink.' >&2; exit 1; }
mkdir -p "$DATA_DIR"
# The mounted disk may initially be root-owned. Do not recursively rewrite saved data.
chown node:node "$DATA_DIR"
chmod 700 "$DATA_DIR"
exec gosu node node --import tsx /app/server/index.ts
