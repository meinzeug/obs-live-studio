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

if [[ "${POCKET_TTS_SKIP_VOICE_WARMUP:-0}" != "1" ]] && command -v curl >/dev/null 2>&1; then
  server_url="${POCKET_TTS_SERVER_URL:-http://127.0.0.1:8000}"
  voice_list="${POCKET_TTS_PRELOAD_VOICES:-anna vera jane alba juergen michael}"
  for _attempt in {1..20}; do
    if curl -fsS "$server_url/health" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  tmp_dir="$(mktemp -d)"
  for voice in $voice_list; do
    if curl -fsS -o "$tmp_dir/$voice.wav" \
      -F "text=Studio Stimme $voice ist bereit." \
      -F "voice_url=$voice" \
      "$server_url/tts" >/dev/null 2>&1; then
      echo "Pocket TTS Stimme vorgewärmt: $voice"
    else
      echo "Warnung: Pocket TTS Stimme konnte nicht vorgewärmt werden: $voice" >&2
    fi
  done
  rm -rf "$tmp_dir"
fi

echo "Pocket TTS ist installiert und als User-Dienst aktiviert."
