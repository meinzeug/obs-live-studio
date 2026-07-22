import { query, transaction } from './index.js';
import type { PoolClient } from 'pg';

export type YoutubeShortStatus =
  | 'queued'
  | 'downloading'
  | 'rendering'
  | 'ready'
  | 'upload-queued'
  | 'uploading'
  | 'uploaded'
  | 'failed'
  | 'cancelled';

export type YoutubeShortsSettings = {
  id: boolean;
  enabled: boolean;
  auto_create: boolean;
  auto_upload: boolean;
  daily_limit: number;
  minimum_interval_hours: number;
  duration_seconds: 90;
  privacy_status: 'private' | 'unlisted' | 'public';
  overlay_path: string;
  rights_confirmed: boolean;
  source_volume_percent: number;
  source_duck_percent: number;
  title_template: string;
  description_template: string;
  tags: string[];
  time_zone: string;
  youtube_channel_id: string;
  updated_at: string;
};

export type YoutubeShortJob = {
  id: string;
  youtube_library_id: string;
  youtube_video_id: string;
  broadcast_item_id: string | null;
  ai_host_session_id: string | null;
  ai_staff_turn_id: string | null;
  status: YoutubeShortStatus;
  progress: number;
  production_date: string;
  source_title: string;
  source_channel: string;
  source_url: string;
  commentary_headline: string;
  commentary_text: string;
  commentary_model: string;
  transcript_excerpt: string;
  clip_start_seconds: number;
  clip_duration_seconds: 90;
  output_path: string | null;
  thumbnail_path: string | null;
  youtube_upload_id: string | null;
  youtube_upload_url: string | null;
  upload_privacy: string | null;
  attempts: number;
  error: string | null;
  next_attempt_at: string;
  locked_at: string | null;
  locked_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  uploaded_at: string | null;
  premium_plan: Record<string, unknown>;
  premium_planned_at: string | null;
  planned_publish_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export async function getYoutubeShortsSettings() {
  return (await query<YoutubeShortsSettings>('select * from youtube_shorts_settings where id=true')).rows[0];
}

export async function updateYoutubeShortsSettings(
  input: Partial<{
    enabled: boolean;
    autoCreate: boolean;
    autoUpload: boolean;
    dailyLimit: number;
    minimumIntervalHours: number;
    privacyStatus: YoutubeShortsSettings['privacy_status'];
    overlayPath: string;
    rightsConfirmed: boolean;
    sourceVolumePercent: number;
    sourceDuckPercent: number;
    titleTemplate: string;
    descriptionTemplate: string;
    tags: string[];
    timeZone: string;
    youtubeChannelId: string;
  }>,
) {
  return (
    await query<YoutubeShortsSettings>(
      `update youtube_shorts_settings set
         enabled=coalesce($1,enabled),auto_create=coalesce($2,auto_create),auto_upload=coalesce($3,auto_upload),
         daily_limit=coalesce($4,daily_limit),privacy_status=coalesce($5,privacy_status),
         overlay_path=coalesce($6,overlay_path),rights_confirmed=coalesce($7,rights_confirmed),
         source_volume_percent=coalesce($8,source_volume_percent),source_duck_percent=coalesce($9,source_duck_percent),
         title_template=coalesce($10,title_template),description_template=coalesce($11,description_template),
         tags=coalesce($12::jsonb,tags),time_zone=coalesce($13,time_zone),
         youtube_channel_id=coalesce($14,youtube_channel_id),
         minimum_interval_hours=coalesce($15,minimum_interval_hours),updated_at=now()
       where id=true returning *`,
      [
        input.enabled ?? null,
        input.autoCreate ?? null,
        input.autoUpload ?? null,
        input.dailyLimit ?? null,
        input.privacyStatus ?? null,
        input.overlayPath ?? null,
        input.rightsConfirmed ?? null,
        input.sourceVolumePercent ?? null,
        input.sourceDuckPercent ?? null,
        input.titleTemplate ?? null,
        input.descriptionTemplate ?? null,
        input.tags ? JSON.stringify(input.tags) : null,
        input.timeZone ?? null,
        input.youtubeChannelId ?? null,
        input.minimumIntervalHours ?? null,
      ],
    )
  ).rows[0];
}

type EligibleTurn = {
  turn_id: string;
  turn_kind: string;
  turn_status: string;
  headline: string;
  commentary: string;
  model: string | null;
  session_id: string;
  broadcast_item_id: string | null;
  youtube_library_id: string;
  youtube_video_id: string;
  source_title: string;
  source_channel: string;
  source_url: string;
  duration_seconds: number;
  transcript_text: string | null;
  transcript_segments: Array<{ startMs: number; durationMs: number; text: string }>;
  transcript_status: string;
  editorial_analysis_status: string;
  editorial_analysis_model: string | null;
  media_position_ms: string | number | null;
};

async function eligibleTurn(client: PoolClient, turnId: string) {
  return (
    await client.query<EligibleTurn>(
      `select turn.id turn_id,turn.kind turn_kind,turn.status turn_status,turn.headline,
              turn.text commentary,turn.model,session.id session_id,session.broadcast_item_id,
              yv.id youtube_library_id,yv.video_id youtube_video_id,yv.title source_title,
              yv.channel_title source_channel,yv.url source_url,yv.duration_seconds,yv.transcript_text,
              coalesce(yv.transcript_segments,'[]'::jsonb) transcript_segments,yv.transcript_status,
              yv.editorial_analysis_status,yv.editorial_analysis_model,control.media_position_ms
       from ai_staff_turns turn
       join ai_host_sessions session on session.id=turn.session_id
       join youtube_videos yv on yv.id=session.youtube_library_id and yv.deleted_at is null
       left join youtube_context_playback_controls control on control.broadcast_item_id=session.broadcast_item_id
       where turn.id=$1 and session.format_kind='youtube-context' and turn.staff_member_id='moderator'
       limit 1`,
      [turnId],
    )
  ).rows[0];
}

function transcriptExcerpt(turn: EligibleTurn, clipStartSeconds: number) {
  const segments = Array.isArray(turn.transcript_segments) ? turn.transcript_segments : [];
  const startMs = Math.max(0, clipStartSeconds - 20) * 1000;
  const endMs = (clipStartSeconds + 110) * 1000;
  const excerpt = segments
    .filter((segment) => segment.startMs + segment.durationMs >= startMs && segment.startMs <= endMs)
    .map((segment) => segment.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (excerpt || turn.transcript_text || '').slice(0, 8_000);
}

function eligibilityReason(turn: EligibleTurn | undefined, allowPremiumUpgrade = false) {
  if (!turn) return 'Für den aktuellen Beitrag liegt noch keine geeignete AVA-Einordnung vor.';
  if (turn.turn_kind !== 'context') return 'Nur inhaltliche AVA-Einordnungen können einen Short auslösen.';
  if (!['approved', 'live', 'expired'].includes(turn.turn_status))
    return 'Die AVA-Einordnung ist noch nicht freigegeben.';
  const transcriptSegments = Array.isArray(turn.transcript_segments)
    ? turn.transcript_segments.filter(
        (segment) => Number.isFinite(segment.startMs) && segment.startMs >= 0 && Boolean(segment.text?.trim()),
      )
    : [];
  if (
    turn.transcript_status !== 'ready' ||
    (turn.transcript_text?.trim().length ?? 0) < 300 ||
    transcriptSegments.length < 3
  )
    return 'Das Video besitzt noch kein ausreichend vollständiges, zeitcodiertes Transkript.';
  if (turn.editorial_analysis_status !== 'ready' || !turn.editorial_analysis_model)
    return 'Die KI-Redaktion hat noch keine qualifizierte Einordnung erstellt.';
  if ((!turn.model || /fallback|redaktioneller-fallback/i.test(turn.model)) && !allowPremiumUpgrade)
    return 'Eine reine Fallback-Einblendung wird nicht als Short verwendet.';
  if (turn.commentary.trim().length < 80) return 'Die AVA-Einordnung ist für einen eigenständigen Short noch zu kurz.';
  return null;
}

export type YoutubeShortEnqueueResult =
  { queued: true; job: YoutubeShortJob } | { queued: false; reason: string; job?: YoutubeShortJob };

type AutomaticPlatformUsage = {
  daily_count: string;
  last_created_at: string | null;
};

async function automaticPlatformUsage(client: PoolClient, platform: 'youtube' | 'tiktok', timeZone: string) {
  const legacyPlatforms = platform === 'youtube' ? '["youtube"]' : '[]';
  return (
    await client.query<AutomaticPlatformUsage>(
      `select
         count(*) filter(
           where (created_at at time zone $1)::date=(now() at time zone $1)::date
         )::text daily_count,
         max(created_at)::text last_created_at
       from youtube_short_jobs
       where status<>'cancelled'
         and coalesce(metadata->'requestedPlatforms',$2::jsonb) ? $3`,
      [timeZone, legacyPlatforms, platform],
    )
  ).rows[0] ?? { daily_count: '0', last_created_at: null };
}

function automaticPlatformBlockReason(
  label: string,
  usage: AutomaticPlatformUsage,
  dailyLimit: number,
  minimumIntervalHours: number,
  now = Date.now(),
) {
  if (dailyLimit <= 0) return `${label} ist durch das Tageslimit pausiert.`;
  if (Number(usage.daily_count) >= dailyLimit) return `Das ${label}-Tageslimit von ${dailyLimit} Shorts ist erreicht.`;
  const lastCreatedAt = usage.last_created_at ? new Date(usage.last_created_at).getTime() : 0;
  const nextAllowedAt = lastCreatedAt + Math.max(0, minimumIntervalHours) * 3_600_000;
  if (lastCreatedAt > 0 && nextAllowedAt > now) {
    const remainingMinutes = Math.max(1, Math.ceil((nextAllowedAt - now) / 60_000));
    return `${label} wartet noch ${remainingMinutes} Minuten auf den eingestellten Mindestabstand.`;
  }
  return null;
}

export async function enqueueYoutubeShortForTurn(
  turnId: string,
  options: { manual?: boolean } = {},
): Promise<YoutubeShortEnqueueResult> {
  return transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('youtube-shorts-daily'))");
    const settings = (
      await client.query<YoutubeShortsSettings>('select * from youtube_shorts_settings where id=true for update')
    ).rows[0];
    const tikTokSettings = (
      await client.query<{
        enabled: boolean;
        auto_create: boolean;
        daily_limit: number;
        minimum_interval_hours: number;
        time_zone: string;
      }>(
        `select enabled,auto_create,daily_limit,minimum_interval_hours,time_zone
         from tiktok_shorts_settings where id=true`,
      )
    ).rows[0];
    let youtubeRequested = Boolean(settings?.enabled && (options.manual || settings.auto_create));
    let tikTokRequested = Boolean(tikTokSettings?.enabled && (options.manual || tikTokSettings.auto_create));
    if (!youtubeRequested && !tikTokRequested)
      return { queued: false, reason: 'Die Shorts- und Clip-Creator sind deaktiviert oder pausiert.' };
    const turn = await eligibleTurn(client, turnId);
    // A manual request is upgraded by the mandatory paid Shorts editorial pass
    // before rendering. It may therefore use a fallback live turn as its timing
    // anchor, while automatic creation remains restricted to qualified turns.
    const reason = eligibilityReason(turn, options.manual === true);
    if (reason || !turn) return { queued: false, reason: reason! };
    const existing = (
      await client.query<YoutubeShortJob>('select * from youtube_short_jobs where youtube_video_id=$1 limit 1', [
        turn.youtube_video_id,
      ])
    ).rows[0];
    if (existing)
      return { queued: false, reason: 'Für dieses Video existiert bereits ein Short-Auftrag.', job: existing };
    const blocked: string[] = [];
    if (!options.manual && youtubeRequested) {
      const reason = automaticPlatformBlockReason(
        'YouTube',
        await automaticPlatformUsage(client, 'youtube', settings.time_zone),
        settings.daily_limit,
        settings.minimum_interval_hours,
      );
      if (reason) {
        youtubeRequested = false;
        blocked.push(reason);
      }
    }
    if (!options.manual && tikTokRequested) {
      const reason = automaticPlatformBlockReason(
        'TikTok',
        await automaticPlatformUsage(client, 'tiktok', tikTokSettings.time_zone),
        tikTokSettings.daily_limit,
        tikTokSettings.minimum_interval_hours,
      );
      if (reason) {
        tikTokRequested = false;
        blocked.push(reason);
      }
    }
    if (!youtubeRequested && !tikTokRequested)
      return { queued: false, reason: blocked.join(' ') || 'Für keine Shorts-Plattform ist die Automatik bereit.' };
    const productionTimeZone = youtubeRequested ? settings.time_zone : tikTokSettings.time_zone;
    const productionDate = (
      await client.query<{ production_date: string }>(`select ((now() at time zone $1)::date)::text production_date`, [
        productionTimeZone,
      ])
    ).rows[0]!.production_date;
    const progressSeconds = Math.max(0, Number(turn.media_position_ms ?? 0) / 1000);
    const clipStartSeconds = Math.max(0, Math.min(Math.max(0, turn.duration_seconds - 90), progressSeconds - 12));
    const excerpt = transcriptExcerpt(turn, clipStartSeconds);
    const job = (
      await client.query<YoutubeShortJob>(
        `insert into youtube_short_jobs(
           youtube_library_id,youtube_video_id,broadcast_item_id,ai_host_session_id,ai_staff_turn_id,
           production_date,source_title,source_channel,source_url,commentary_headline,commentary_text,
           commentary_model,transcript_excerpt,clip_start_seconds,clip_duration_seconds,metadata
         ) values($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12,$13,$14,90,$15) returning *`,
        [
          turn.youtube_library_id,
          turn.youtube_video_id,
          turn.broadcast_item_id,
          turn.session_id,
          turn.turn_id,
          productionDate,
          turn.source_title,
          turn.source_channel,
          turn.source_url,
          turn.headline,
          turn.commentary,
          turn.model,
          excerpt,
          clipStartSeconds,
          {
            editorialAnalysisModel: turn.editorial_analysis_model,
            trigger: options.manual ? 'manual' : 'autopilot',
            premiumUpgradeRequired: Boolean(
              options.manual && /fallback|redaktioneller-fallback/i.test(turn.model ?? ''),
            ),
            requestedPlatforms: [youtubeRequested ? 'youtube' : '', tikTokRequested ? 'tiktok' : ''].filter(Boolean),
          },
        ],
      )
    ).rows[0]!;
    return { queued: true, job };
  });
}

