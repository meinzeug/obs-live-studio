import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { evaluateBroadcastReadiness } from '../packages/database/src/broadcast-operations.js';

function playlist(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Testsendung',
    mode: 'hybrid',
    kind: 'show',
    description: null,
    scheduled_at: '2026-07-24T20:00:00.000Z',
    overlay_project_id: '22222222-2222-4222-8222-222222222222',
    settings: { targetRuntimeMinutes: 10 },
    status: 'draft',
    current_position: 0,
    started_at: null,
    paused_at: null,
    ended_at: null,
    created_at: '2026-07-24T10:00:00.000Z',
    production_status: 'draft',
    format_name: 'YouTube',
    format_content_mode: 'youtube',
    overlay_project_name: 'Testoverlay',
    overlay_published: true,
    ...overrides,
  } as any;
}

describe('shared broadcast operations workflow', () => {
  it('marks a complete YouTube rundown ready and scheduled', () => {
    const result = evaluateBroadcastReadiness(
      playlist(),
      [
        {
          id: '33333333-3333-4333-8333-333333333333',
          playlist_id: '11111111-1111-4111-8111-111111111111',
          article_id: null,
          position: 0,
          duration_seconds: 600,
          status: 'planned',
          error: null,
          started_at: null,
          finished_at: null,
          rules: {
            kind: 'youtube-video',
            url: 'https://www.youtube.com/watch?v=abc123',
            youtubeVideoId: 'abc123',
            durationSeconds: 600,
          },
          title: 'Video',
          article_status: null,
        },
      ] as any,
      '2026-07-24T12:00:00.000Z',
    );
    expect(result.ready).toBe(true);
    expect(result.status).toBe('scheduled');
    expect(result.totalRuntimeSeconds).toBe(600);
    expect(result.issues).toEqual([]);
  });

  it('blocks missing article audio and an unpublished overlay with actionable issues', () => {
    const result = evaluateBroadcastReadiness(playlist({ overlay_published: false, format_content_mode: 'news' }), [
      {
        id: '33333333-3333-4333-8333-333333333333',
        playlist_id: '11111111-1111-4111-8111-111111111111',
        article_id: '44444444-4444-4444-8444-444444444444',
        article_status: 'approved',
        position: 0,
        duration_seconds: null,
        audio_duration_seconds: null,
        audio_path: null,
        status: 'planned',
        error: null,
        started_at: null,
        finished_at: null,
        rules: {},
        title: 'Nachricht',
      },
    ] as any);
    expect(result.ready).toBe(false);
    expect(result.status).toBe('incomplete');
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['audio-missing', 'overlay-unpublished']),
    );
  });

  it('connects planning and control room through one status model and explicit return strategies', async () => {
    const [migration, api, navigation, planning, control, onAir] = await Promise.all([
      readFile('packages/database/src/070_broadcast_operations_workflow.sql', 'utf8'),
      readFile('apps/api/src/index.ts', 'utf8'),
      readFile('apps/web/src/workspace-navigation.ts', 'utf8'),
      readFile('apps/web/src/pages/BroadcastPage.tsx', 'utf8'),
      readFile('apps/web/src/pages/LivePage.tsx', 'utf8'),
      readFile('apps/web/src/components/OnAirBar.tsx', 'utf8'),
    ]);
    expect(migration).toContain('broadcast_live_interruptions');
    expect(api).toContain("'/api/sendebetrieb/status'");
    expect(api).toContain("'resume-position', 'next-item', 'next-show', 'standby'");
    expect(navigation).toContain("label: 'Sendebetrieb'");
    expect(navigation).toContain('matches: [routes.broadcast, routes.live]');
    expect(planning).toContain('<OnAirBar status={operations} active="planning"');
    expect(planning).toContain('Sendefähigkeitsprüfung');
    expect(control).toContain('<OnAirBar status={operations} active="control"');
    expect(control).toContain('Aktuelle Sendung');
    expect(control).toContain('Als Nächstes');
    expect(onAir).toContain('Gemeinsamer On-Air-Status');
  });
});
