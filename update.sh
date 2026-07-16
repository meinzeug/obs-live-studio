#!/usr/bin/env bash
set -euo pipefail
git pull --ff-only
npm install
npm run build
npm run db:migrate || true

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