export async function enqueueYoutubeShortForCurrent() {
  const turn = (
    await query<{ id: string }>(
      `select turn.id from ai_staff_turns turn
       join ai_host_sessions session on session.id=turn.session_id
       where session.ended_at is null and session.format_kind='youtube-context'
         and turn.staff_member_id='moderator' and turn.kind='context'
       order by turn.created_at desc limit 1`,
    )
  ).rows[0];
  if (!turn) return { queued: false as const, reason: 'Aktuell liegt keine qualifizierte AVA-Einordnung vor.' };
  return enqueueYoutubeShortForTurn(turn.id, { manual: true });
}

export async function listYoutubeShortJobs(limit = 100) {
  return (
    await query<YoutubeShortJob>('select * from youtube_short_jobs order by created_at desc limit $1', [
      Math.max(1, Math.min(300, limit)),
    ])
  ).rows;
}

export async function getYoutubeShortJob(id: string) {
  return (await query<YoutubeShortJob>('select * from youtube_short_jobs where id=$1', [id])).rows[0] ?? null;
}

export async function youtubeShortsSummary() {
  const settings = await getYoutubeShortsSettings();
  const productionDate = (
    await query<{ production_date: string }>(`select ((now() at time zone $1)::date)::text production_date`, [
      settings.time_zone,
    ])
  ).rows[0]!.production_date;
  const rows = (
    await query<{ status: YoutubeShortStatus; count: string }>(
      `select status,count(*)::text count from youtube_short_jobs group by status`,
    )
  ).rows;
  const counts = Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  const daily = (
    await query<{ produced_today: string; uploaded_today: string; uploading_today: string }>(
      `select
         count(*) filter(where production_date=$1::date and status<>'cancelled'
           and coalesce(metadata->'requestedPlatforms','["youtube"]'::jsonb) ? 'youtube')::text produced_today,
         count(*) filter(where uploaded_at is not null
           and (uploaded_at at time zone $2)::date=$1::date)::text uploaded_today,
         count(*) filter(where status='uploading' and locked_at is not null
           and (locked_at at time zone $2)::date=$1::date)::text uploading_today
       from youtube_short_jobs`,
      [productionDate, settings.time_zone],
    )
  ).rows[0];
  const producedToday = Number(daily?.produced_today ?? 0);
  const uploadedToday = Number(daily?.uploaded_today ?? 0);
  const uploadingToday = Number(daily?.uploading_today ?? 0);
  const reservedUploadsToday = uploadedToday + uploadingToday;
  return {
    productionDate,
    // Backward-compatible field: the primary daily limit is an upload limit.
    today: uploadedToday,
    producedToday,
    uploadedToday,
    uploadingToday,
    reservedUploadsToday,
    remaining: Math.max(0, settings.daily_limit - reservedUploadsToday),
    counts,
  };
}

