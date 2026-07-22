import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { query } from '../packages/database/src/index.js';
import {
  addVideoEditorSource,
  createVideoEditorMediaAsset,
  createVideoEditorProject,
  getVideoEditorProject,
  getVideoEditorRender,
  normalizeVideoEditorDocument,
  queueVideoEditorRenders,
  updateVideoEditorProject,
} from '../packages/database/src/video-editor.js';
import { renderVideoEditorJob } from '../apps/worker/src/video-editor.js';
import { processOutput, runProcess } from '../apps/worker/src/youtube-shorts.js';

const enabled = process.env.RUN_VIDEO_EDITOR_SMOKE === '1';
const createdProjects: string[] = [];
const createdAssets: string[] = [];
const createdPaths: string[] = [];

async function digest(path: string) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

describe.skipIf(!enabled)('YouTube video editor FFmpeg integration', () => {
  afterAll(async () => {
    for (const projectId of createdProjects) {
      const detail = await getVideoEditorProject(projectId).catch(() => null);
      for (const render of detail?.renders ?? []) if (render.media_asset_id) createdAssets.push(render.media_asset_id);
      await query('delete from youtube_video_editor_projects where id=$1', [projectId]).catch(() => undefined);
      await rm(resolve('var/media/video-editor/renders', projectId), { recursive: true, force: true });
    }
    if (createdAssets.length)
      await query('delete from media_assets where id=any($1::uuid[])', [[...new Set(createdAssets)]]).catch(
        () => undefined,
      );
    await Promise.all(createdPaths.map((path) => rm(path, { recursive: true, force: true })));
  });

  it('renders trims, a dissolve, a styled text layer, image motion and mixed audio into a valid MP4', async () => {
    const smokeId = randomUUID();
    const directory = resolve('var/media/video-editor', `smoke-${smokeId}`);
    createdPaths.push(directory);
    await mkdir(directory, { recursive: true });
    const firstPath = resolve(directory, 'first.mp4');
    const secondPath = resolve(directory, 'second.mp4');
    const imagePath = resolve(directory, 'overlay.png');
    await runProcess(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=0x174b7a:s=640x360:r=30:d=2.4',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000:duration=2.4',
        '-shortest',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        firstPath,
      ],
      60_000,
      'Erster Smoke-Clip',
    );
    await runProcess(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=0x70233f:s=640x360:r=30:d=2.4',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=660:sample_rate=48000:duration=2.4',
        '-shortest',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        secondPath,
      ],
      60_000,
      'Zweiter Smoke-Clip',
    );
    await runProcess(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', 'color=c=0xf8c847:s=180x100', '-frames:v', '1', '-threads', '1', imagePath],
      60_000,
      'Smoke-Grafik',
    );

    const videoAssets = [];
    for (const [path, filename, mimeType, durationSeconds] of [
      [firstPath, 'first.mp4', 'video/mp4', 2.4],
      [secondPath, 'second.mp4', 'video/mp4', 2.4],
      [imagePath, 'overlay.png', 'image/png', 0],
    ] as const) {
      const info = await stat(path);
      const asset = await createVideoEditorMediaAsset({
        filename,
        mimeType,
        sizeBytes: info.size,
        storagePath: path,
        sha256: await digest(path),
        durationSeconds,
        resolution: mimeType.startsWith('image/') ? '180x100' : '640x360',
        usage: mimeType.startsWith('image/') ? 'video-editor-image' : 'video-editor-source',
      });
      createdAssets.push(asset.id);
      videoAssets.push(asset);
    }

    const project = await createVideoEditorProject({ name: `FFmpeg Smoke ${smokeId}` });
    createdProjects.push(project.id);
    const sourceRows = [];
    for (const [index, asset] of videoAssets.entries()) {
      const image = index === 2;
      const added = await addVideoEditorSource({
        project_id: project.id,
        source_kind: 'media',
        youtube_library_id: null,
        media_asset_id: asset.id,
        youtube_video_id: null,
        source_url: null,
        title: asset.filename,
        channel_title: 'Integrationstest',
        media_type: image ? 'image' : 'video',
        duration_seconds: image ? 21_600 : 2.4,
        preview_url: null,
        local_path: asset.storage_path,
        status: 'ready',
        sort_order: index,
      });
      sourceRows.push(added.source);
    }

    const document = normalizeVideoEditorDocument({
      version: 1,
      canvas: { aspectRatio: '16:9', backgroundColor: '#050810', fps: 30 },
      clips: [
        {
          id: 'clip-a',
          sourceId: sourceRows[0]!.id,
          name: 'A',
          sourceStart: 0.2,
          duration: 1.8,
          volume: 0.7,
          fit: 'cover',
          transition: 'cut',
          effect: 'cinematic',
          effectIntensity: 0.5,
          motion: 'none',
        },
        {
          id: 'clip-b',
          sourceId: sourceRows[1]!.id,
          name: 'B',
          sourceStart: 0.1,
          duration: 1.9,
          volume: 0.7,
          fit: 'cover',
          transition: 'dissolve',
          transitionDuration: 0.45,
          effect: 'warm',
          effectIntensity: 0.55,
          motion: 'zoom-in',
        },
      ],
      audioTracks: [],
      textTracks: [
        {
          id: 'headline',
          text: 'Open TV Studio – Render geprüft',
          startAt: 0.25,
          duration: 2.4,
          x: 500,
          y: 840,
          width: 820,
          fontFamily: 'dejavu-sans',
          fontSize: 48,
          fontWeight: 'bold',
          color: '#ffffff',
          backgroundColor: '#050810',
          backgroundOpacity: 0.76,
          opacity: 1,
          outlineColor: '#000000',
          outlineWidth: 1,
          shadowColor: '#000000',
          shadowX: 1,
          shadowY: 2,
          align: 'center',
          animation: 'slide-left',
        },
      ],
      imageTracks: [
        {
          id: 'graphic',
          sourceId: sourceRows[2]!.id,
          name: 'Testgrafik',
          startAt: 0.4,
          duration: 2.2,
          x: 710,
          y: 80,
          width: 220,
          height: 150,
          opacity: 0.9,
          rotation: 3,
          fit: 'contain',
          animation: 'fade',
        },
      ],
    });
    const saved = await updateVideoEditorProject(project.id, {
      document,
      expectedRevision: project.revision,
    });
    expect(saved.reason).toBeNull();
    const queued = await queueVideoEditorRenders(project.id, ['720p']);
    const render = queued?.[0];
    expect(render).toBeTruthy();
    const detail = await getVideoEditorProject(project.id);
    await renderVideoEditorJob(
      { render: { ...render!, document_snapshot: document }, sources: detail!.sources },
      () => undefined,
      { ...process.env, VIDEO_EDITOR_PREPARE_PRESET: 'ultrafast', VIDEO_EDITOR_RENDER_PRESET: 'ultrafast' },
    );
    const completed = await getVideoEditorRender(render!.id);
    expect(completed?.status).toBe('ready');
    expect(completed?.output_path).toBeTruthy();
    const probe = JSON.parse(
      await processOutput(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration:stream=codec_type,width,height',
          '-of',
          'json',
          completed!.output_path!,
        ],
        30_000,
        'Render-Smoke-Prüfung',
      ),
    ) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
    expect(Number(probe.format?.duration)).toBeGreaterThan(3);
    expect(probe.streams?.some((stream) => stream.codec_type === 'audio')).toBe(true);
    expect(probe.streams?.find((stream) => stream.codec_type === 'video')).toMatchObject({ width: 1280, height: 720 });
  }, 180_000);
});
