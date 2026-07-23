import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { formatPlacementDefaults } from '../apps/api/src/broadcast-formats.js';
import type { BroadcastFormatRecord } from '@ans/database/broadcast-formats';

function format(overrides: Partial<BroadcastFormatRecord> = {}): BroadcastFormatRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'YouTube + News-Sidebar',
    system_key: 'youtube-news-sidebar',
    description: 'Testformat',
    content_mode: 'youtube-news-sidebar',
    layout: 'youtube-news-sidebar',
    overlay_project_id: '22222222-2222-4222-8222-222222222222',
    overlay_project_name: 'News links + YouTube rechts',
    overlay_template: 'youtube-news-sidebar',
    default_duration_minutes: 60,
    default_item_count: 4,
    color: '#ff9f43',
    icon: 'panel-right',
    settings: { pauseSeconds: 3, transition: 'fade', sidebarRotationSeconds: 12 },
    flow: {},
    active: true,
    is_system: true,
    usage_count: 5,
    upcoming_count: 2,
    next_scheduled_at: null,
    created_at: '2026-07-21T00:00:00.000Z',
    updated_at: '2026-07-21T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

describe('reusable broadcast formats', () => {
  it('turns a format into a self-contained show placement snapshot', () => {
    expect(
      formatPlacementDefaults(format(), {
        settings: { pauseSeconds: 7, notes: 'Einmalige Regieanweisung' },
      }),
    ).toEqual({
      formatId: '11111111-1111-4111-8111-111111111111',
      overlayProjectId: '22222222-2222-4222-8222-222222222222',
      settings: {
        pauseSeconds: 7,
        transition: 'fade',
        sidebarRotationSeconds: 12,
        targetRuntimeMinutes: 60,
        defaultItemCount: 4,
        notes: 'Einmalige Regieanweisung',
        contentMode: 'youtube-news-sidebar',
        youtubeNewsSidebar: true,
        youtubeContext: false,
      },
    });
  });

  it('keeps AVA context and plain YouTube layouts mutually exclusive', () => {
    const context = formatPlacementDefaults(format({ content_mode: 'youtube-context', layout: 'youtube-context' }), {
      settings: {},
    });
    expect(context.settings).toMatchObject({
      contentMode: 'youtube-context',
      youtubeContext: true,
      youtubeNewsSidebar: false,
    });
  });

  it('migrates legacy playlists, seeds studio formats and exposes the format manager', async () => {
    const [migration, database, api, page] = await Promise.all([
      readFile('packages/database/src/031_broadcast_formats.sql', 'utf8'),
      readFile('packages/database/src/broadcast-formats.ts', 'utf8'),
      readFile('apps/api/src/broadcast-formats.ts', 'utf8'),
      readFile('apps/web/src/pages/BroadcastPage.tsx', 'utf8'),
    ]);
    expect(migration).toContain('add column if not exists format_id');
    expect(migration).toContain('assign_broadcast_format_to_playlist');
    expect(migration).toContain("('YouTube-Einordnung mit AVA','youtube-context'");
    expect(database).toContain('listBroadcastPlaylistsWithFormats');
    expect(api).toContain("'/api/broadcast/formats'");
    expect(page).toContain('Formate einmal gestalten, als Sendungen befüllen');
    expect(page).toContain('Sendung planen');
    expect(page).toContain('Overlay im Designer bearbeiten');
  });

  it('seeds five concrete AVA context formats and routes them through autopilot, overlay and OBS', async () => {
    const [migration, database, worker, engine, obs, renderer] = await Promise.all([
      readFile('packages/database/src/061_ava_context_format_suite.sql', 'utf8'),
      readFile('packages/database/src/index.ts', 'utf8'),
      readFile('apps/worker/src/autopilot.ts', 'utf8'),
      readFile('packages/broadcast-engine/src/index.ts', 'utf8'),
      readFile('packages/obs-controller/src/index.ts', 'utf8'),
      readFile('apps/api/src/index.ts', 'utf8'),
    ]);
    for (const key of [
      'ava-context-lagezentrum',
      'ava-context-faktenradar',
      'ava-context-streitpunkt',
      'ava-context-quellencheck',
      'ava-context-nachtstudio',
    ]) {
      expect(migration).toContain(key);
    }
    expect(migration).toContain("'dailyFormats',(select value from daily_formats)");
    expect(migration).toContain('broadcastFormatSystemKey');
    expect(database).toContain('formatSystemKey?: string | null');
    expect(worker).toContain('contextRuntimeForFormat');
    expect(worker).toContain('formatSystemKey: contextRuntime?.formatSystemKey');
    expect(worker).toContain("and status in ('draft','starting','running','paused')");
    expect(engine).toContain('contextLayoutVariant');
    expect(engine).toContain('layoutVariant: youtube.contextLayoutVariant');
    expect(obs).toContain('youtubeContextPlacement');
    expect(obs).toContain('youtube-context-faktenradar');
    expect(renderer).toContain('layout-faktenradar');
    expect(renderer).toContain('context.formatName');
  });
});
