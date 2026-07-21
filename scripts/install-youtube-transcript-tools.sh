#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
venv_dir="$project_root/var/youtube-tools-venv"
pot_provider_dir="$project_root/var/bgutil-ytdlp-pot-provider"

python3 -m venv "$venv_dir"
"$venv_dir/bin/python" -m pip install --upgrade pip wheel
"$venv_dir/bin/python" -m pip install --upgrade 'yt-dlp[default]'
"$venv_dir/bin/python" -m pip install --upgrade 'bgutil-ytdlp-pot-provider==1.3.1'
"$venv_dir/bin/yt-dlp" --version
"$venv_dir/bin/python" -m pip show yt-dlp-ejs >/dev/null
node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ ! "$node_major" =~ ^[0-9]+$ ]] || (( node_major < 22 )); then
  echo "Node.js 22 oder neuer wird für die YouTube-EJS-Laufzeit benötigt." >&2
  exit 1
fi
if [[ ! -d "$pot_provider_dir/.git" ]]; then
  git clone --depth 1 --single-branch --branch 1.3.1 \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "$pot_provider_dir"
fi
npm --prefix "$pot_provider_dir/server" ci
"$pot_provider_dir/server/node_modules/.bin/tsc" -p "$pot_provider_dir/server/tsconfig.json"
test -f "$pot_provider_dir/server/build/generate_once.js"
echo "YouTube-Transkriptwerkzeuge bereit: yt-dlp + EJS + lokaler PO-Token-Provider + Node $(node --version)"
