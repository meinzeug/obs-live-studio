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
  '015_live_regie_customization.sql',
  '016_live_reaction_mode.sql',
  '017_youtube_video_library.sql',
  '018_ai_tv_team.sql',
  '019_ai_host_chat_source_and_youtube_recovery.sql',
  '020_growth_engine.sql',
  '021_ai_staff_workbench.sql',
  '022_ai_host_video_avatar.sql',
  '023_ai_host_chat_identity.sql',
  '024_ai_host_voice_sync.sql',
  '025_source_and_visual_integrity.sql',
  '026_youtube_context_show.sql',
  '027_chat_moderator_agent.sql',
  '028_presenter_media_and_context_timing.sql',
  '029_youtube_transcript_timing.sql',
  '030_pocket_tts_voice_catalog.sql',
  '031_broadcast_formats.sql',
  '032_ai_presenter_live_preferences.sql',
  '033_openrouter_budget.sql',
  '034_proactive_chat_commentary.sql',
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
