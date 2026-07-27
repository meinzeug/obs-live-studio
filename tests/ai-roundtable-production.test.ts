import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), 'utf8');
}

describe('KI Studio Runde production routing', () => {
  it('marks existing and future roundtable items for the dedicated production scene', async () => {
    const [migration, database, runner] = await Promise.all([
      source('packages/database/src/085_ai_roundtable_production.sql'),
      source('packages/database/src/index.ts'),
      source('packages/broadcast-engine/src/index.ts'),
    ]);
    expect(migration).toContain("'aiRoundtable',true");
    expect(migration).toContain("'contextLayoutVariant','ai-roundtable'");
    expect(database).toContain("input.formatSystemKey?.startsWith('ai-roundtable-')");
    expect(runner).toContain('playAiRoundtableContribution');
    expect(runner).toContain('configureAiRoundtableBroadcastItem');
  });

  it('keeps all six presenters visible without blocking the video during AI preparation', async () => {
    const [migration, overlay, runner] = await Promise.all([
      source('packages/database/src/085_ai_roundtable_production.sql'),
      source('apps/api/src/ai-roundtable.ts'),
      source('packages/broadcast-engine/src/index.ts'),
    ]);
    for (const id of [
      'moderator',
      'chat-moderator',
      'presenter-lea',
      'presenter-leon',
      'presenter-jonas',
      'presenter-karim',
    ])
      expect(migration).toContain(`'${id}'`);
    expect(overlay).toContain('grid-template-columns:repeat(2,1fr)');
    expect(overlay).toContain('grid-template-rows:repeat(3,1fr)');
    expect(overlay).toContain('LIVE-VORSTELLUNGSRUNDE');
    expect(overlay).toContain('box.classList.toggle("active",Boolean(turn))');
    expect(overlay).not.toContain('Die Runde wird vorbereitet');
    expect(overlay).not.toContain('Gleich beginnt die nächste Wortmeldung');
    expect(runner).not.toContain('setYoutubeContextPlaybackPaused(item.id, true)');
    expect(runner).toContain('return Boolean(control?.paused)');
  });

  it('continues with local editorial text and visible incident reporting when AI or TTS fails', async () => {
    const api = await source('apps/api/src/ai-roundtable.ts');
    expect(api).toContain("fallbackMode: z.literal('local-editorial')");
    expect(api).toContain('lokaler Redaktionsregie weiter');
    expect(api).toContain("'ai-roundtable:model-fallback'");
    expect(api).toContain("'ai-roundtable:tts-fallback'");
    expect(api).toContain("tier: 'free' | 'paid' | 'local'");
    expect(api).toContain("withDeadline(");
    expect(api).toContain("'Die KI-Redaktion'");
    expect(api).toContain("'Die Sprachsynthese'");
    expect(api).toContain("'roundtable-session-ended'");
    expect(api).toContain("reason: 'program-changed'");
    expect(api).toContain('Sprich konsequent in der Ich-Form');
    expect(api).toContain('isUsableSpokenCopy');
    expect(api).not.toContain('knüpft an ${previous.display_name');
  });

  it('adds source-bound banter while protecting sensitive topics and ducks OBS video audio', async () => {
    const [api, routes, migration, web] = await Promise.all([
      source('apps/api/src/ai-roundtable.ts'),
      source('apps/api/src/index.ts'),
      source('packages/database/src/086_ai_roundtable_lively_direction.sql'),
      source('apps/web/src/components/AiRoundtablePanel.tsx'),
    ]);
    expect(api).toContain('humorIsSensitive');
    expect(api).toContain('Dramaturgische Aufgabe dieser Wortmeldung');
    expect(api).toContain('darf genau eine kurze');
    expect(api).toContain('duckYoutubeAudio');
    expect(api).toContain('youtubeDuckVolume');
    expect(routes).toContain('roundtableTurnAuthorized');
    expect(routes).toContain('input.volume ?? aiAudioDuckVolume');
    expect(routes).toContain('setYoutubeContextPlaybackPaused(input.itemId, true, null)');
    expect(routes).toContain('pausedVideo = true');
    expect(routes).toContain('setYoutubeContextPlaybackPaused(roundtableTurnInfo.active_item_id, keepVideoPaused)');
    expect(routes).toContain('recoverAiAudioDuckingAfterStartup');
    expect(routes).toContain('session.broadcast_item_id=$1');
    expect(routes).toContain('setYoutubeContextPlaybackPaused(playback.itemId, false)');
    expect(migration).toContain("'humorLevel','lively'");
    expect(migration).toContain("'youtubeDuckVolume',0.22");
    expect(web).toContain('Humor und Schlagabtausch');
    expect(web).toContain('Video automatisch leiser regeln');
  });

  it('plays the time-coded local manuscript at the real YouTube player position', async () => {
    const [runtime, runner, database, migration] = await Promise.all([
      source('apps/api/src/ai-roundtable.ts'),
      source('packages/broadcast-engine/src/index.ts'),
      source('packages/database/src/youtube-preproduction.ts'),
      source('packages/database/src/087_youtube_preproduced_moderation.sql'),
    ]);
    expect(runtime).toContain('claimYoutubePreproducedCue');
    expect(runtime).toContain('media_position_ms');
    expect(runtime).toContain('vorproduzierte-transkript-regie');
    expect(runtime).toContain('setYoutubeContextPlaybackPaused');
    expect(runtime).toContain('preproducedCueId');
    expect(runtime).toContain('nextRoundtableAudienceQuestion');
    expect(runtime).toContain('Was sagt der Chat dazu?');
    expect(runtime).toContain('async function finishTurn()');
    expect(runtime).toContain('video.pause()');
    expect(runner).toContain('youtubeLibraryId: youtube.libraryId');
    expect(runner).toContain('runKey: runId');
    expect(database).toContain('youtube_preproduced_cue_runs');
    expect(migration).toContain('youtube_preproduced_cues');
  });

  it('keeps direct moderator replies in one transcript-bound pause group', async () => {
    const [database, migration, routes] = await Promise.all([
      source('packages/database/src/youtube-preproduction.ts'),
      source('packages/database/src/089_transcript_cue_playback_direction.sql'),
      source('apps/api/src/index.ts'),
    ]);
    expect(database).toContain('hasPendingYoutubePreproducedCueInGroup');
    expect(database).toContain('cue.at_ms<$5');
    expect(migration).toContain('preproduced_cue_id');
    expect(migration).toContain('audience_message_id');
    expect(routes).toContain('completeAiRoundtableTurnPlayback');
    expect(routes).toContain('hasPendingYoutubePreproducedCueInGroup');
  });
});
