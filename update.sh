#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_dir"

if [[ "${OBS_LIVE_STUDIO_UPDATE_REEXEC:-0}" != "1" ]]; then
  git pull --ff-only
  OBS_LIVE_STUDIO_UPDATE_REEXEC=1 exec "$repo_dir/update.sh" "$@"
fi
unset OBS_LIVE_STUDIO_UPDATE_REEXEC

npm ci --no-audit --no-fund
npm run build
scripts/provision-postgres.sh
npm run studio:backup
node scripts/configure-env.mjs
if node --env-file=.env -e "process.exit(String(process.env.TTS_ENGINE || 'piper').toLowerCase() === 'piper' ? 0 : 1)"; then
  npm run studio:tts:install
fi
npm run studio:tts:status -- --json
npm run db:migrate

systemd_user_available=false
if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  scripts/install-user-services.sh
  systemd_user_available=true
fi

runtime_services=(
  obs-live-studio-api.service
  obs-live-studio-desktop-agent.service
  obs-live-studio-worker.service
  obs-live-studio-overlay-renderer.service
  obs-live-studio-web.service
  obs-live-studio-broadcast-runner.service
)

if [[ "$systemd_user_available" == true ]] && systemctl --user is-active --quiet obs-live-studio.target; then
  failed_services=()
  for service in "${runtime_services[@]}"; do
    if ! systemctl --user restart "$service"; then
      failed_services+=("$service")
    fi
  done
  if (( ${#failed_services[@]} > 0 )); then
    echo "OBS Live Studio wurde aktualisiert, aber folgende Dienste konnten nicht gestartet werden:" >&2
    printf '  - %s\n' "${failed_services[@]}" >&2
    for service in "${failed_services[@]}"; do
      systemctl --user --no-pager --full status "$service" >&2 || true
    done
    exit 1
  fi
  echo "OBS Live Studio wurde aktualisiert und alle Laufzeitdienste wurden neu gestartet."
elif [[ "$systemd_user_available" == true ]]; then
  echo "OBS Live Studio wurde aktualisiert. Die Laufzeitdienste waren nicht aktiv und wurden nicht gestartet."
else
  echo "OBS Live Studio wurde aktualisiert. Benutzer-systemd ist nicht verfügbar; Laufzeitdienste wurden nicht verwaltet."
fi
