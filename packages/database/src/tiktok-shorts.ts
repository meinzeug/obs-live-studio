import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { query, transaction } from './index.js';
import {
  normalizeShortsLayout,
  enqueueYoutubeShortForCurrent,
  type ShortsLayoutConfig,
  type YoutubeShortJob,
  type YoutubeShortEnqueueResult,
} from './youtube-shorts.js';

export type TikTokShortStatus =
  | 'queued'
  | 'rendering'
  | 'ready'
  | 'handed-off'
  | 'upload-queued'
  | 'uploading'
  | 'processing'
  | 'published'
  | 'failed'
  | 'cancelled';

export type TikTokShortsSettings = {
  id: boolean;
  enabled: boolean;
  auto_create: boolean;
  daily_limit: number;
  minimum_interval_hours: number;
  duration_seconds: 90;
  caption_template: string;
  time_zone: string;
  source_volume_percent: number;
  source_duck_percent: number;
  app_audited: boolean;
  publishing_mode: 'manual' | 'api';
  layout_config: ShortsLayoutConfig;
  updated_at: string;
};

export type TikTokShortJob = {
  id: string;
  source_job_id: string;
  status: TikTokShortStatus;
  progress: number;
  production_date: string;
  output_path: string | null;
  thumbnail_path: string | null;
  caption: string;
  privacy_level: string | null;
  disable_comment: boolean;
  disable_duet: boolean;
  disable_stitch: boolean;
  brand_content_toggle: boolean;
  brand_organic_toggle: boolean;
  rights_confirmed: boolean;
  music_usage_confirmed: boolean;
  publish_id: string | null;
  post_id: string | null;
  post_url: string | null;
  remote_status: string | null;
  handoff_at: string | null;
  handoff_count: number;
  manual_published_at: string | null;
  manual_post_url: string | null;
  attempts: number;
  error: string | null;
  next_attempt_at: string;
  locked_at: string | null;
  locked_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  published_at: string | null;
  premium_plan: Record<string, unknown>;
  planned_publish_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  source_title: string;
  source_channel: string;
  source_url: string;
  commentary_headline: string;
  commentary_text: string;
  commentary_model: string;
  transcript_excerpt: string;
  clip_start_seconds: number;
  clip_duration_seconds: 90;
  youtube_video_id: string;
};

const joinedColumns = `t.*,source.source_title,source.source_channel,source.source_url,
  source.commentary_headline,source.commentary_text,source.commentary_model,source.transcript_excerpt,
  source.clip_start_seconds,source.clip_duration_seconds,source.youtube_video_id`;

function premiumTikTokPublication(source: YoutubeShortJob) {
  const plan = source.premium_plan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
  const candidate = (plan as { tiktok?: unknown }).tiktok;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const entry = candidate as { caption?: unknown; hashtags?: unknown; publishDelayMinutes?: unknown };
  const caption = typeof entry.caption === 'string' ? entry.caption.trim() : '';
  const hashtags = Array.isArray(entry.hashtags)
    ? entry.hashtags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
  return {
    caption: `${caption} ${hashtags.join(' ')}`.trim().slice(0, 2_200),
    plan,
    plannedPublishAt: new Date(
      Date.now() + Math.max(0, Math.min(1440, Math.round(Number(entry.publishDelayMinutes ?? 0)))) * 60_000,
    ).toISOString(),
  };
}

function applyTemplate(
  template: string,
  source: Pick<YoutubeShortJob, 'source_title' | 'source_channel' | 'source_url'>,
) {
  return template
    .replaceAll('{title}', source.source_title)
    .replaceAll('{channel}', source.source_channel)
    .replaceAll('{url}', source.source_url)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2_200);
}

export async function getTikTokShortsSettings() {
  const row = (await query<TikTokShortsSettings>('select * from tiktok_shorts_settings where id=true')).rows[0];
  return row ? { ...row, layout_config: normalizeShortsLayout('tiktok', row.layout_config) } : row;
}