export async function claimYoutubeShortJob(workerId: string, allowUpload: boolean) {
  return transaction(async (client) => {
    // Serialises every upload reservation across multiple worker processes. A
    // claimed `uploading` row immediately occupies one daily slot.
    await client.query("select pg_advisory_xact_lock(hashtext('youtube-shorts-upload-daily'))");
    const candidate = (
      await client.query<YoutubeShortJob>(
        `select job.* from youtube_short_jobs job
         join youtube_shorts_settings settings on settings.id=true
         left join tiktok_shorts_settings tiktok on tiktok.id=true
         where job.next_attempt_at<=now() and (
           ((settings.enabled or coalesce(tiktok.enabled,false)) and job.status='queued') or
           ($1 and settings.enabled and settings.rights_confirmed and settings.daily_limit>0
             and coalesce(job.metadata->'requestedPlatforms','["youtube"]'::jsonb) ? 'youtube'
             and (
               job.status='upload-queued' or
               (job.status='ready' and settings.auto_upload and coalesce(job.planned_publish_at,now())<=now())
             )
             and (
               select count(*) from youtube_short_jobs daily
               where (daily.status='uploaded' and daily.uploaded_at is not null
                        and (daily.uploaded_at at time zone settings.time_zone)::date=
                            (now() at time zone settings.time_zone)::date)
                  or (daily.status='uploading' and daily.locked_at is not null
                        and (daily.locked_at at time zone settings.time_zone)::date=
                            (now() at time zone settings.time_zone)::date)
             )<settings.daily_limit)
         )
         order by case when job.status in ('upload-queued','ready') then 0 else 1 end,job.created_at
         for update of job skip locked limit 1`,
        [allowUpload],
      )
    ).rows[0];
    if (!candidate) return null;
    const claimMode = candidate.status === 'queued' ? ('render' as const) : ('upload' as const);
    const nextStatus: YoutubeShortStatus = claimMode === 'render' ? 'downloading' : 'uploading';
    const job = (
      await client.query<YoutubeShortJob>(
        `update youtube_short_jobs set status=$2,progress=case when $3='render' then 5 else greatest(progress,90) end,
           attempts=attempts+1,locked_at=now(),locked_by=$4,started_at=coalesce(started_at,now()),error=null,updated_at=now()
         where id=$1 returning *`,
        [candidate.id, nextStatus, claimMode, workerId],
      )
    ).rows[0]!;
    return { job, claimMode };
  });
}

