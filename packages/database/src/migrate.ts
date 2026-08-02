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
  '035_youtube_shorts_and_chat_reliability.sql',
  '036_youtube_shorts_channel_selection.sql',
  '037_live_event_run_cleanup.sql',
  '038_tiktok_shorts.sql',
  '039_tiktok_manual_handoff.sql',
  '040_shorts_premium_production.sql',
  '041_ava_live_style_and_inline.sql',
  '042_autonomous_studio_company.sql',
  '043_audience_council_and_chat_influence.sql',
  '044_youtube_context_interaction_banner.sql',
  '045_pocket_tts_audible_voice_recovery.sql',
  '046_youtube_context_layout_and_upload_date.sql',
  '047_youtube_context_text_style_recovery.sql',
  '048_shorts_minimum_production_interval.sql',
  '049_shorts_layout_editor.sql',
  '050_shorts_narration_length.sql',
  '051_youtube_video_editor.sql',
  '052_autonomous_council_workbench.sql',
  '053_video_editor_visual_tools.sql',
  '054_agent_orchestrator.sql',
  '055_video_editor_download_guard.sql',
  '056_agent_orchestrator_safety_guard.sql',
  '057_agent_memory_retrieval_version.sql',
  '058_broadcast_show_switch.sql',
  '059_autonomous_master_control.sql',
  '060_audience_greeting_service.sql',
  '061_ava_context_format_suite.sql',
  '062_manual_ai_takeover_formats.sql',
  '063_interactive_ava_mia_live_formats.sql',
  '064_dynamic_live_direction.sql',
  '065_format_specific_obs_overlays.sql',
  '066_broadcast_director_cues.sql',
  '067_advertising_management.sql',
  '068_timecode_schedule_management.sql',
  '069_in_overlay_ava_focus.sql',
  '070_broadcast_operations_workflow.sql',
  '071_ava_reaction_control.sql',
  '072_ai_roundtable_and_presenter_ensemble.sql',
  '073_continuous_editorial_desk.sql',
  '074_human_centered_ai_charter.sql',
  '075_audience_editorial_cases.sql',
  '076_ava_transcript_quips.sql',
  '077_ava_live_talk.sql',
  '078_advertising_materials.sql',
  '079_live_studio_program_source_integrity.sql',
  '080_advertising_campaign_operations.sql',
  '081_reaction_live_show.sql',
  '082_political_comedy_flagship.sql',
  '083_satire_channel_ensemble.sql',
  '084_overlay_slot_integrity.sql',
  '085_ai_roundtable_production.sql',
  '086_ai_roundtable_lively_direction.sql',
  '087_youtube_preproduced_moderation.sql',
  '088_ai_roundtable_content_mode.sql',
  '089_transcript_cue_playback_direction.sql',
  '090_broadcast_playlist_lifecycle.sql',
  '091_codex_youtube_show_packages.sql',
  '092_codex_autonomous_newsroom.sql',
  '093_dense_discussion_translation.sql',
  '094_strict_complete_video_playout.sql',
  '095_germany_patriotic_editorial_line.sql',
  '096_daily_current_news_only.sql',
  '097_autonomous_twitch_station.sql',
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
