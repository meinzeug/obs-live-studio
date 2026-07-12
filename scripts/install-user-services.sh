#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

mkdir -p "$unit_dir"
for source_unit in "$repo_dir"/deploy/systemd/obs-live-studio*.service; do
  unit_name="$(basename "$source_unit")"
  sed "s|%h/obs-live-studio|$repo_dir|g" "$source_unit" >"$unit_dir/$unit_name"
  chmod 0644 "$unit_dir/$unit_name"
done
install -m 0644 "$repo_dir/deploy/systemd/obs-live-studio.target" "$unit_dir"/
systemctl --user daemon-reload
systemctl --user enable obs-live-studio.target

echo "User-Dienste installiert für $repo_dir"
