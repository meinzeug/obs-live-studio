#!/usr/bin/env bash
set -euo pipefail
source .env 2>/dev/null || true
DIR=${BACKUP_DIRECTORY:-./var/backups}; mkdir -p "$DIR"; TS=$(date -u +%Y%m%dT%H%M%SZ)
tar --exclude=node_modules --exclude=.git -czf "$DIR/app-$TS.tar.gz" .
if command -v pg_dump >/dev/null && [[ -n "${DATABASE_URL:-}" ]]; then pg_dump "$DATABASE_URL" | gzip > "$DIR/db-$TS.sql.gz"; fi
echo "$DIR"
