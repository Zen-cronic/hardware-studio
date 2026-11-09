#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]]
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
pyenv install 3.12.16
pyenv virtualenv 3.12.16 .victoria-hardware
pipx install --python "$VIRTUAL_ENV/bin/python" poetry==2.5.1
