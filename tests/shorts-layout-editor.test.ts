import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultShortsLayout, normalizeShortsLayout } from '../packages/database/src/youtube-shorts.js';
import { buildShortsVisualFilters, writeShortsLayoutTextFiles } from '../apps/worker/src/shorts-layout.js';
import { shortsNarrationForDuration } from '../apps/worker/src/shorts-premium.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Shorts layout editor', () => {
  it('stores independent, constrained 9:16 layouts for YouTube and TikTok', async () => {
    const [migration, narrationMigration, migrate] = await Promise.all([
      readFile('packages/database/src/049_shorts_layout_editor.sql', 'utf8'),
      readFile('packages/database/src/050_shorts_narration_length.sql', 'utf8'),
      readFile('packages/database/src/migrate.ts', 'utf8'),
    ]);
    expect(migration).toContain('alter table youtube_shorts_settings');
    expect(migration).toContain('alter table tiktok_shorts_settings');
    expect(migration).toContain('layout_config jsonb');
    expect(migration).toContain('youtube_shorts_layout_config_valid');
    expect(migration).toContain('tiktok_shorts_layout_config_valid');
    expect(narrationMigration).toContain('narration_target_seconds');
    expect(narrationMigration).toContain('speak_video_title');
    expect(migrate).toContain("'049_shorts_layout_editor.sql'");
    expect(migrate).toContain("'050_shorts_narration_length.sql'");

    const youtube = normalizeShortsLayout('youtube', {
      ...defaultShortsLayout('youtube'),
      elements: {
        ...defaultShortsLayout('youtube').elements,
        sourceVideo: { ...defaultShortsLayout('youtube').elements.sourceVideo, x: -500, width: 9000 },
      },
    });
    expect(youtube.elements.sourceVideo.width).toBe(1080);
    expect(youtube.elements.sourceVideo.x).toBe(0);
    expect(defaultShortsLayout('tiktok').accentColor).toBe('#25f4ee');
  });

  it('turns visual geometry, visibility, typography and branding into real FFmpeg filters', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'short-layout-test-'));
    temporaryDirectories.push(directory);
    const layout = defaultShortsLayout('youtube');
    layout.elements.sourceVideo = { ...layout.elements.sourceVideo, x: 55, y: 135, width: 960, height: 720 };
    layout.elements.avatar = { ...layout.elements.avatar, x: 610, y: 1240, width: 470, height: 680 };
    layout.elements.title = {
      ...layout.elements.title,
      fontFamily: 'ibm-plex-condensed',
      fontSize: 56,
      align: 'center',
      color: '#fbbf24',
    };
    layout.elements.source.visible = false;
    const files = await writeShortsLayoutTextFiles(directory, layout, {
      formatLabel: 'AVA ORDNET EIN',
      title: 'Ein dynamischer Videotitel',
      commentary: 'Eine präzise redaktionelle Einordnung für den Test.',
      source: 'Quelle: Testkanal',
    });
    const filters = buildShortsVisualFilters({
      layout,
      durationSeconds: 90,
      leadSeconds: 0.75,
      speechSeconds: 24,
      idleTail: 65.25,
      sourceInput: 0,
      speakingInput: 2,
      idleInput: 3,
      brandingInput: 1,
      textFiles: files,
    }).join(';');
    expect(filters).toContain('scale=960:720');
    expect(filters).toContain('overlay=55:135');
    expect(filters).toContain('scale=470:680');
    expect(filters).toContain('overlay=610:1240');
    expect(filters).toContain('IBMPlexSansCondensed-Bold.ttf');
    expect(filters).toContain('fontsize=56');
    expect(filters).toContain('fontcolor=0xfbbf24');
    expect(filters).toContain('(936-text_w)/2');
    expect(filters).toContain('[1:v]scale=1080:1920[layoutbranding]');
    expect(filters).not.toContain(files.source);
  });

  it('offers drag, resize, presets, visibility and list-based text controls on both settings pages', async () => {
    const [editor, youtube, tiktok, css, youtubeApi, tiktokApi] = await Promise.all([
      readFile('apps/web/src/components/ShortsLayoutEditor.tsx', 'utf8'),
      readFile('apps/web/src/pages/YoutubeShortsPage.tsx', 'utf8'),
      readFile('apps/web/src/pages/TikTokShortsPage.tsx', 'utf8'),
      readFile('apps/web/src/style.css', 'utf8'),
      readFile('apps/api/src/youtube-shorts.ts', 'utf8'),
      readFile('apps/api/src/tiktok-shorts.ts', 'utf8'),
    ]);
    expect(editor).toContain('Visueller 9:16-Designer');
    expect(editor).toContain("mode: 'move' | 'resize'");
    expect(editor).toContain('Video groß');
    expect(editor).toContain('Split Story');
    expect(editor).toContain('Schriftart');
    expect(editor).toContain('Schriftgröße');
    expect(editor).toContain('Textfläche');
    expect(editor).toContain('PNG-Branding');
    expect(youtube).toContain('platform="youtube"');
    expect(tiktok).toContain('platform="tiktok"');
    expect(css).toContain('.shorts-layout-resize-handle');
    expect(css).toContain('.shorts-layout-layer');
    expect(youtubeApi).toContain('layoutConfig: shortsLayoutSchema.optional()');
    expect(tiktokApi).toContain('layoutConfig: shortsLayoutSchema.optional()');
  });

  it('keeps AVAs configured narration complete and optionally includes the original title', async () => {
    const [premiumUi, premiumWorker, provider] = await Promise.all([
      readFile('apps/web/src/components/ShortsPremiumSettings.tsx', 'utf8'),
      readFile('apps/worker/src/shorts-premium.ts', 'utf8'),
      readFile('packages/ai-provider/src/index.ts', 'utf8'),
    ]);
    expect(premiumUi).toContain('Länge von AVAs gesprochener Einordnung');
    expect(premiumUi).toContain('Originaltitel am Anfang vorlesen');
    expect(premiumWorker).toContain('shortsNarrationForDuration');
    expect(provider).toContain('narrationTargetSeconds');
    const longText = Array.from({ length: 150 }, (_, index) => `Wort${index}`).join(' ');
    const spoken = shortsNarrationForDuration('Videotitel', longText, 20);
    expect(spoken.split(/\s+/)).toHaveLength(41);
    expect(spoken.endsWith('.')).toBe(true);
  });
});
