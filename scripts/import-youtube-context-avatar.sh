#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
idle_source="${1:-${YOUTUBE_CONTEXT_AVATAR_IDLE_SOURCE:-/home/dennis/Downloads/AVA_schaut.mp4}}"
speaking_source="${2:-${YOUTUBE_CONTEXT_AVATAR_SPEAKING_SOURCE:-/home/dennis/Downloads/AVA_spricht.mp4}}"
chat_source="${3:-${YOUTUBE_CONTEXT_CHAT_MODERATOR_SOURCE:-/home/dennis/Downloads/mod2.mp4}}"
target_dir="$project_root/var/media/ai-host"

for source in "$idle_source" "$speaking_source" "$chat_source"; do
  if [[ ! -s "$source" ]]; then
    echo "AVA-Quelldatei fehlt oder ist leer: $source" >&2
    exit 1
  fi
done

mkdir -p "$target_dir"
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "FFmpeg wird für den transparenten Green-Screen-Import benötigt." >&2
  exit 1
fi

convert_avatar() {
  local source="$1"
  local target="$2"
  local temporary="${target}.tmp.webm"
  ffmpeg -hide_banner -loglevel error -y -i "$source" \
    -vf "crop=iw:ih-20:0:10,chromakey=0x32ad4c:0.10:0.04,despill=type=green:mix=0.35:expand=0.05,format=yuva420p" \
    -an -c:v libvpx-vp9 -deadline good -cpu-used 4 -crf 28 -b:v 0 "$temporary"
  install -m 0644 "$temporary" "$target"
  rm -f "$temporary"
}

convert_avatar "$idle_source" "$target_dir/youtube-context-idle.webm"
convert_avatar "$speaking_source" "$target_dir/youtube-context-speaking.webm"
convert_avatar "$chat_source" "$target_dir/youtube-context-chat-moderator.webm"

echo "YouTube-Einordnung-Avatar importiert:"
echo "  $target_dir/youtube-context-idle.webm"
echo "  $target_dir/youtube-context-speaking.webm"
echo "  $target_dir/youtube-context-chat-moderator.webm"