export async function updateTikTokShortsSettings(
  input: Partial<{
    enabled: boolean;
    autoCreate: boolean;
    dailyLimit: number;
    minimumIntervalHours: number;
    captionTemplate: string;
    timeZone: string;
    sourceVolumePercent: number;
    sourceDuckPercent: number;
    appAudited: boolean;
    publishingMode: 'manual' | 'api';
    layoutConfig: ShortsLayoutConfig;
  }>,
) {
  return (
    await query<TikTokShortsSettings>(
      `update tiktok_shorts_settings set
         enabled=coalesce($1,enabled),auto_create=coalesce($2,auto_create),daily_limit=coalesce($3,daily_limit),
         caption_template=coalesce($4,caption_template),time_zone=coalesce($5,time_zone),
         source_volume_percent=coalesce($6,source_volume_percent),source_duck_percent=coalesce($7,source_duck_percent),
         app_audited=coalesce($8,app_audited),publishing_mode=coalesce($9,publishing_mode),
         minimum_interval_hours=coalesce($10,minimum_interval_hours),
         layout_config=coalesce($11::jsonb,layout_config),updated_at=now()
       where id=true returning *`,
      [
        input.enabled ?? null,
        input.autoCreate ?? null,
        input.dailyLimit ?? null,
        input.captionTemplate ?? null,
        input.timeZone ?? null,
        input.sourceVolumePercent ?? null,
        input.sourceDuckPercent ?? null,
        input.appAudited ?? null,
        input.publishingMode ?? null,
        input.minimumIntervalHours ?? null,
        input.layoutConfig ? JSON.stringify(normalizeShortsLayout('tiktok', input.layoutConfig)) : null,
      ],
    )
  ).rows[0];
}

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: any[]): Promise<QueryResult<T>>;
};

async function joinedJob(client: Queryable, id: string) {
  return (
    (
      await client.query<TikTokShortJob>(
        `select ${joinedColumns} from tiktok_short_jobs t
       join youtube_short_jobs source on source.id=t.source_job_id where t.id=$1`,
        [id],
      )
    ).rows[0] ?? null
  );
}

async function ensureTikTokShortJobWithClient(client: PoolClient, sourceJobId: string, manual: boolean) {
  await client.query("select pg_advisory_xact_lock(hashtext('tiktok-shorts-daily'))");
  const settings = (
    await client.query<TikTokShortsSettings>('select * from tiktok_shorts_settings where id=true for update')
  ).rows[0];
  if (!settings?.enabled) return { queued: false as const, reason: 'Der TikTok Shorts Creator ist deaktiviert.' };
  if (!manual && !settings.auto_create)
    return { queued: false as const, reason: 'Die automatische TikTok-Clip-Erstellung ist deaktiviert.' };
  const source = (
    await client.query<YoutubeShortJob>(
      `select * from youtube_short_jobs where id=$1 and status<>'cancelled' for update`,
      [sourceJobId],
    )
  ).rows[0];
  if (!source) return { queued: false as const, reason: 'Der qualifizierte AVA-Moment ist nicht mehr verfügbar.' };
  const existing = (
    await client.query<{ id: string }>('select id from tiktok_short_jobs where source_job_id=$1', [sourceJobId])
  ).rows[0];
  if (existing) {
    const job = await joinedJob(client, existing.id);
    return { queued: false as const, reason: 'Für diesen Moment existiert bereits ein TikTok-Clip.', job: job! };
  }
  const productionDate = (
    await client.query<{ production_date: string }>(`select ((now() at time zone $1)::date)::text production_date`, [
      settings.time_zone,
    ])
  ).rows[0]!.production_date;
  const dailyCount = Number(
    (
      await client.query<{ count: string }>(
        `select count(*)::text count from tiktok_short_jobs where production_date=$1::date and status<>'cancelled'`,
        [productionDate],
      )
    ).rows[0]?.count ?? 0,
  );
  if (!manual && (settings.daily_limit <= 0 || dailyCount >= settings.daily_limit))
    return { queued: false as const, reason: `Das TikTok-Tageslimit von ${settings.daily_limit} Clips ist erreicht.` };
  if (!manual && settings.minimum_interval_hours > 0) {
    const lastCreatedAt = (
      await client.query<{ created_at: string | null }>(
        `select max(created_at)::text created_at from tiktok_short_jobs where status<>'cancelled'`,
      )
    ).rows[0]?.created_at;
    if (lastCreatedAt) {
      const nextAllowedAt = new Date(lastCreatedAt).getTime() + settings.minimum_interval_hours * 3_600_000;
      if (nextAllowedAt > Date.now()) {
        const remainingMinutes = Math.max(1, Math.ceil((nextAllowedAt - Date.now()) / 60_000));
        return {
          queued: false as const,
          reason: `TikTok wartet noch ${remainingMinutes} Minuten auf den eingestellten Mindestabstand.`,
        };
      }
    }
  }
  const premium = premiumTikTokPublication(source);
  const inserted = (
    await client.query<{ id: string }>(
      `insert into tiktok_short_jobs(source_job_id,production_date,caption,premium_plan,planned_publish_at,metadata)
       values($1,$2::date,$3,$4::jsonb,$5::timestamptz,$6::jsonb) returning id`,
      [
        source.id,
        productionDate,
        premium?.caption || applyTemplate(settings.caption_template, source),
        JSON.stringify(premium?.plan ?? {}),
        premium?.plannedPublishAt ?? null,
        JSON.stringify({
          trigger: manual ? 'manual' : 'autopilot',
          isAigc: true,
          premiumEditorial: Boolean(source.premium_planned_at),
          premiumEditorialModel: source.commentary_model,
        }),
      ],
    )
  ).rows[0]!;
  return { queued: true as const, job: (await joinedJob(client, inserted.id))! };
}

