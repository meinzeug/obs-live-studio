#!/usr/bin/env bash
set -euo pipefail
if [[ -f /etc/os-release ]]; then . /etc/os-release; else echo "Kein /etc/os-release gefunden"; exit 1; fi
case "${ID:-}" in ubuntu|debian) ;; *) echo "Nur Debian/Ubuntu unterstützt"; exit 1;; esac
command -v node >/dev/null || { echo "Bitte Node.js 22 LTS installieren."; exit 1; }
command -v npm >/dev/null || { echo "npm fehlt"; exit 1; }
mkdir -p var/{media,tts,backups,logs}
if [[ ! -f .env ]]; then cp .env.example .env; node -e "const fs=require('fs'),c=require('crypto');let e=fs.readFileSync('.env','utf8');e=e.replace('SESSION_SECRET=','SESSION_SECRET='+c.randomBytes(32).toString('hex')).replace('ENCRYPTION_KEY=','ENCRYPTION_KEY='+c.randomBytes(32).toString('hex'));fs.writeFileSync('.env',e)"; fi
npm install
npm run build
command -v obs >/dev/null || echo "Hinweis: OBS Studio ist nicht installiert. Installiere es über die Paketquellen deiner Distribution."
command -v ffmpeg >/dev/null || echo "Hinweis: FFmpeg fehlt."
echo "Installation vorbereitet. Starte mit: npm run dev"
