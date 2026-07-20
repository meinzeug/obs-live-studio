import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, pool } from './index.js';
const here = dirname(fileURLToPath(import.meta.url));
const migrationFiles = [
  'schema.sql',
  '002_article_broadcast.sql',
  '003_auth_sessions.sql',
  '004_overlay_media_admin.sql',
  '005_live_control_center.sql',
  '006_broadcast_start_safety.sql',
  '007_user_scoped_broadcast_start.sql',
  '008_operational_notifications.sql',
  '009_source_health.sql',
  '010_source_url_state.sql',
  '011_live_event_dedupe.sql',
  '012_article_visual_media.sql',
  '013_live_studio.sql',
  '014_live_regie.sql',
];
async function readFirst(name: string) {
  const candidates = [
    resolve(process.cwd(), `packages/database/src/${name}`),
    resolve(here, '../src', name),
    resolve(here, name),
  ];
  for (const file of candidates) {
    try {
      return await readFile(file, 'utf8');
    } catch {}
  }
  throw new Error(`${name} nicht gefunden: ${candidates.join(', ')}`);
}
export async function runMigrations() {
  for (const name of migrationFiles) await query(await readFirst(name));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await runMigrations();
    console.log('Migrationen ausgeführt');
  } finally {
    await pool.end();
  }
}