export async function ensureTikTokShortJob(sourceJobId: string, options: { manual?: boolean } = {}) {
  return transaction((client) => ensureTikTokShortJobWithClient(client, sourceJobId, options.manual === true));
}

export async function enqueueTikTokShortForCurrent() {
  const sourceResult: YoutubeShortEnqueueResult = await enqueueYoutubeShortForCurrent();
  if (!sourceResult.job) return sourceResult;
  return ensureTikTokShortJob(sourceResult.job.id, { manual: true });
}

export async function synchronizeTikTokShortJobs(limit = 25) {
  const settings = await getTikTokShortsSettings();
  if (!settings?.enabled || !settings.auto_create) return { created: 0 };
  const sources = (
    await query<{ id: string }>(
      `select source.id from youtube_short_jobs source
       left join tiktok_short_jobs target on target.source_job_id=source.id
       where target.id is null and source.status<>'cancelled'
         and coalesce(source.metadata->'requestedPlatforms','[]'::jsonb) ? 'tiktok'
         and source.created_at>=((now() at time zone $1)::date at time zone $1)
       order by source.created_at limit $2`,
      [settings.time_zone, Math.max(1, Math.min(100, limit))],
    )
  ).rows;
  let created = 0;
  for (const source of sources) {
    const result = await ensureTikTokShortJob(source.id).catch(() => null);
    if (result?.queued) created += 1;
  }
  await query(
    `update tiktok_short_jobs target set
       caption=left(trim(concat(
         source.premium_plan#>>'{tiktok,caption}',' ',
         coalesce((select string_agg(value,' ') from jsonb_array_elements_text(source.premium_plan#>'{tiktok,hashtags}')), '')
       )),2200),premium_plan=source.premium_plan,
       planned_publish_at=coalesce(target.planned_publish_at,
         now()+make_interval(mins=>coalesce((source.premium_plan#>>'{tiktok,publishDelayMinutes}')::int,0))),
       metadata=coalesce(target.metadata,'{}'::jsonb)||jsonb_build_object(
         'premiumEditorial',true,'premiumEditorialModel',source.commentary_model
       ),updated_at=now()
     from youtube_short_jobs source
     where target.source_job_id=source.id and source.premium_planned_at is not null
       and target.status in ('queued','failed','cancelled') and target.premium_plan='{}'::jsonb`,
  );
  return { created };
}

export async function listTikTokShortJobs(limit = 120) {
  return (
    await query<TikTokShortJob>(
      `select ${joinedColumns} from tiktok_short_jobs t
       join youtube_short_jobs source on source.id=t.source_job_id
       order by t.created_at desc limit $1`,
      [Math.max(1, Math.min(300, limit))],
    )
  ).rows;
}

export async function getTikTokShortJob(id: string) {
  return joinedJob({ query: (text, values) => query(text, values) }, id);
}

export async function tikTokShortsSummary() {
  const settings = await getTikTokShortsSettings();
  const productionDate = (
    await query<{ production_date: string }>(`select ((now() at time zone $1)::date)::text production_date`, [
      settings.time_zone,
    ])
  ).rows[0]!.production_date;
  const counts = Object.fromEntries(
    (
      await query<{ status: TikTokShortStatus; count: string }>(
        'select status,count(*)::text count from tiktok_short_jobs group by status',
      )
    ).rows.map((row) => [row.status, Number(row.count)]),
  );
  const today = Number(
    (
      await query<{ count: string }>(
        `select count(*)::text count from tiktok_short_jobs where production_date=$1::date and status<>'cancelled'`,
        [productionDate],
      )
    ).rows[0]?.count ?? 0,
  );
  return { productionDate, today, remaining: Math.max(0, settings.daily_limit - today), counts };
}

