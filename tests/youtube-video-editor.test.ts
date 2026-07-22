import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  defaultVideoEditorDocument,
  normalizeVideoEditorDocument,
  videoEditorDuration,
} from '../packages/database/src/video-editor.js';
import { buildVideoEditorClipComposition, videoEditorDimensions } from '../apps/worker/src/video-editor.js';
import {
  rippleTimedLayers,
  rollTimelineCut,
  slipTimelineClip,
  snapTimelineTime,
  splitTimelineClip,
  timelineClipStart,
  timelineCutPoints,
  trimTimelineClip,
} from '../apps/web/src/video-editor-timeline.js';

describe('YouTube video editor', () => {
  it('persists projects, reusable sources and independent render jobs', async () => {
    const [migration, visualMigration, migrate] = await Promise.all([
      readFile('packages/database/src/051_youtube_video_editor.sql', 'utf8'),
      readFile('packages/database/src/053_video_editor_visual_tools.sql', 'utf8'),
      readFile('packages/database/src/migrate.ts', 'utf8'),
    ]);
    expect(migration).toContain('create table if not exists youtube_video_editor_projects');
    expect(migration).toContain('create table if not exists youtube_video_editor_sources');
    expect(migration).toContain('create table if not exists youtube_video_editor_renders');
    expect(migration).toContain("'720p','1080p','1440p'");
    expect(migration).toContain('download_progress');
    expect(visualMigration).toContain("status in ('remote','queued','downloading','ready','error')");
    expect(migrate).toContain("'051_youtube_video_editor.sql'");
    expect(migrate).toContain("'053_video_editor_visual_tools.sql'");
  });

  it('normalizes a real multi-track timeline and derives its exact duration', () => {
    const sourceId = 'ca09ec88-e82a-4e88-8fe1-c355479d49be';
    const document = normalizeVideoEditorDocument({
      ...defaultVideoEditorDocument(),
      clips: [
        {
          id: 'clip-1',
          sourceId,
          name: 'Auftakt',
          sourceStart: 12,
          duration: 8.5,
          volume: 1,
          fit: 'cover',
          transition: 'fade',
        },
      ],
      audioTracks: [
        {
          id: 'audio-1',
          sourceId,
          name: 'Musik',
          startAt: 2,
          sourceStart: 0,
          duration: 12,
          volume: 0.5,
          fadeIn: 1,
          fadeOut: 2,
          muted: false,
        },
      ],
      textTracks: [
        {
          id: 'text-1',
          text: 'Einordnung',
          startAt: 1,
          duration: 4,
          x: 80,
          y: 80,
          width: 900,
          fontFamily: 'dejavu-sans',
          fontSize: 48,
          color: '#ffffff',
          backgroundColor: '#000000',
          backgroundOpacity: 0.65,
          opacity: 0.9,
          outlineColor: '#111111',
          outlineWidth: 2,
          shadowColor: '#000000',
          shadowX: 2,
          shadowY: 3,
          align: 'left',
          animation: 'fade',
        },
      ],
      imageTracks: [
        {
          id: 'image-1',
          sourceId,
          name: 'Logo',
          startAt: 1,
          duration: 4,
          x: 700,
          y: 80,
          width: 220,
          height: 220,
          opacity: 0.9,
          rotation: -2,
          fit: 'contain',
          animation: 'slide-left',
        },
      ],
    });
    expect(videoEditorDuration(document)).toBe(8.5);
    expect(document.clips[0]?.fit).toBe('cover');
    expect(videoEditorDimensions('1080p', '16:9')).toEqual({ width: 1920, height: 1080 });
    expect(videoEditorDimensions('720p', '9:16')).toEqual({ width: 720, height: 1280 });
    expect(document.imageTracks[0]?.animation).toBe('slide-left');
  });

  it('supports frame-snapped trim, split, ripple, roll and slip edits', () => {
    const clips = [
      { id: 'a', sourceId: 'source-a', sourceStart: 2, duration: 8, transition: 'cut', transitionDuration: 0.5 },
      { id: 'b', sourceId: 'source-b', sourceStart: 4, duration: 7, transition: 'dissolve', transitionDuration: 1 },
    ];
    expect(timelineClipStart(clips, 'b')).toBe(7);
    expect(timelineCutPoints(clips)).toEqual([0, 8, 14]);
    expect(snapTimelineTime(7.96, [8], 0.1, 30)).toBe(8);

    const trimmed = trimTimelineClip({
      clips,
      clipId: 'a',
      edge: 'start',
      deltaSeconds: 1.5,
      sourceDuration: 30,
    });
    expect(trimmed.clips[0]).toMatchObject({ sourceStart: 3.5, duration: 6.5 });

    const split = splitTimelineClip({ clips, clipId: 'a', offsetSeconds: 3, newClipId: 'a-2' });
    expect(split.split).toBe(true);
    expect(split.clips).toHaveLength(3);
    expect(split.clips[1]).toMatchObject({ id: 'a-2', sourceStart: 5, duration: 5, transition: 'cut' });

    const rolled = rollTimelineCut({ clips, leftClipId: 'a', deltaSeconds: 1, leftSourceDuration: 20 });
    expect(rolled.clips[0]?.duration).toBe(9);
    expect(rolled.clips[1]).toMatchObject({ sourceStart: 5, duration: 6 });

    const slipped = slipTimelineClip({ clips, clipId: 'b', deltaSeconds: 2, sourceDuration: 20 });
    expect(slipped.clips[1]?.sourceStart).toBe(6);
    expect(rippleTimedLayers([{ startAt: 8, duration: 2 }], 7.5, -1)).toEqual([{ startAt: 7, duration: 2 }]);
  });

  it('builds real FFmpeg xfade and acrossfade transitions instead of metadata-only effects', () => {
    const document = normalizeVideoEditorDocument({
      ...defaultVideoEditorDocument(),
      clips: [
        { id: 'a', sourceId: 'source-a', name: 'A', duration: 4, transition: 'cut' },
        {
          id: 'b',
          sourceId: 'source-b',
          name: 'B',
          duration: 5,
          transition: 'wipeleft',
          transitionDuration: 0.75,
        },
      ],
    });
    const composition = buildVideoEditorClipComposition(document);
    expect(composition.duration).toBe(8.25);
    expect(composition.filters.join(';')).toContain('xfade=transition=wipeleft:duration=0.750:offset=3.250');
    expect(composition.filters.join(';')).toContain('acrossfade=d=0.750');
  });

  it('exposes imports, preview, inspector, timeline, render variants and downloads in the product UI', async () => {
    const [page, api, worker, navigation] = await Promise.all([
      readFile('apps/web/src/pages/YoutubeVideoEditorPage.tsx', 'utf8'),
      readFile('apps/api/src/youtube-video-editor.ts', 'utf8'),
      readFile('apps/worker/src/video-editor.ts', 'utf8'),
      readFile('apps/web/src/workspace-navigation.ts', 'utf8'),
    ]);
    expect(page).toContain('YouTube Video Studio');
    expect(page).toContain('Mehrere YouTube-URLs');
    expect(page).toContain('Lokale Mediathek');
    expect(page).toContain('Renderzentrale');
    expect(page).toContain('Ripple-Trim');
    expect(page).toContain('Bild-Overlay');
    expect(page).toContain('Downloadtyp');
    expect(api).toContain("app.post('/api/download'");
    expect(api).toContain("'/api/youtube-video-editor/sources/:id/local-file'");
    expect(api).toContain("'/api/youtube-video-editor/projects/:id/render'");
    expect(api).toContain('storeUploadedAudio');
    expect(worker).toContain('filter_complex');
    expect(worker).toContain('drawtext');
    expect(worker).toContain('VideoEditorDownloadProcessor');
    expect(worker).toContain('xfade=transition=');
    expect(navigation).toContain("id: 'youtube-video-editor'");
  });
});
