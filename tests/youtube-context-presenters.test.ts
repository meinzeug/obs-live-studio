import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ttsEnvironmentForAiPresenter } from '../apps/api/src/tts-generation.js';

describe('YouTube context presenters', () => {
  it('gives the chat moderator a distinct official Pocket TTS voice', () => {
    const base = {
      TTS_ENGINE: 'pocket-tts',
      TTS_DEFAULT_VOICE: 'lola',
      POCKET_TTS_LANGUAGE: 'german_24l',
    };

    expect(ttsEnvironmentForAiPresenter('moderator', base).TTS_DEFAULT_VOICE).toBe('lola');
    expect(ttsEnvironmentForAiPresenter('chat-moderator', base).TTS_DEFAULT_VOICE).toBe('alba');
    expect(ttsEnvironmentForAiPresenter('chat-analyst', base).TTS_DEFAULT_VOICE).toBe('alba');
    expect(
      ttsEnvironmentForAiPresenter('chat-moderator', {
        ...base,
        AI_CHAT_MODERATOR_TTS_VOICE: 'anna',
      }).TTS_DEFAULT_VOICE,
    ).toBe('anna');
  });

  it('does not pass a Pocket catalogue voice to a deliberately selected Piper provider', () => {
    const piper = {
      TTS_ENGINE: 'piper',
      TTS_DEFAULT_VOICE: 'de_DE-dii-high',
      AI_CHAT_MODERATOR_TTS_VOICE: 'alba',
    };
    expect(ttsEnvironmentForAiPresenter('chat-moderator', piper).TTS_DEFAULT_VOICE).toBe('de_DE-dii-high');
    const thorsten = ttsEnvironmentForAiPresenter('chat-moderator', piper, 'de_DE-thorsten-high');
    expect(thorsten.TTS_DEFAULT_VOICE).toBe('de_DE-thorsten-high');
    expect(thorsten.PIPER_MODEL_PATH).toBe('./var/models/piper/de_DE-thorsten-high.onnx');
  });

  it('persists separate presenter voices and idle/speaking uploads for the settings UI', async () => {
    const [migration, routes, settingsUi] = await Promise.all([
      readFile('packages/database/src/028_presenter_media_and_context_timing.sql', 'utf8'),
      readFile('apps/api/src/ai-presenter-media.ts', 'utf8'),
      readFile('apps/web/src/components/AgentPresenterSettings.tsx', 'utf8'),
    ]);
    expect(migration).toContain('create table if not exists ai_presenter_profiles');
    expect(migration).toContain('create table if not exists ai_presenter_media');
    expect(routes).toContain("'/api/ai-presenters/:memberId/media/:state'");
    expect(routes).toContain("'libvpx-vp9'");
    expect(settingsUi).toContain('TTS-Stimme in allen Sendungen');
    expect(settingsUi).toContain('Greenscreen freistellen');
  });

  it('keeps AVA visible, shows mod2 only for chat turns and serializes on-air audio', async () => {
    const api = await readFile('apps/api/src/index.ts', 'utf8');
    expect(api).toContain('youtube-context-ava-video');
    expect(api).toContain('youtube-context-chat-video');
    expect(api).toContain('turn?.kind==="chat-response"');
    expect(api).toContain('activeHostAudio.pause()');
    expect(api).toContain('HOST_DUCK_LEAD_MS=550');
    expect(api).toContain('host.chatModerator?.videoUrl||host.moderator?.chatModeratorVideoUrl');
    expect(api).toContain('host?.chatModerator?.name||host?.moderator?.name||"MIA"');
    expect(api).toContain('host?.chatModerator?.jobTitle||"KI-Chatmoderatorin"');
  });

  it('models the chat presenter as a separate recoverable on-air agent', async () => {
    const [migration, runtime, database] = await Promise.all([
      readFile('packages/database/src/027_chat_moderator_agent.sql', 'utf8'),
      readFile('apps/api/src/ai-tv-team.ts', 'utf8'),
      readFile('packages/database/src/ai-staff.ts', 'utf8'),
    ]);
    expect(migration).toContain("'chat-moderator'");
    expect(migration).toContain("'Mia'");
    expect(runtime).toContain("getAiStaffMember('chat-moderator')");
    expect(runtime).toContain('nextAiStaffVoiceTurn(session.id)');
    expect(runtime).toContain('voiceQueueTail');
    expect(database).toContain('pg_advisory_xact_lock');
    expect(database).toContain("max(ends_at)+interval '700 milliseconds'");
  });
});
