#!/usr/bin/env bash
set -euo pipefail
git pull --ff-only
npm install
npm run build
npm run db:migrate || true