export async function claimTikTokShortJob(workerId: string) {
  return transaction(async (client) => {
    const candidate = (
      await client.query<{ id: string; status: TikTokShortStatus }>(
        `select t.id,t.status from tiktok_short_jobs t
         join tiktok_shorts_settings settings on settings.id=true
         join youtube_short_jobs source on source.id=t.source_job_id
         where settings.enabled and t.next_attempt_at<=now()
           and t.status in ('queued','upload-queued','processing')
           and (t.status<>'queued' or source.premium_planned_at is not null)
         order by case t.status when 'upload-queued' then 0 when 'processing' then 1 else 2 end,t.created_at
         for update of t skip locked limit 1`,
      )
    ).rows[0];
    if (!candidate) return null;
    const mode = candidate.status === 'queued' ? 'render' : candidate.status === 'upload-queued' ? 'upload' : 'status';
    const status: TikTokShortStatus = mode === 'render' ? 'rendering' : mode === 'upload' ? 'uploading' : 'processing';
    await client.query(
      `update tiktok_short_jobs set status=$2,progress=case when $3='render' then 8 else progress end,
       attempts=case when $3='status' then attempts else attempts+1 end,locked_at=now(),locked_by=$4,
       started_at=coalesce(started_at,now()),error=null,updated_at=now() where id=$1`,
      [candidate.id, status, mode, workerId],
    );
    return { job: (await joinedJob(client, candidate.id))!, mode: mode as 'render' | 'upload' | 'status' };
  });
}

export async function updateTikTokShortJob(
  id: string,
  input: Partial<{
    status: TikTokShortStatus;
    progress: number;
    outputPath: string | null;
    thumbnailPath: string | null;
    publishId: string | null;
    postId: string | null;
    postUrl: string | null;
    remoteStatus: string | null;
    error: string | null;
    metadata: Record<string, unknown>;
    nextAttemptAt: string;
    completed: boolean;
    published: boolean;
  }>,
) {
  await query(
    `update tiktok_short_jobs set status=coalesce($2,status),progress=coalesce($3,progress),
       output_path=case when $4 then $5 else output_path end,
       thumbnail_path=case when $6 then $7 else thumbnail_path end,
       publish_id=case when $8 then $9 else publish_id end,post_id=case when $10 then $11 else post_id end,
       post_url=case when $12 then $13 else post_url end,remote_status=case when $14 then $15 else remote_status end,
       error=case when $16 then $17 else error end,metadata=coalesce(metadata,'{}'::jsonb)||coalesce($18::jsonb,'{}'::jsonb),
       next_attempt_at=coalesce($19::timestamptz,next_attempt_at),
       completed_at=case when $20 then now() else completed_at end,
       published_at=case when $21 then now() else published_at end,
       locked_at=case when coalesce($2,status) in ('ready','handed-off','processing','published','failed','cancelled','queued','upload-queued') then null else locked_at end,
       locked_by=case when coalesce($2,status) in ('ready','handed-off','processing','published','failed','cancelled','queued','upload-queued') then null else locked_by end,
       updated_at=now() where id=$1 and status<>'cancelled'`,
    [
      id,
      input.status ?? null,
      input.progress ?? null,
      Object.prototype.hasOwnProperty.call(input, 'outputPath'),
      input.outputPath ?? null,
      Object.prototype.hasOwnProperty.call(input, 'thumbnailPath'),
      input.thumbnailPath ?? null,
      Object.prototype.hasOwnProperty.call(input, 'publishId'),
      input.publishId ?? null,
      Object.prototype.hasOwnProperty.call(input, 'postId'),
      input.postId ?? null,
      Object.prototype.hasOwnProperty.call(input, 'postUrl'),
      input.postUrl ?? null,
      Object.prototype.hasOwnProperty.call(input, 'remoteStatus'),
      input.remoteStatus ?? null,
      Object.prototype.hasOwnProperty.call(input, 'error'),
      input.error ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.nextAttemptAt ?? null,
      input.completed ?? false,
      input.published ?? false,
    ],
  );
  return getTikTokShortJob(id);
}

export async function queueTikTokShortPublish(
  id: string,
  input: {
    caption: string;
    privacyLevel: string;
    disableComment: boolean;
    disableDuet: boolean;
    disableStitch: boolean;
    brandContentToggle: boolean;
    brandOrganicToggle: boolean;
  },
) {
  const updated = await query<{ id: string }>(
    `update tiktok_short_jobs set status='upload-queued',caption=$2,privacy_level=$3,
       disable_comment=$4,disable_duet=$5,disable_stitch=$6,brand_content_toggle=$7,brand_organic_toggle=$8,
       rights_confirmed=true,music_usage_confirmed=true,error=null,next_attempt_at=now(),attempts=0,updated_at=now()
     where id=$1 and status='ready' and output_path is not null returning id`,
    [
      id,
      input.caption,
      input.privacyLevel,
      input.disableComment,
      input.disableDuet,
      input.disableStitch,
      input.brandContentToggle,
      input.brandOrganicToggle,
    ],
  );
  return updated.rows[0] ? getTikTokShortJob(id) : null;
}

