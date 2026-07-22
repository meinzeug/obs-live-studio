import { randomUUID } from 'node:crypto';
import { access, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runYoutubeEditorDownload } from '../apps/worker/src/video-editor.js';

const sourceUrl = process.env.VIDEO_EDITOR_DOWNLOAD_SMOKE_URL?.trim();
const videoId = process.env.VIDEO_EDITOR_DOWNLOAD_SMOKE_ID?.trim();
const projectId = randomUUID();
const downloadDirectory = resolve('downloads/youtube-video-editor', projectId);

describe.skipIf(!sourceUrl || !videoId)('YouTube video editor yt-dlp integration', () => {
  afterAll(async () => {
    await rm(downloadDirectory, { recursive: true, force: true });
  });

  it('downloads best video and audio, merges them and reports real progress', async () => {
    const progress: number[] = [];
    const source = {
      id: randomUUID(),
      project_id: projectId,
      source_kind: 'youtube-url',
      youtube_library_id: null,
      media_asset_id: null,
      youtube_video_id: videoId!,
      source_url: sourceUrl!,
      title: 'yt-dlp Integrationsprüfung',
      channel_title: 'YouTube',
      media_type: 'video',
      duration_seconds: 30,
      preview_url: null,
      local_path: null,
      status: 'downloading',
      error: null,
      download_progress: 1,
      download_quality: '720p',
      download_mode: 'video',
      downloaded_size_bytes: null,
      download_metadata: {},
      download_attempts: 1,
      download_locked_by: 'integration-test',
      download_locked_at: new Date().toISOString(),
      sort_order: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } satisfies Parameters<typeof runYoutubeEditorDownload>[0];
    const result = await runYoutubeEditorDownload(
      source,
      { ...process.env, VIDEO_EDITOR_MAX_DOWNLOAD_BYTES: String(200 * 1024 * 1024) },
      async (value) => {
        progress.push(value);
      },
    );
    await expect(access(result.path)).resolves.toBeUndefined();
    expect((await stat(result.path)).size).toBeGreaterThan(10_000);
    expect(result.durationSeconds).toBeGreaterThan(1);
    expect(result.metadata.videoCodec).toBeTruthy();
    expect(result.metadata.audioCodec).toBeTruthy();
    expect(progress.some((value) => value > 1)).toBe(true);
  }, 180_000);
});
