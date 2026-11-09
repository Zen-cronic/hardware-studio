#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]]
[[ -n "${GITHUB_ENV:-}" && -n "${GITHUB_PATH:-}" && -n "${RUNNER_TEMP:-}" ]]

# This is an ephemeral Actions runner. No credential or application data is copied.
check_disk() {
  local available
  available=$(df -PB1 "$RUNNER_TEMP" | awk 'NR==2 {print $4}')
  echo "Available runner disk bytes: $available"
  [[ "$available" =~ ^[0-9]+$ && "$available" -ge 5368709120 ]] || { echo 'At least5GiB free runner disk is required; no cleanup is performed.' >&2; exit 1; }
}
check_disk
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends build-essential git curl ca-certificates xz-utils ffmpeg libssl-dev zlib1g-dev libbz2-dev libreadline-dev libsqlite3-dev libffi-dev liblzma-dev libncursesw5-dev libgdbm-dev tk-dev uuid-dev libgl1 libegl1 libgomp1 pipx

export PYENV_ROOT="$HOME/.pyenv"
[[ ! -e "$PYENV_ROOT" ]] || { echo 'Refusing to overwrite an existing pyenv installation.' >&2; exit 1; }
fetch_pinned() {
  local repository="$1" destination="$2" revision="$3"
  git init -q "$destination"
  git -C "$destination" remote add origin "https://github.com/$repository.git"
  git -C "$destination" fetch -q --depth=1 origin "$revision"
  git -C "$destination" checkout -q --detach FETCH_HEAD
  [[ "$(git -C "$destination" rev-parse HEAD)" == "$revision" ]]
}
fetch_pinned pyenv/pyenv "$PYENV_ROOT" 3fb25668b463ad38ac2db6092dbf476ef744c0ca
fetch_pinned pyenv/pyenv-virtualenv "$PYENV_ROOT/plugins/pyenv-virtualenv" 7d821a62d6eeae21a451141c41898be1ed4ed147
export PATH="$PYENV_ROOT/bin:$PATH"
pyenv install 3.12.16
pyenv virtualenv 3.12.16 .victoria-hardware
export VIRTUAL_ENV="$PYENV_ROOT/versions/.victoria-hardware"
export PATH="$VIRTUAL_ENV/bin:$HOME/.local/bin:$PATH"
pipx install --python "$VIRTUAL_ENV/bin/python" poetry==2.5.1
export POETRY_VIRTUALENVS_CREATE=false
poetry install --no-interaction
npm ci
export PLAYWRIGHT_BROWSERS_PATH="$RUNNER_TEMP/hardware-studio-chromium"
npx --no-install playwright install --with-deps chromium

{
  echo "PYENV_ROOT=$PYENV_ROOT"
  echo "VIRTUAL_ENV=$VIRTUAL_ENV"
  echo "CAD_PYTHON=$VIRTUAL_ENV/bin/python"
  echo 'POETRY_VIRTUALENVS_CREATE=false'
  echo "PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH"
} >> "$GITHUB_ENV"
printf '%s\n' "$VIRTUAL_ENV/bin" "$HOME/.local/bin" "$PYENV_ROOT/bin" >> "$GITHUB_PATH"
python --version
node --version
poetry --version
dpkg-query -W ffmpeg libgl1 libegl1 libgomp1
df -h "$RUNNER_TEMP"
check_disk
