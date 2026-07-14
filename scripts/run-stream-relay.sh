#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
relay_dir="${MULTISTREAM_CONFIG_DIR:-$repo_dir/var/stream-relay}"

nginx_bin="${NGINX_EXECUTABLE:-$(command -v nginx || true)}"
stunnel_bin="${STUNNEL_EXECUTABLE:-$(command -v stunnel4 || command -v stunnel || true)}"

[[ -n "$nginx_bin" ]] || { echo "nginx wurde nicht gefunden" >&2; exit 1; }
[[ -n "$stunnel_bin" ]] || { echo "stunnel wurde nicht gefunden" >&2; exit 1; }
[[ -f "$relay_dir/nginx.conf" ]] || { echo "nginx.conf für den Stream-Relay fehlt" >&2; exit 1; }
[[ -f "$relay_dir/stunnel.conf" ]] || { echo "stunnel.conf für den Stream-Relay fehlt" >&2; exit 1; }

stunnel_pid=''
nginx_pid=''
cleanup() {
  trap - EXIT INT TERM
  [[ -z "$nginx_pid" ]] || kill "$nginx_pid" 2>/dev/null || true
  [[ -z "$stunnel_pid" ]] || kill "$stunnel_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

"$stunnel_bin" "$relay_dir/stunnel.conf" &
stunnel_pid=$!
"$nginx_bin" -p "$relay_dir/" -c "$relay_dir/nginx.conf" -g 'daemon off;' &
nginx_pid=$!

wait -n "$stunnel_pid" "$nginx_pid"
status=$?
cleanup
exit "$status"