export async function updateYoutubeShortJob(
  id: string,
  input: Partial<{
    status: YoutubeShortStatus;
    progress: number;
    outputPath: string | null;
    thumbnailPath: string | null;
    youtubeUploadId: string | null;
    youtubeUploadUrl: string | null;
    uploadPrivacy: string | null;
    error: string | null;
    metadata: Record<string, unknown>;
    completed: boolean;
    uploaded: boolean;
  }>,
) {
  return (
    await query<YoutubeShortJob>(
      `update youtube_short_jobs set
         status=coalesce($2,status),progress=coalesce($3,progress),
         output_path=case when $4 then $5 else output_path end,
         thumbnail_path=case when $6 then $7 else thumbnail_path end,
         youtube_upload_id=case when $8 then $9 else youtube_upload_id end,
         youtube_upload_url=case when $10 then $11 else youtube_upload_url end,
         upload_privacy=case when $12 then $13 else upload_privacy end,
         error=case when $14 then $15 else error end,
         metadata=coalesce(metadata,'{}'::jsonb)||coalesce($16::jsonb,'{}'::jsonb),
         completed_at=case when $17 then now() else completed_at end,
         uploaded_at=case when $18 then now() else uploaded_at end,
         locked_at=case when coalesce($2,status) in ('ready','uploaded','failed','cancelled','queued','upload-queued') then null else locked_at end,
         locked_by=case when coalesce($2,status) in ('ready','uploaded','failed','cancelled','queued','upload-queued') then null else locked_by end,
         updated_at=now()
       where id=$1 and status<>'cancelled' returning *`,
      [
        id,
        input.status ?? null,
        input.progress ?? null,
        Object.prototype.hasOwnProperty.call(input, 'outputPath'),
        input.outputPath ?? null,
        Object.prototype.hasOwnProperty.call(input, 'thumbnailPath'),
        input.thumbnailPath ?? null,
        Object.prototype.hasOwnProperty.call(input, 'youtubeUploadId'),
        input.youtubeUploadId ?? null,
        Object.prototype.hasOwnProperty.call(input, 'youtubeUploadUrl'),
        input.youtubeUploadUrl ?? null,
        Object.prototype.hasOwnProperty.call(input, 'uploadPrivacy'),
        input.uploadPrivacy ?? null,
        Object.prototype.hasOwnProperty.call(input, 'error'),
        input.error ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.completed ?? false,
        input.uploaded ?? false,
      ],
    )
  ).rows[0];
}

