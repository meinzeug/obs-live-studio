import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Shared Shorts premium production', () => {
  it('stores only non-secret premium settings and platform schedules in PostgreSQL', async () => {
    const migration = await readFile('packages/database/src/040_shorts_premium_production.sql', 'utf8');
    expect(migration).toContain('create table if not exists shorts_premium_settings');
    expect(migration).toContain("elevenlabs_model_id text not null default 'eleven_multilingual_v2'");
    expect(migration).toContain("paid_llm_model_strategy text not null default 'automatic'");
    expect(migration).toContain('paid_llm_max_request_usd');
    expect(migration).toContain('premium_planned_at timestamptz');
    expect(migration).toContain('planned_publish_at timestamptz');
    expect(migration).not.toContain('ELEVENLABS_API_KEY');
  });

  it('shares ElevenLabs, paid planning and a local fallback across both renderers', async () => {
    const [shared, youtube, youtubeDatabase, tiktok] = await Promise.all([
      readFile('apps/worker/src/shorts-premium.ts', 'utf8'),
      readFile('apps/worker/src/youtube-shorts.ts', 'utf8'),
      readFile('packages/database/src/youtube-shorts.ts', 'utf8'),
      readFile('apps/worker/src/tiktok-shorts.ts', 'utf8'),
    ]);
    expect(shared).toContain('preparePremiumShortEditorial');
    expect(shared).toContain('synthesizeElevenLabs');
    expect(shared).toContain('local_tts_fallback');
    expect(shared).toContain("dedupeKey: 'shorts-premium:elevenlabs'");
    expect(youtube).toContain('ensurePremiumShortEditorial');
    expect(youtubeDatabase).toContain('job.planned_publish_at');
    expect(youtubeDatabase).toContain('youtube-shorts-upload-daily');
    expect(tiktok).toContain('generatePremiumShortSpeech');
  });

  it('offers the same secret-safe connection, voice test and SOTA budget UI on both creator pages', async () => {
    const [component, youtube, tiktok, api] = await Promise.all([
      readFile('apps/web/src/components/ShortsPremiumSettings.tsx', 'utf8'),
      readFile('apps/web/src/pages/YoutubeShortsPage.tsx', 'utf8'),
      readFile('apps/web/src/pages/TikTokShortsPage.tsx', 'utf8'),
      readFile('apps/api/src/shorts-premium.ts', 'utf8'),
    ]);
    expect(youtube).toContain('<ShortsPremiumSettings canAdmin={allowedAdmin} />');
    expect(tiktok).toContain('<ShortsPremiumSettings canAdmin={allowedAdmin} />');
    expect(component).toContain('Keine Free-Modelle');
    expect(component).toContain('Titel, Beschreibung, Tags und Veröffentlichungsplanung');
    expect(component).toMatch(/Stimme\s+erzeugen & abspielen/);
    expect(component).toContain('ElevenLabs Voice-ID direkt eingeben');
    expect(component).toContain('gemeinsam für YouTube- und TikTok-Shorts');
    expect(component).toContain('Länge von AVAs gesprochener Einordnung');
    expect(component).toContain('Originaltitel am Anfang vorlesen');
    expect(api).toContain('updateEnvironmentDocument(content, { ELEVENLABS_API_KEY: value })');
    expect(api).toContain("'/v2/voices?page_size=100'");
    expect(api).toContain("'/v1/user/subscription'");
  });
});
