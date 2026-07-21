#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_path="${1:-/home/dennis/Downloads/ZEITKANTE_intro_outro.mp4}"
target_dir="${project_root}/var/media/studio"
target_path="${target_dir}/zeitkante-intro-outro.mp4"

if [[ ! -f "${source_path}" ]]; then
  echo "Markenfilm nicht gefunden: ${source_path}" >&2
  exit 1
fi

if ! command -v ffprobe >/dev/null 2>&1; then
  echo "ffprobe wird zum Prüfen des Markenfilms benötigt." >&2
  exit 1
fi

duration="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${source_path}")"
if ! awk -v duration="${duration}" 'BEGIN { exit !(duration >= 1 && duration <= 120) }'; then
  echo "Der Markenfilm muss zwischen 1 und 120 Sekunden lang sein (ermittelt: ${duration}s)." >&2
  exit 1
fi

mkdir -p "${target_dir}"
install -m 0644 "${source_path}" "${target_path}"

echo "Markenfilm installiert: ${target_path} (${duration}s)"