export async function failYoutubeShortJob(
  id: string,
  input: { stage: 'render' | 'upload'; error: string; retryable?: boolean },
) {
  return (
    await query<YoutubeShortJob>(
      `update youtube_short_jobs set
         status=case when $3 and attempts<3 then case when $2='upload' then 'upload-queued' else 'queued' end else 'failed' end,
         progress=case when $2='upload' then greatest(progress,90) else progress end,
         error=$4,next_attempt_at=case when $3 and attempts<3 then now()+(least(300,15*power(2,greatest(0,attempts-1)))||' seconds')::interval else next_attempt_at end,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('failedStage',$2),
         locked_at=null,locked_by=null,updated_at=now()
       where id=$1 and status<>'cancelled' returning *`,
      [id, input.stage, input.retryable !== false, input.error.slice(0, 1800)],
    )
  ).rows[0];
}

export async function retryYoutubeShortJob(id: string) {
  return (
    await query<YoutubeShortJob>(
      `update youtube_short_jobs set
         status=case when output_path is null then 'queued' else 'ready' end,
         progress=case when output_path is null then 0 else 90 end,error=null,attempts=0,next_attempt_at=now(),
         locked_at=null,locked_by=null,updated_at=now()
       where id=$1 and status in ('failed','cancelled') returning *`,
      [id],
    )
  ).rows[0];
}

