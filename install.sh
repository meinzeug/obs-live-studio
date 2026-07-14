#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_dir"

if [[ ! -f /etc/os-release ]]; then
  echo "Kein /etc/os-release gefunden" >&2
  exit 1
fi
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *)
    echo "Nur Debian und Ubuntu werden unterstützt" >&2
    exit 1
    ;;
esac

command -v node >/dev/null || { echo "Node.js 22 LTS fehlt" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm fehlt" >&2; exit 1; }
node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
if (( node_major < 22 )); then
  echo "Node.js 22 oder neuer ist erforderlich" >&2
  exit 1
fi

sudo -v
sudo apt-get update
sudo apt-get install -y ca-certificates curl ffmpeg espeak-ng postgresql software-properties-common xz-utils
if [[ "$ID" == "ubuntu" ]]; then
  sudo add-apt-repository -y ppa:obsproject/obs-studio
  sudo apt-get update
fi
sudo apt-get install -y obs-studio

mkdir -p var/{media,tts,backups,logs}
node scripts/configure-env.mjs
npm install
npm run build
npm run obs:install-multi-rtmp
scripts/provision-postgres.sh
npm run db:migrate
npm run db:seed
npm run studio:sources
npm run obs:configure
scripts/install-user-services.sh
sudo loginctl enable-linger "$USER"
systemctl --user start obs-live-studio.target
npm run studio:bootstrap

echo "ArgumentationsKette Studio läuft auf http://127.0.0.1:12001/"
echo "Lokale Admin-Zugangsdaten: $repo_dir/var/admin-credentials.json"
