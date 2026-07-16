#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

mapfile -t database_parts < <(
  node --env-file=.env --input-type=module -e '
    const url = new URL(process.env.DATABASE_URL);
    for (const value of [url.hostname, url.port || "5432", url.username, url.password, url.pathname.slice(1)]) {
      console.log(decodeURIComponent(value));
    }
  '
)

db_host="${database_parts[0]:-}"
db_user="${database_parts[2]:-}"
db_password="${database_parts[3]:-}"
db_name="${database_parts[4]:-}"

if [[ "$db_host" != "localhost" && "$db_host" != "127.0.0.1" ]]; then
  echo "Externe PostgreSQL-Datenbank wird nicht automatisch provisioniert: $db_host"
  exit 0
fi
if [[ -z "$db_user" || -z "$db_password" || -z "$db_name" ]]; then
  echo "DATABASE_URL enthält keine vollständigen lokalen Zugangsdaten" >&2
  exit 1
fi

if node --env-file=.env --input-type=module - <<'NODE'
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query('select 1');
} catch {
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
NODE
then
  echo "PostgreSQL-Zugangsdaten sind bereits gültig: $db_name"
  exit 0
fi

sudo systemctl enable --now postgresql
sudo -u postgres psql --set=db_user="$db_user" --set=db_password="$db_password" --set=db_name="$db_name" <<'SQL'
select format('create role %I login password %L', :'db_user', :'db_password')
where not exists(select 1 from pg_roles where rolname=:'db_user') \gexec
select format('alter role %I with login password %L', :'db_user', :'db_password') \gexec
select format('create database %I owner %I', :'db_name', :'db_user')
where not exists(select 1 from pg_database where datname=:'db_name') \gexec
select format('alter database %I owner to %I', :'db_name', :'db_user') \gexec
SQL

echo "PostgreSQL bereit: $db_name"
