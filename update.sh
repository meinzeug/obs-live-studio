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
npm run db:migrate

runtime_services=(
  obs-live-studio-api.service
  obs-live-studio-worker.service
  obs-live-studio-broadcast-runner.service
  obs-live-studio-overlay-renderer.service
  obs-live-studio-desktop-agent.service
  obs-live-studio-web.service
)

if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet obs-live-studio.target; then
  systemctl --user daemon-reload
  systemctl --user restart "${runtime_services[@]}"
  echo "OBS Live Studio wurde aktualisiert und alle Laufzeitdienste wurden neu gestartet."
else
  echo "OBS Live Studio wurde aktualisiert. Die Laufzeitdienste waren nicht aktiv und wurden nicht gestartet."
fi