export async function handoffTikTokShortJob(id: string) {
  const updated = await query<{ id: string }>(
    `update tiktok_short_jobs set status='handed-off',handoff_at=now(),handoff_count=handoff_count+1,
       remote_status='MANUAL_HANDOFF',error=null,locked_at=null,locked_by=null,updated_at=now()
     where id=$1 and status in ('ready','handed-off') and output_path is not null returning id`,
    [id],
  );
  return updated.rows[0] ? getTikTokShortJob(id) : null;
}

export async function markTikTokShortManuallyPublished(id: string, postUrl: string | null) {
  const updated = await query<{ id: string }>(
    `update tiktok_short_jobs set status='published',progress=100,post_url=coalesce($2,post_url),
       manual_post_url=$2,manual_published_at=now(),published_at=now(),remote_status='MANUAL_CONFIRMED',
       error=null,locked_at=null,locked_by=null,updated_at=now()
     where id=$1 and status='handed-off' returning id`,
    [id, postUrl],
  );
  return updated.rows[0] ? getTikTokShortJob(id) : null;
}

export async function reviseTikTokShortJob(id: string, caption: string) {
  const updated = await query<{ id: string }>(
    `update tiktok_short_jobs set caption=$2,updated_at=now()
     where id=$1 and status in ('queued','ready','handed-off','failed','cancelled') returning id`,
    [id, caption],
  );
  return updated.rows[0] ? getTikTokShortJob(id) : null;
}

export async function retryTikTokShortJob(id: string) {
  const updated = await query<{ id: string }>(
    `update tiktok_short_jobs set status=case when output_path is null then 'queued' else 'ready' end,
       progress=case when output_path is null then 0 else 90 end,error=null,attempts=0,next_attempt_at=now(),
       locked_at=null,locked_by=null,updated_at=now() where id=$1 and status in ('failed','cancelled') returning id`,
    [id],
  );
  return updated.rows[0] ? getTikTokShortJob(id) : null;
}

export async function cancelTikTokShortJob(id: string) {
  const updated = await query<{ id: string }>(
    `update tiktok_short_jobs set status='cancelled',locked_at=null,locked_by=null,updated_at=now()
     where id=$1 and status not in ('published','processing','cancelled') returning id`,
    [id],
  );
  return updated.rows[0] ? getTikTokShortJob(id) : null;
}

export async function failTikTokShortJob(
  id: string,
  input: { stage: 'render' | 'upload' | 'status'; error: string; retryable: boolean },
) {
  const retryStatus = input.stage === 'render' ? 'queued' : input.stage === 'upload' ? 'upload-queued' : 'processing';
  await query(
    `update tiktok_short_jobs set
       status=case when $2 and (attempts<3 or $3='status') then $4 else 'failed' end,
       error=$5,next_attempt_at=case when $2 then now()+(least(600,15*power(2,greatest(0,attempts-1)))||' seconds')::interval else next_attempt_at end,
       metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('failedStage',$3),locked_at=null,locked_by=null,updated_at=now()
     where id=$1 and status<>'cancelled'`,
    [id, input.retryable, input.stage, retryStatus, input.error.slice(0, 1800)],
  );
  return getTikTokShortJob(id);
}

export async function deleteTikTokShortJob(id: string) {
  return transaction(async (client) => {
    const current = await joinedJob(client, id);
    if (!current) return { job: null, reason: 'not-found' as const };
    if (['rendering', 'uploading', 'processing'].includes(current.status))
      return { job: null, reason: 'active' as const };
    await client.query('delete from tiktok_short_jobs where id=$1', [id]);
    return { job: current, reason: null };
  });
}

export async function recoverStaleTikTokShortJobs() {
  return query(
    `update tiktok_short_jobs set
       status=case when status='uploading' then 'upload-queued' when status='processing' then 'processing' else 'queued' end,
       error='Nach einem Worker-Neustart automatisch wieder aufgenommen.',next_attempt_at=now(),
       locked_at=null,locked_by=null,updated_at=now()
     where (
       status in ('rendering','uploading') and (locked_at is null or locked_at<now()-interval '30 minutes')
     ) or (
       status='processing' and locked_at is not null and locked_at<now()-interval '30 minutes'
     )`,
  );
}