export async function queueYoutubeShortUpload(id: string) {
  return (
    await query<YoutubeShortJob>(
      `update youtube_short_jobs set status='upload-queued',error=null,next_attempt_at=now(),updated_at=now()
       where id=$1 and status='ready' and output_path is not null returning *`,
      [id],
    )
  ).rows[0];
}

export async function queueMissingYoutubeShortReupload(id: string) {
  return (
    await query<YoutubeShortJob>(
      `update youtube_short_jobs set
         status='upload-queued',progress=90,error=null,next_attempt_at=now(),
         youtube_upload_id=null,youtube_upload_url=null,upload_privacy=null,uploaded_at=null,
         metadata=(coalesce(metadata,'{}'::jsonb)-'uploadedChannelId')||jsonb_build_object(
           'youtubeRemoteState','reupload-queued','youtubeCheckedAt',now()
         ),updated_at=now()
       where id=$1 and status='uploaded' and output_path is not null
         and metadata->>'youtubeRemoteState'='missing' returning *`,
      [id],
    )
  ).rows[0];
}

export async function cancelYoutubeShortJob(id: string) {
  return (
    await query<YoutubeShortJob>(
      `update youtube_short_jobs set status='cancelled',locked_at=null,locked_by=null,updated_at=now()
       where id=$1 and status not in ('uploaded','cancelled') returning *`,
      [id],
    )
  ).rows[0];
}

