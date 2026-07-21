#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
venv_dir="${POCKET_TTS_VENV_DIR:-$repo_dir/var/pocket-tts-venv}"
python_bin="$venv_dir/bin/python"
torch_index_url="${POCKET_TTS_TORCH_INDEX_URL:-https://download.pytorch.org/whl/cpu}"

mkdir -p "$repo_dir/var/pocket-tts" "$repo_dir/var/tts"

if [[ ! -x "$python_bin" ]]; then
  python3 -m venv "$venv_dir"
fi

"$python_bin" -m pip install --disable-pip-version-check --no-input -U pip wheel
"$python_bin" -m pip install --disable-pip-version-check --no-input --index-url "$torch_index_url" "torch>=2.5.0"
"$python_bin" -m pip install --disable-pip-version-check --no-input --upgrade-strategy only-if-needed "pocket-tts>=2.1.0,<3"

bash "$repo_dir/scripts/install-user-services.sh"
systemctl --user enable --now obs-live-studio-pocket-tts.service

echo "Pocket TTS ist installiert und als User-Dienst aktiviert."
