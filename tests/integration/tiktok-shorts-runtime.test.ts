import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createYoutubeVideo, query } from '../../packages/database/src/index.js';
import {
  ensureTikTokShortJob,
  handoffTikTokShortJob,
  markTikTokShortManuallyPublished,
  queueTikTokShortPublish,
  recoverStaleTikTokShortJobs,
} from '../../packages/database/src/tiktok-shorts.js';

const integration = process.env.VITEST_INCLUDE_INTEGRATION === 'true' ? describe : describe.skip;

integration('TikTok Shorts database runtime', () => {
  const youtubeVideoIds: string[] = [];

  afterEach(async () => {
    if (!youtubeVideoIds.length) return;
    await query('delete from youtube_short_jobs where youtube_video_id=any($1::text[])', [youtubeVideoIds]);
    await query('delete from youtube_videos where video_id=any($1::text[])', [youtubeVideoIds]);
    youtubeVideoIds.length = 0;
  });

  it('supports a repeatable manual handoff, explicit confirmation and the optional API queue', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const youtubeVideoId = `tiktok-runtime-${suffix}`;
    youtubeVideoIds.push(youtubeVideoId);
    const video = await createYoutubeVideo({
      title: `TikTok Runtime ${suffix}`,
      url: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
      videoId: youtubeVideoId,
      channelTitle: 'Runtime-Kanal',
      durationSeconds: 300,
    });
    const source = (
      await query<{ id: string }>(
        `insert into youtube_short_jobs(
           youtube_library_id,youtube_video_id,status,production_date,source_title,source_channel,source_url,
           commentary_headline,commentary_text,commentary_model,transcript_excerpt,clip_start_seconds
         ) values($1,$2,'ready',current_date,$3,$4,$5,$6,$7,$8,$9,15) returning id`,
        [
          video.id,
          youtubeVideoId,
          `TikTok Runtime ${suffix}`,
          'Runtime-Kanal',
          `https://www.youtube.com/watch?v=${youtubeVideoId}`,
          'Einordnung',
          'Eine redaktionell geprüfte Einordnung für den TikTok-Laufzeittest.',
          'test-model',
          'Ein echtes Transkript mit genügend Kontext für einen qualifizierten vertikalen Clip.',
        ],
      )
    ).rows[0]!;

    const created = await ensureTikTokShortJob(source.id, { manual: true });
    expect(created).toMatchObject({ queued: true });
    if (!created.queued || !created.job) throw new Error('TikTok-Testauftrag wurde nicht erstellt.');
    const jobId = created.job.id;
    const duplicate = await ensureTikTokShortJob(source.id, { manual: true });
    expect(duplicate).toMatchObject({ queued: false, job: { id: jobId } });

    await query("update tiktok_short_jobs set status='ready',output_path='/tmp/runtime.mp4',progress=90 where id=$1", [
      jobId,
    ]);
    const handedOff = await handoffTikTokShortJob(jobId);
    expect(handedOff).toMatchObject({ status: 'handed-off', handoff_count: 1, remote_status: 'MANUAL_HANDOFF' });
    const handedOffAgain = await handoffTikTokShortJob(jobId);
    expect(handedOffAgain).toMatchObject({ status: 'handed-off', handoff_count: 2 });
    const manuallyPublished = await markTikTokShortManuallyPublished(
      jobId,
      'https://www.tiktok.com/@runtime/video/123456789',
    );
    expect(manuallyPublished).toMatchObject({
      status: 'published',
      remote_status: 'MANUAL_CONFIRMED',
      post_url: 'https://www.tiktok.com/@runtime/video/123456789',
    });
    await expect(markTikTokShortManuallyPublished(jobId, null)).resolves.toBeNull();

    await query(
      "update tiktok_short_jobs set status='ready',published_at=null,manual_published_at=null,post_url=null where id=$1",
      [jobId],
    );
    const queued = await queueTikTokShortPublish(jobId, {
      caption: 'Geprüfte TikTok-Einordnung',
      privacyLevel: 'SELF_ONLY',
      disableComment: true,
      disableDuet: true,
      disableStitch: true,
      brandContentToggle: false,
      brandOrganicToggle: false,
    });
    expect(queued).toMatchObject({ status: 'upload-queued', privacy_level: 'SELF_ONLY' });
    await expect(
      queueTikTokShortPublish(jobId, {
        caption: 'Doppelter Upload',
        privacyLevel: 'SELF_ONLY',
        disableComment: true,
        disableDuet: true,
        disableStitch: true,
        brandContentToggle: false,
        brandOrganicToggle: false,
      }),
    ).resolves.toBeNull();

    await query(
      "update tiktok_short_jobs set status='processing',locked_at=null,locked_by=null,error=null where id=$1",
      [jobId],
    );
    await recoverStaleTikTokShortJobs();
    expect(
      (await query<{ error: string | null }>('select error from tiktok_short_jobs where id=$1', [jobId])).rows[0]
        ?.error,
    ).toBeNull();

    await query(
      "update tiktok_short_jobs set locked_at=now()-interval '31 minutes',locked_by='dead-worker' where id=$1",
      [jobId],
    );
    await recoverStaleTikTokShortJobs();
    expect(
      (
        await query<{ status: string; locked_by: string | null; error: string }>(
          'select status,locked_by,error from tiktok_short_jobs where id=$1',
          [jobId],
        )
      ).rows[0],
    ).toMatchObject({
      status: 'processing',
      locked_by: null,
      error: 'Nach einem Worker-Neustart automatisch wieder aufgenommen.',
    });
  });
});
