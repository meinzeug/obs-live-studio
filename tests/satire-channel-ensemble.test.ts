import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ttsEnvironmentForAiPresenter } from '../apps/api/src/tts-generation.js';

describe('satire channel ensemble', () => {
  it('defines the global satire profile without weakening factual safeguards', async () => {
    const migration = await readFile('packages/database/src/083_satire_channel_ensemble.sql', 'utf8');
    expect(migration).toContain("'studio.editorial-profile'");
    expect(migration).toContain("'mode','satire'");
    expect(migration).toContain("'factBoundaryRequired',true");
    expect(migration).toContain("'satireDisclosureRequired',true");
    expect(migration).toContain("'sensitiveTopicsMode','factual-only'");
    expect(migration).toContain("'sameStandardForAllPoliticalActors',true");
    expect(migration).toContain("'privatePersonProtection',true");
  });

  it('ships AVA, MIA, Leon and Jonas as a serialized four-presenter roster', async () => {
    const migration = await readFile('packages/database/src/083_satire_channel_ensemble.sql', 'utf8');
    for (const id of ['moderator', 'chat-moderator', 'presenter-leon', 'presenter-jonas']) {
      expect(migration).toContain(`'${id}'`);
    }
    expect(migration).toContain("'singleSpeakerLock',true");
    expect(migration).toContain("'voiceQueue','serial'");
    expect(migration).toContain("'coHostIds',jsonb_build_array('presenter-leon','presenter-jonas')");
  });

  it('provides Jonas with production media and a voice distinct from all other hosts', async () => {
    await Promise.all([
      access('media/presenters/jonas/jonas-presenter.png'),
      access('media/presenters/jonas/jonas-idle.webm'),
      access('media/presenters/jonas/jonas-speaking.webm'),
    ]);
    const base = {
      TTS_ENGINE: 'pocket-tts',
      TTS_DEFAULT_VOICE: 'anna',
      POCKET_TTS_LANGUAGE: 'german_24l',
    };
    const voices = new Set([
      ttsEnvironmentForAiPresenter('moderator', base, 'anna').TTS_DEFAULT_VOICE,
      ttsEnvironmentForAiPresenter('chat-moderator', base, 'vera').TTS_DEFAULT_VOICE,
      ttsEnvironmentForAiPresenter('presenter-leon', base, 'alba').TTS_DEFAULT_VOICE,
      ttsEnvironmentForAiPresenter('presenter-jonas', base, 'juergen').TTS_DEFAULT_VOICE,
    ]);
    expect(voices).toEqual(new Set(['anna', 'vera', 'alba', 'juergen']));
  });

  it('propagates and renders a multi-presenter roster end to end', async () => {
    const [api, worker, database, team, provider] = await Promise.all([
      readFile('apps/api/src/index.ts', 'utf8'),
      readFile('apps/worker/src/autopilot.ts', 'utf8'),
      readFile('packages/database/src/ai-staff.ts', 'utf8'),
      readFile('apps/api/src/ai-tv-team.ts', 'utf8'),
      readFile('packages/ai-provider/src/index.ts', 'utf8'),
    ]);
    for (const source of [api, worker, database, team]) {
      expect(source).toContain('coHostIds');
      expect(source).toContain('hostRoster');
      expect(source).toContain('satireMode');
    }
    expect(api).toContain('contextCoHostForTurn');
    expect(api).toContain('SATIRE · FAKTENBASIS GEPRÜFT');
    expect(team).toContain('presenter-jonas');
    expect(provider).toContain('Dies ist ein klar gekennzeichneter Satire-Sender.');
  });
});