export async function reviseYoutubeShortJob(
  id: string,
  input: {
    commentaryHeadline?: string;
    commentaryText?: string;
    publication?: {
      title: string;
      description: string;
      tags: string[];
      privacyStatus: 'private' | 'unlisted' | 'public';
    };
    rerender?: boolean;
  },
) {
  return transaction(async (client) => {
    const current = (
      await client.query<YoutubeShortJob>('select * from youtube_short_jobs where id=$1 for update', [id])
    ).rows[0];
    if (!current) return { job: null, reason: 'not-found' as const, removedPaths: [] as string[] };
    if (['downloading', 'rendering', 'uploading'].includes(current.status))
      return { job: null, reason: 'active' as const, removedPaths: [] as string[] };
    if (input.rerender && current.status === 'uploaded')
      return { job: null, reason: 'uploaded' as const, removedPaths: [] as string[] };
    const publication = input.publication ? JSON.stringify(input.publication) : null;
    const job = (
      await client.query<YoutubeShortJob>(
        `update youtube_short_jobs set
           commentary_headline=coalesce($2,commentary_headline),commentary_text=coalesce($3,commentary_text),
           metadata=case when $4::jsonb is null then metadata
                         else jsonb_set(coalesce(metadata,'{}'::jsonb),'{publication}',$4::jsonb,true) end,
           status=case when $5 then 'queued' else status end,
           progress=case when $5 then 0 else progress end,
           output_path=case when $5 then null else output_path end,
           thumbnail_path=case when $5 then null else thumbnail_path end,
           error=case when $5 then null else error end,
           attempts=case when $5 then 0 else attempts end,
           next_attempt_at=case when $5 then now() else next_attempt_at end,
           started_at=case when $5 then null else started_at end,
           completed_at=case when $5 then null else completed_at end,
           locked_at=null,locked_by=null,updated_at=now()
         where id=$1 returning *`,
        [id, input.commentaryHeadline ?? null, input.commentaryText ?? null, publication, input.rerender === true],
      )
    ).rows[0]!;
    return {
      job,
      reason: null,
      removedPaths: input.rerender
        ? [current.output_path, current.thumbnail_path].filter((path): path is string => Boolean(path))
        : [],
    };
  });
}

export async function deleteYoutubeShortJob(id: string) {
  return transaction(async (client) => {
    const current = (
      await client.query<YoutubeShortJob>('select * from youtube_short_jobs where id=$1 for update', [id])
    ).rows[0];
    if (!current) return { job: null, reason: 'not-found' as const };
    if (['downloading', 'rendering', 'uploading'].includes(current.status))
      return { job: null, reason: 'active' as const };
    const tikTokDependent = Number(
      (
        await client.query<{ count: string }>(
          'select count(*)::text count from tiktok_short_jobs where source_job_id=$1',
          [id],
        )
      ).rows[0]?.count ?? 0,
    );
    if (tikTokDependent > 0) return { job: null, reason: 'tiktok-dependent' as const };
    await client.query('delete from youtube_short_jobs where id=$1', [id]);
    return { job: current, reason: null };
  });
}

export async function recoverStaleYoutubeShortJobs() {
  return query(
    `update youtube_short_jobs set
       status=case when status='uploading' then 'upload-queued' else 'queued' end,
       error='Nach einem Worker-Neustart automatisch wieder aufgenommen.',
       next_attempt_at=now(),locked_at=null,locked_by=null,updated_at=now()
     where status in ('downloading','rendering','uploading')
       and (locked_at is null or locked_at<now()-interval '30 minutes')`,
  );
}
