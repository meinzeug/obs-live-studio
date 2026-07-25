import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { YOUTUBE_CONTEXT_FORMAT_TARGETS } from '@ans/obs-controller';
import { ttsEnvironmentForAiPresenter } from '../apps/api/src/tts-generation.js';

describe('Politik im Schleudergang', () => {
  it('ships exactly one production-ready political comedy format with a safe transcript contract', async () => {
    const migration = await readFile('packages/database/src/082_political_comedy_flagship.sql', 'utf8');
    expect(migration).toContain("'Politik im Schleudergang'");
    expect(migration).toContain("'political-comedy-ava-leon'");
    expect(migration).toContain("'youtubeContextLayoutVariant','politik-comedy'");
    expect(migration).toContain("'transcriptGrounded',true");
    expect(migration).toContain("'factCheckRequired',true");
    expect(migration).toContain("'noFabricatedQuotes',true");
    expect(migration).toContain("'sameStandardForAllPoliticalActors',true");
    expect(migration).toContain("'noProtectedClassTargets',true");
    expect(migration).toContain("'sensitiveTopicComedy',false");
    expect(migration).toContain("'singleSpeakerLock',true");
    expect(migration).toContain("'voiceQueue','serial'");
    expect(migration).toContain("'startTime','19:00'");
    expect(migration.match(/'political-comedy-ava-leon'/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('has an isolated OBS scene and browser input', () => {
    expect(YOUTUBE_CONTEXT_FORMAT_TARGETS['politik-comedy']).toEqual({
      sceneName: '22_POLITIK_SCHLEUDERGANG',
      inputName: 'ANS_POLITIK_SCHLEUDERGANG_OVERLAY',
      template: 'youtube-context-politik-comedy',
    });
  });

  it('renders AVA, MIA, Leon and Jonas as distinct presenters with synchronized audio', async () => {
    const api = await readFile('apps/api/src/index.ts', 'utf8');
    const team = await readFile('apps/api/src/ai-tv-team.ts', 'utf8');
    expect(api).toContain('youtube-context-cohost-video');
    expect(api).toContain('SATIRE · AVA SPRICHT');
    expect(api).toContain('SATIRE · "+speakerName.toUpperCase()+" SPRICHT');
    expect(api).toContain('contextCoHostForTurn(turn,displayHost)');
    expect(api).toContain('displayHost?.coHosts');
    expect(api).toContain('preloadHostVideo(layer,speakingUrl,turn,host)');
    expect(api).toContain('contextCoHostVideo(layer)');
    expect(api).toContain('activeHostAudio.pause()');
    expect(team).toContain('fallbackItem = itemId && !session ? await youtubeItemForAiHost(itemId)');
    expect(team).toContain('recordValue(fallbackItem?.format_regie)');
  });

  it('ships transparent Leon and Jonas media with distinct male Pocket TTS voices', async () => {
    await Promise.all([
      access('media/presenters/leon/leon-presenter.png'),
      access('media/presenters/leon/leon-idle.webm'),
      access('media/presenters/leon/leon-speaking.webm'),
      access('media/presenters/jonas/jonas-presenter.png'),
      access('media/presenters/jonas/jonas-idle.webm'),
      access('media/presenters/jonas/jonas-speaking.webm'),
    ]);
    const environment = ttsEnvironmentForAiPresenter(
      'presenter-leon',
      {
        TTS_ENGINE: 'pocket-tts',
        TTS_DEFAULT_VOICE: 'anna',
        POCKET_TTS_LANGUAGE: 'german_24l',
      },
      'alba',
    );
    expect(environment.TTS_DEFAULT_VOICE).toBe('alba');
    expect(
      ttsEnvironmentForAiPresenter(
        'presenter-jonas',
        {
          TTS_ENGINE: 'pocket-tts',
          TTS_DEFAULT_VOICE: 'anna',
          POCKET_TTS_LANGUAGE: 'german_24l',
        },
        'juergen',
      ).TTS_DEFAULT_VOICE,
    ).toBe('juergen');
  });

  it('propagates the selected format through manual planning and the autopilot', async () => {
    const [api, worker, database] = await Promise.all([
      readFile('apps/api/src/index.ts', 'utf8'),
      readFile('apps/worker/src/autopilot.ts', 'utf8'),
      readFile('packages/database/src/ai-staff.ts', 'utf8'),
    ]);
    for (const source of [api, worker, database]) {
      expect(source).toContain('coHostRole');
      expect(source).toContain('comedyMode');
      expect(source).toContain('coHostId');
      expect(source).toContain('editorialSafety');
    }
    expect(api).toContain('formatSystemKey: placement.format?.system_key ?? null');
    expect(worker).toContain('contextRuntime?.comedyMode === true');
  });
});
