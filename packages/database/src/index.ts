import pg from 'pg';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { QueryResultRow } from 'pg';
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) {
  return pool.query<T>(text, params);
}
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
export async function closeDatabase() {
  await pool.end();
}

export type EditorialStatus = 'new' | 'review' | 'approved' | 'blocked' | 'published' | 'discarded';
export interface SourceRecord {
  id: string;
  name: string;
  url: string;
  domain: string;
  type: string;
  category: string | null;
  region: string | null;
  language: string;
  description: string | null;
  priority: number;
  trust_level: number;
  fetch_interval_seconds: number;
  max_articles: number;
  max_fetch_seconds: number;
  active: boolean;
  etag: string | null;
  last_modified: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_errors: number;
  user_agent: string | null;
  created_at: string;
  updated_at?: string;
}
export interface ArticleRecord {
  id: string;
  source_id: string | null;
  source_name?: string;
  title: string;
  url: string;
  canonical_url: string | null;
  published_at: string | null;
  fetched_at: string;
  author: string | null;
  excerpt: string | null;
  main_text: string | null;
  content_hash: string;
  status: EditorialStatus;
  category: string | null;
  region: string | null;
  trust_score: number;
  warnings: string[];
}
export interface ArticleDetailRecord extends ArticleRecord {
  summary: string | null;
  editorial_notes: unknown[] | null;
  summary_model: string | null;
  summary_model_version: string | null;
  prompt_version: string | null;
  script_text: string | null;
  screen_text: string | null;
  ticker_text: string | null;
  audio_path: string | null;
  audio_duration_seconds: number | null;
}
export async function listSources() {
  return (await query<SourceRecord>('select * from sources where deleted_at is null order by created_at desc')).rows;
}
export async function getSource(id: string) {
  return (await query<SourceRecord>('select * from sources where id=$1 and deleted_at is null', [id])).rows[0] ?? null;
}
export async function createSource(input: Record<string, unknown>) {
  const url = new URL(String(input.url));
  return (
    await query<SourceRecord>(
      `insert into sources(name,url,domain,type,category,region,language,description,priority,trust_level,fetch_interval_seconds,max_articles,max_fetch_seconds,active,user_agent)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       on conflict (url) do update set
         name=excluded.name,
         domain=excluded.domain,
         type=excluded.type,
         category=excluded.category,
         region=excluded.region,
         language=excluded.language,
         description=excluded.description,
         priority=excluded.priority,
         trust_level=excluded.trust_level,
         fetch_interval_seconds=excluded.fetch_interval_seconds,
         max_articles=excluded.max_articles,
         max_fetch_seconds=excluded.max_fetch_seconds,
         active=excluded.active,
         user_agent=excluded.user_agent,
         deleted_at=null,
         last_error=null,
         consecutive_errors=0,
         version=sources.version+1
       returning *`,
      [
        input.name,
        input.url,
        url.hostname,
        input.type,
        input.category ?? null,
        input.region ?? null,
        input.language ?? 'de',
        input.description ?? null,
        input.priority ?? 0,
        input.trustLevel ?? 50,
        input.fetchIntervalSeconds ?? 900,
        input.maxArticles ?? 20,
        input.maxFetchSeconds ?? 20,
        input.active ?? true,
        input.userAgent ?? null,
      ],
    )
  ).rows[0];
}
export async function updateSource(id: string, input: Record<string, unknown>) {
  const current = await getSource(id);
  if (!current) throw new Error('Quelle nicht gefunden');
  const next: Record<string, unknown> = { ...current, ...input };
  const url = new URL(String(next.url));
  return (
    await query<SourceRecord>(
      `update sources set name=$2,url=$3,domain=$4,type=$5,category=$6,region=$7,language=$8,description=$9,priority=$10,trust_level=$11,fetch_interval_seconds=$12,max_articles=$13,max_fetch_seconds=$14,active=$15,user_agent=$16,version=version+1 where id=$1 returning *`,
      [
        id,
        next.name,
        next.url,
        url.hostname,
        next.type,
        next.category,
        next.region,
        next.language,
        next.description,
        next.priority,
        next.trustLevel ?? next.trust_level,
        next.fetchIntervalSeconds ?? next.fetch_interval_seconds,
        next.maxArticles ?? next.max_articles,
        next.maxFetchSeconds ?? next.max_fetch_seconds,
        next.active,
        next.userAgent ?? null,
      ],
    )
  ).rows[0];
}
export async function setSourceActive(id: string, active: boolean) {
  return (
    await query<SourceRecord>(
      'update sources set active=$2,version=version+1 where id=$1 and deleted_at is null returning *',
      [id, active],
    )
  ).rows[0];
}
export async function dueSources() {
  return (
    await query<SourceRecord>(
      `select * from sources where active=true and deleted_at is null and (last_success_at is null or last_success_at + (fetch_interval_seconds || ' seconds')::interval <= now() or (last_error is not null and last_success_at is null)) order by priority desc, created_at asc`,
    )
  ).rows;
}
export async function recordSourceCheck(sourceId: string | null, status: string, details: unknown) {
  await query('insert into source_checks(source_id,status,details) values($1,$2,$3)', [sourceId, status, details]);
}
export async function markSourceSuccess(id: string, etag?: string, lastModified?: string) {
  await query(
    'update sources set last_success_at=now(),last_error=null,consecutive_errors=0,etag=coalesce($2,etag),last_modified=coalesce($3,last_modified) where id=$1',
    [id, etag ?? null, lastModified ?? null],
  );
}
export async function markSourceError(id: string, error: string) {
  await query('update sources set last_error=$2,consecutive_errors=consecutive_errors+1 where id=$1', [
    id,
    error.slice(0, 1000),
  ]);
}
export async function upsertArticle(input: {
  sourceId: string;
  title: string;
  url: string;
  canonicalUrl?: string;
  publishedAt?: string;
  author?: string;
  excerpt?: string;
  mainText?: string;
  contentHash: string;
  category?: string | null;
  region?: string | null;
  trustScore?: number;
  warnings?: string[];
}) {
  const canonical = input.canonicalUrl ?? input.url;
  return (
    (
      await query<ArticleRecord>(
        `insert into articles(source_id,title,url,canonical_url,published_at,author,excerpt,main_text,content_hash,category,region,trust_score,warnings,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'new') on conflict do nothing returning *`,
        [
          input.sourceId,
          input.title,
          input.url,
          canonical,
          input.publishedAt ?? null,
          input.author ?? null,
          input.excerpt ?? null,
          input.mainText ?? null,
          input.contentHash,
          input.category ?? null,
          input.region ?? null,
          input.trustScore ?? 50,
          input.warnings ?? [],
        ],
      )
    ).rows[0] ?? null
  );
}
export async function createManualArticle(input: {
  title: string;
  excerpt?: string | null;
  mainText?: string | null;
  author?: string | null;
  category?: string | null;
  region?: string | null;
  canonicalUrl?: string | null;
  publishedAt?: string | null;
  trustScore?: number;
  warnings?: string[];
}) {
  const hashSeed = [
    'manual',
    input.title,
    input.excerpt ?? '',
    input.mainText ?? '',
    new Date().toISOString(),
    Math.random().toString(36).slice(2),
  ].join('\n');
  const contentHash = createHash('sha256').update(hashSeed).digest('hex');
  const canonical =
    input.canonicalUrl?.trim() || `https://local.open-tv-studio/manual-news/${contentHash.slice(0, 20)}`;
  return (
    (
      await query<ArticleRecord>(
        `insert into articles(source_id,title,url,canonical_url,published_at,author,excerpt,main_text,content_hash,category,region,trust_score,warnings,status)
       values(null,$1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'review')
       returning *`,
        [
          input.title,
          canonical,
          input.publishedAt ?? new Date().toISOString(),
          input.author ?? null,
          input.excerpt ?? null,
          input.mainText ?? null,
          contentHash,
          input.category ?? null,
          input.region ?? null,
          input.trustScore ?? 70,
          input.warnings ?? [],
        ],
      )
    ).rows[0] ?? null
  );
}
export async function listArticles(limit = 100) {
  return (
    await query<ArticleRecord>(
      `select a.*,coalesce(s.name,'Manuelle Redaktion') as source_name from articles a left join sources s on s.id=a.source_id where a.deleted_at is null order by coalesce(a.published_at,a.fetched_at) desc limit $1`,
      [limit],
    )
  ).rows;
}
export async function getArticleDetail(id: string) {
  return (
    (
      await query<ArticleDetailRecord>(
        `select a.*,coalesce(s.name,'Manuelle Redaktion') as source_name,sm.summary,sm.source_passages editorial_notes,sm.model_name summary_model,sm.model_version summary_model_version,sm.prompt_version,sc.text script_text,sc.screen_text,sc.ticker_text,aa.filename audio_path,aa.duration_seconds audio_duration_seconds from articles a left join sources s on s.id=a.source_id left join lateral (select * from summaries where article_id=a.id order by created_at desc limit 1) sm on true left join lateral (select * from scripts where article_id=a.id order by created_at desc limit 1) sc on true left join lateral (select aa.*,ma.filename from audio_assets aa join media_assets ma on ma.id=aa.media_id where aa.script_id=sc.id order by ma.created_at desc,ma.id desc limit 1) aa on true where a.id=$1 and a.deleted_at is null`,
        [id],
      )
    ).rows[0] ?? null
  );
}
export async function updateArticle(
  id: string,
  input: {
    title: string;
    excerpt: string | null;
    mainText: string | null;
    author: string | null;
    category: string | null;
    region: string | null;
    canonicalUrl: string;
  },
) {
  return (
    (
      await query<ArticleRecord>(
        `update articles
       set title=$2,
           excerpt=$3,
           main_text=$4,
           author=$5,
           category=$6,
           region=$7,
           canonical_url=$8,
           version=version+1
       where id=$1 and deleted_at is null
       returning *`,
        [
          id,
          input.title,
          input.excerpt,
          input.mainText,
          input.author,
          input.category,
          input.region,
          input.canonicalUrl,
        ],
      )
    ).rows[0] ?? null
  );
}
export async function deleteArticle(id: string) {
  return (
    (
      await query<{ id: string }>(
        `update articles
       set deleted_at=now(),
           status='discarded',
           version=version+1
       where id=$1 and deleted_at is null
       returning id`,
        [id],
      )
    ).rows[0] ?? null
  );
}
export async function setArticleStatus(id: string, status: EditorialStatus) {
  return (
    await query<ArticleRecord>(
      `update articles set status=$2,version=version+1 where id=$1 and deleted_at is null and $2=any('{new,review,approved,blocked,published,discarded}'::text[]) returning *`,
      [id, status],
    )
  ).rows[0];
}
export async function saveArticlePackage(
  articleId: string,
  summary: string,
  script: string,
  screenText?: string,
  tickerText?: string,
  metadata: {
    sourcePassages?: string[];
    modelName?: string;
    modelVersion?: string;
    promptVersion?: string;
    category?: string | null;
    warnings?: string[];
  } = {},
) {
  return query(
    `with a as (
       update articles
       set status=$10,category=coalesce($11::text,category),warnings=coalesce($12::text[],warnings),version=version+1
       where id=$1 and deleted_at is null
       returning *
     ), s as (
       insert into summaries(article_id,source_passages,summary,model_name,model_version,prompt_version)
       select id,$2,$3,$4,$5,$6 from a returning id
     ), sc as (
       insert into scripts(article_id,text,screen_text,ticker_text)
       select id,$7,$8,$9 from a returning id
     )
     select * from a`,
    [
      articleId,
      metadata.sourcePassages ?? [],
      summary,
      metadata.modelName ?? 'rule-based',
      metadata.modelVersion ?? '1',
      metadata.promptVersion ?? 'article-to-broadcast-v1',
      script,
      screenText ?? summary,
      tickerText ?? summary.slice(0, 140),
      'review',
      metadata.category ?? null,
      metadata.warnings ?? null,
    ],
  );
}
export async function saveAudioAsset(articleId: string, filename: string, durationSeconds: number) {
  const fileStat = await stat(filename);
  if (fileStat.size <= 44) throw new Error(`Sprecher-Audio-Datei ist leer: ${filename}`);
  return query(
    `with sc as (select id from scripts where article_id=$1 order by created_at desc limit 1), ma as (insert into media_assets(filename,mime_type,size_bytes,duration_seconds,usage) values($2,'audio/wav',$4,$3,'article-voice') returning id) insert into audio_assets(script_id,media_id,duration_seconds) select sc.id,ma.id,$3 from sc,ma`,
    [articleId, filename, durationSeconds, fileStat.size],
  );
}
export async function getPublishedMainArticle() {
  return (
    (
      await query<ArticleDetailRecord>(
        `select a.*,s.name source_name,sm.summary,sc.text script_text,aa.filename audio_path,aa.duration_seconds audio_duration_seconds from articles a left join sources s on s.id=a.source_id left join lateral (select * from summaries where article_id=a.id order by created_at desc limit 1) sm on true left join lateral (select * from scripts where article_id=a.id order by created_at desc limit 1) sc on true left join lateral (select aa.*,ma.filename from audio_assets aa join media_assets ma on ma.id=aa.media_id where aa.script_id=sc.id order by ma.created_at desc,ma.id desc limit 1) aa on true where a.status in ('published','approved') and a.deleted_at is null order by case when a.status='published' then 0 else 1 end, coalesce(a.published_at,a.fetched_at) desc limit 1`,
      )
    ).rows[0] ?? null
  );
}
export async function getLastPlayedArticle() {
  const row = (
    await query<{ article_id: string }>(
      `select article_id from broadcast_items where status='played' order by finished_at desc nulls last limit 1`,
    )
  ).rows[0];
  return row ? getArticleDetail(row.article_id) : null;
}
export async function dashboardStats() {
  const r = await query(
    `select (select count(*)::int from articles where status='new' and deleted_at is null) new_articles,(select count(*)::int from articles where status in ('approved','published') and deleted_at is null) approved,(select count(*)::int from broadcast_items where status='planned') planned,(select count(*)::int from articles where status='discarded' and deleted_at is null) discarded,(select count(*)::int from sources where active=true and consecutive_errors>0 and deleted_at is null) failed_sources`,
  );
  return r.rows[0];
}
export async function getSetting<T = unknown>(key: string) {
  return (await query<{ value: T }>('select value from system_settings where key=$1', [key])).rows[0]?.value ?? null;
}
export async function setSetting(key: string, value: unknown) {
  await query(
    'insert into system_settings(key,value,updated_at) values($1,$2,now()) on conflict(key) do update set value=excluded.value,updated_at=now()',
    [key, value],
  );
}
export interface AutopilotConfig {
  enabled: boolean;
  contentMode: 'news' | 'youtube' | 'mixed' | 'youtube-news-sidebar';
  minimumTrust: number;
  requireStream: boolean;
  requireVideo: boolean;
  showItemCount: number;
  pauseSeconds: number;
  pauseBetweenShowsSeconds: number;
  sidebarRotationSeconds: number;
  sourceIds: string[];
  youtubeCategoryIds: string[];
  dailyFormats: AutopilotDailyFormat[];
  scanLimit: number;
}
export interface AutopilotDailyFormat {
  id: string;
  name: string;
  startTime: string;
  durationMinutes: number;
  contentMode: 'news' | 'youtube' | 'mixed' | 'youtube-news-sidebar';
  youtubeCategoryIds: string[];
  sourceIds: string[];
  enabled: boolean;
}
function boundedSettingNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}
function normalizedAutopilotContentMode(value: unknown): AutopilotConfig['contentMode'] {
  return value === 'youtube' || value === 'mixed' || value === 'news' || value === 'youtube-news-sidebar'
    ? value
    : 'news';
}
function normalizedAutopilotFormat(value: unknown): AutopilotDailyFormat | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const name = String(input.name ?? '').trim();
  const startTime = String(input.startTime ?? '').trim();
  if (!name || !/^\d{2}:\d{2}$/.test(startTime)) return null;
  const stringArray = (candidate: unknown) =>
    Array.isArray(candidate)
      ? candidate.filter((item): item is string => typeof item === 'string' && !!item.trim())
      : [];
  return {
    id: String(input.id ?? createHash('sha1').update(`${name}:${startTime}`).digest('hex').slice(0, 12)),
    name,
    startTime,
    durationMinutes: boundedSettingNumber(input.durationMinutes, 60, 5, 24 * 60),
    contentMode: normalizedAutopilotContentMode(input.contentMode),
    youtubeCategoryIds: stringArray(input.youtubeCategoryIds),
    sourceIds: stringArray(input.sourceIds),
    enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
  };
}
export async function getAutopilotConfig(): Promise<AutopilotConfig> {
  const stored = (await getSetting<Partial<AutopilotConfig>>('autopilot.config')) ?? {};
  const environmentMinimumTrust = boundedSettingNumber(process.env.AUTOPILOT_MIN_TRUST, 80, 0, 100);
  const environmentScanLimit = boundedSettingNumber(process.env.AUTOPILOT_SCAN_LIMIT, 100, 1, 500);
  const environmentShowItemCount = boundedSettingNumber(process.env.AUTOPILOT_SHOW_ITEM_COUNT, 1, 1, 20);
  const environmentPauseSeconds = boundedSettingNumber(process.env.AUTOPILOT_PAUSE_SECONDS, 5, 0, 600);
  const environmentPauseBetweenShowsSeconds = boundedSettingNumber(
    process.env.AUTOPILOT_PAUSE_BETWEEN_SHOWS_SECONDS,
    15,
    0,
    3600,
  );
  const storedSourceIds = Array.isArray(stored.sourceIds)
    ? stored.sourceIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    : null;
  const storedYoutubeCategoryIds = Array.isArray(stored.youtubeCategoryIds)
    ? stored.youtubeCategoryIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    : [];
  const dailyFormats = Array.isArray(stored.dailyFormats)
    ? stored.dailyFormats
        .map(normalizedAutopilotFormat)
        .filter((value): value is AutopilotDailyFormat => Boolean(value))
    : [];
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : process.env.AUTOPILOT_ENABLED === 'true',
    contentMode: normalizedAutopilotContentMode(stored.contentMode ?? process.env.AUTOPILOT_CONTENT_MODE),
    minimumTrust: boundedSettingNumber(stored.minimumTrust, environmentMinimumTrust, 0, 100),
    requireStream:
      typeof stored.requireStream === 'boolean'
        ? stored.requireStream
        : process.env.AUTOPILOT_REQUIRE_STREAM !== 'false',
    requireVideo:
      typeof stored.requireVideo === 'boolean' ? stored.requireVideo : process.env.AUTOPILOT_REQUIRE_VIDEO !== 'false',
    showItemCount: boundedSettingNumber(stored.showItemCount, environmentShowItemCount, 1, 20),
    pauseSeconds: boundedSettingNumber(stored.pauseSeconds, environmentPauseSeconds, 0, 600),
    pauseBetweenShowsSeconds: boundedSettingNumber(
      stored.pauseBetweenShowsSeconds,
      environmentPauseBetweenShowsSeconds,
      0,
      3600,
    ),
    sidebarRotationSeconds: boundedSettingNumber(stored.sidebarRotationSeconds, 12, 3, 120),
    sourceIds:
      storedSourceIds ??
      (process.env.AUTOPILOT_SOURCE_IDS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    youtubeCategoryIds: storedYoutubeCategoryIds,
    dailyFormats,
    scanLimit: boundedSettingNumber(stored.scanLimit, environmentScanLimit, 1, 500),
  };
}
export async function setAutopilotConfig(config: AutopilotConfig) {
  await setSetting('autopilot.config', config);
  return config;
}
export async function getPlaybackState<T = unknown>() {
  return (
    (await query<{ state: T }>('select state from playback_state where id=true')).rows[0]?.state ?? { status: 'idle' }
  );
}
export async function setPlaybackState(state: unknown) {
  if (process.env.NODE_ENV === 'production' || process.env.BROADCAST_REQUIRE_CANONICAL_STATE === 'true') {
    throw new Error('setPlaybackState is disabled for the broadcast production path');
  }
  await query(
    'insert into playback_state(id,state,updated_at) values(true,$1,now()) on conflict(id) do update set state=excluded.state,updated_at=now()',
    [state],
  );
}

export interface PlaybackSnapshotRecord extends QueryResultRow {
  status: string;
  stateRevision: number;
  commandSeq: number;
  runId: string | null;
  playlistId: string | null;
  itemId: string | null;
  articleId: string | null;
  position: number | null;
  obsMediaStatus: string | null;
  mediaPositionMs: number | null;
  mediaDurationMs: number | null;
  obsConfirmedPositionMs: number | null;
  recoveryMode: string | null;
  recoveryReason: string | null;
  leaseGeneration: number | null;
  updatedAt: string | null;
  state: Record<string, unknown>;
}
function canonicalPlaybackState(row: any): PlaybackSnapshotRecord {
  const state = (row?.state && typeof row.state === 'object' ? row.state : {}) as Record<string, unknown>;
  return {
    status: String(state.status ?? 'idle'),
    stateRevision: Number(row?.state_revision ?? state.stateRevision ?? 0),
    commandSeq: Number(row?.command_sequence ?? state.commandSeq ?? 0),
    runId: (state.runId as string | undefined) ?? null,
    playlistId: (state.playlistId as string | undefined) ?? null,
    itemId: (state.itemId as string | undefined) ?? null,
    articleId: (state.articleId as string | undefined) ?? null,
    position: typeof state.position === 'number' ? state.position : null,
    obsMediaStatus: (row?.obs_media_status as string | null) ?? (state.obsMediaStatus as string | undefined) ?? null,
    mediaPositionMs:
      row?.media_position_ms == null
        ? ((state.mediaPositionMs as number | undefined) ?? null)
        : Number(row.media_position_ms),
    mediaDurationMs:
      row?.media_duration_ms == null
        ? ((state.mediaDurationMs as number | undefined) ?? null)
        : Number(row.media_duration_ms),
    obsConfirmedPositionMs:
      row?.obs_confirmed_position_ms == null
        ? ((state.obsConfirmedPositionMs as number | undefined) ?? null)
        : Number(row.obs_confirmed_position_ms),
    recoveryMode: (row?.recovery_mode as string | null) ?? (state.recoveryMode as string | undefined) ?? null,
    recoveryReason: (row?.recovery_reason as string | null) ?? (state.recoveryReason as string | undefined) ?? null,
    leaseGeneration: row?.lease_generation == null ? null : Number(row.lease_generation),
    updatedAt: (row?.updated_at as string | null) ?? null,
    state,
  };
}
export async function getPlaybackSnapshot() {
  const row = (
    await query(
      `select ps.*, brl.lease_generation from playback_state ps left join broadcast_runner_leases brl on brl.broadcast_run_id=(ps.state->>'runId')::uuid where ps.id=true`,
    )
  ).rows[0];
  return canonicalPlaybackState(row ?? { state: { status: 'idle' }, state_revision: 0, command_sequence: 0 });
}
export async function initializePlaybackRun(input: {
  broadcastRunId: string;
  playlistId: string;
  status?: string;
  recoveryMode?: string | null;
}) {
  return transaction(async (client) => {
    const state = {
      status: input.status ?? 'starting',
      runId: input.broadcastRunId,
      playlistId: input.playlistId,
      commandSeq: 0,
      stateRevision: 1,
      recoveryMode: input.recoveryMode ?? 'fresh',
    };
    await client.query(
      `insert into playback_state(id,state,state_revision,command_sequence,recovery_mode,updated_at) values(true,$1,1,0,$2,now()) on conflict(id) do update set state=excluded.state,state_revision=1,command_sequence=0,recovery_mode=excluded.recovery_mode,updated_at=now()`,
      [state, input.recoveryMode ?? 'fresh'],
    );
    return canonicalPlaybackState({
      state,
      state_revision: 1,
      command_sequence: 0,
      recovery_mode: input.recoveryMode ?? 'fresh',
    });
  });
}

export async function attachRunnerToPlaybackRun(input: {
  broadcastRunId: string;
  playlistId: string;
  runnerId: string;
  leaseGeneration: number;
}) {
  return transaction(async (client) => {
    const lease = (
      await client.query<RunnerLeaseRecord>(
        `select * from broadcast_runner_leases where broadcast_run_id=$1 for update`,
        [input.broadcastRunId],
      )
    ).rows[0];
    if (!lease || lease.runner_id !== input.runnerId || Number(lease.lease_generation) !== input.leaseGeneration)
      throw new Error('lease-fencing-conflict');
    if ((await client.query(`select 1 where $1::timestamptz >= now()`, [lease.lease_expires_at])).rowCount !== 1)
      throw new Error('lease-expired');
    const ps = (await client.query(`select * from playback_state where id=true for update`)).rows[0];
    if (!ps) throw new Error('playback-start-state-lost');
    const currentState = (ps.state ?? {}) as Record<string, unknown>;
    if (currentState.runId !== input.broadcastRunId || currentState.playlistId !== input.playlistId)
      throw new Error('playback-run-mismatch');
    const currentRevision = Number(ps.state_revision ?? 0);
    const nextRevision = currentRevision + 1;
    const commandSequence = Number(ps.command_sequence ?? 0);
    const state = {
      ...currentState,
      status: currentState.status ?? 'starting',
      runId: input.broadcastRunId,
      playlistId: input.playlistId,
      runnerId: input.runnerId,
      leaseGeneration: input.leaseGeneration,
      commandSeq: commandSequence,
      stateRevision: nextRevision,
    };
    const update = await client.query(
      `update playback_state set state=$1,state_revision=$2,updated_at=now() where id=true`,
      [state, nextRevision],
    );
    if (update.rowCount !== 1) throw new Error('playback-update-lost');
    const leaseUpdate = await client.query(
      `update broadcast_runner_leases set last_state_revision=$3 where broadcast_run_id=$1 and runner_id=$2 and lease_generation=$4`,
      [input.broadcastRunId, input.runnerId, nextRevision, input.leaseGeneration],
    );
    if (leaseUpdate.rowCount !== 1) throw new Error('lease-update-lost');
    const event = await appendLiveEventTx(client, {
      type: 'runner-attached',
      broadcastRunId: input.broadcastRunId,
      payload: state,
      dedupeKey: `${input.broadcastRunId}:${input.runnerId}:${input.leaseGeneration}:runner-attached`,
    });
    return {
      state,
      event,
      snapshot: canonicalPlaybackState({
        ...ps,
        state,
        state_revision: nextRevision,
        command_sequence: commandSequence,
        lease_generation: input.leaseGeneration,
      }),
    };
  });
}

export class BroadcastStartError extends Error {
  constructor(
    public readonly code:
      | 'playlist-not-found'
      | 'active-broadcast-run-exists'
      | 'playlist-has-no-broadcastable-items'
      | 'published-main-overlay-required'
      | 'idempotency-key-conflict'
      | 'idempotency-replay-unavailable'
      | 'playback-start-state-lost'
      | 'playlist-start-update-lost',
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}
const BROADCAST_START_LOCK_ID = 7_340_012_021;
const ACTIVE_BROADCAST_STATUSES = ['starting', 'running', 'paused', 'stopping', 'recovering'] as const;
function canonicalJson(value: unknown): string {
  if (value === undefined)
    throw new BroadcastStartError('idempotency-key-conflict', { reason: 'undefined-start-config' });
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => {
        if (object[key] === undefined)
          throw new BroadcastStartError('idempotency-key-conflict', { reason: 'undefined-start-config' });
        return `${JSON.stringify(key)}:${canonicalJson(object[key])}`;
      })
      .join(',')}}`;
  }
  throw new BroadcastStartError('idempotency-key-conflict', { reason: 'unsupported-start-config-value' });
}
function broadcastStartFingerprint(input: { playlistId: string; actorScope: string; config?: unknown }) {
  return createHash('sha256')
    .update(
      canonicalJson({
        playlistId: input.playlistId,
        actorScope: input.actorScope,
        config: input.config ?? {},
      }),
    )
    .digest('hex');
}

async function requirePublishedMainOverlayTx(client: pg.PoolClient) {
  const overlay = (
    await client.query(
      `select p.id project_id,p.width,p.height,p.template,p.status project_status,p.deleted_at,p.public_live_id,p.public_token_hash,p.public_url,
              p.obs_configured_version_id,v.id version_id,v.status version_status,v.published
       from overlay_projects p
       join overlay_versions v on v.project_id=p.id
       where p.deleted_at is null
         and coalesce(p.status,'draft') <> 'archived'
         and p.template='main-news'
         and v.status='published'
         and v.published=true
         and p.public_live_id is not null
         and p.public_token_hash is not null
         and p.public_url is not null
         and p.obs_configured_version_id=v.id
         and p.width > 0 and p.height > 0
       order by v.created_at desc
       limit 1
       for share`,
    )
  ).rows[0];
  if (!overlay) throw new BroadcastStartError('published-main-overlay-required');
  return overlay;
}

export async function requestBroadcastStart(input: {
  playlistId: string;
  requestedBy?: string | null;
  requestedByUserId?: string | null;
  requestedBySystem?: string | null;
  idempotencyKey?: string | null;
  config?: unknown;
}) {
  const actorScope = input.requestedByUserId
    ? `user:${input.requestedByUserId}`
    : `system:${input.requestedBySystem ?? input.requestedBy ?? 'anonymous'}`;
  const fingerprint = broadcastStartFingerprint({
    playlistId: input.playlistId,
    actorScope,
    config: input.config ?? {},
  });
  return transaction(async (client) => {
    await client.query('select pg_advisory_xact_lock($1)', [BROADCAST_START_LOCK_ID]);
    if (input.idempotencyKey) {
      const existing = (
        await client.query(
          `select o.*,r.playlist_id,r.status run_status
           from broadcast_recovery_operations o
           join broadcast_runs r on r.id=o.broadcast_run_id
           where o.operation_type='start' and o.idempotency_scope=$1 and o.idempotency_key=$2
           for update`,
          [actorScope, input.idempotencyKey],
        )
      ).rows[0];
      if (existing) {
        if (existing.request_fingerprint !== fingerprint || existing.playlist_id !== input.playlistId) {
          throw new BroadcastStartError('idempotency-key-conflict', { idempotencyKey: input.idempotencyKey });
        }
        const run = (await client.query('select * from broadcast_runs where id=$1', [existing.broadcast_run_id]))
          .rows[0];
        if (!existing.start_snapshot) throw new BroadcastStartError('idempotency-replay-unavailable');
        const playback = existing.start_snapshot;
        return { run, operation: existing, playback, event: null };
      }
    }
    const playlist = (
      await client.query(`select * from broadcast_playlists where id=$1 for update`, [input.playlistId])
    ).rows[0];
    if (!playlist) throw new BroadcastStartError('playlist-not-found');
    if (['ended', 'error', 'interrupted'].includes(String(playlist.status))) {
      await client.query(
        `update broadcast_items
         set status='planned',error=null,started_at=null,finished_at=null
         where playlist_id=$1 and status in ('played','skipped','error')`,
        [input.playlistId],
      );
      await client.query(
        `update broadcast_playlists set status='draft',current_position=0,started_at=null,paused_at=null,ended_at=null where id=$1`,
        [input.playlistId],
      );
    }
    const active = (
      await client.query(`select id,status from broadcast_runs where status = any($1::text[]) for update`, [
        ACTIVE_BROADCAST_STATUSES,
      ])
    ).rows[0];
    if (active) throw new BroadcastStartError('active-broadcast-run-exists', { activeRunId: active.id });
    const itemCheck = (
      await client.query(
        `select count(*)::int as count
         from broadcast_items bi
         left join articles a on a.id=bi.article_id
         left join lateral (select sc.id from scripts sc where sc.article_id=a.id order by sc.created_at desc limit 1) sc on true
         left join lateral (
           select aa.duration_seconds,ma.filename
           from audio_assets aa
           join media_assets ma on ma.id=aa.media_id
           where aa.script_id=sc.id
             and ma.filename is not null
             and aa.duration_seconds > 0
           order by ma.created_at desc,ma.id desc
           limit 1
         ) aa on true
         where bi.playlist_id=$1
           and bi.status in ('planned','preparing')
           and (
             (a.deleted_at is null and a.status in ('approved','published') and aa.filename is not null)
             or (bi.rules->>'kind'='youtube-video' and coalesce((bi.rules->>'youtubeVideoId'),'') <> '')
             or (bi.rules->>'kind'='youtube-news-sidebar' and coalesce((bi.rules->>'youtubeVideoId'),'') <> '')
           )`,
        [input.playlistId],
      )
    ).rows[0];
    if (Number(itemCheck?.count ?? 0) < 1) throw new BroadcastStartError('playlist-has-no-broadcastable-items');
    const overlay = await requirePublishedMainOverlayTx(client);
    const run = (
      await client.query(
        `insert into broadcast_runs(playlist_id,started_at,status,last_state) values($1,now(),'starting',$2) returning *`,
        [input.playlistId, { playlistId: input.playlistId, status: 'starting', overlayVersionId: overlay.version_id }],
      )
    ).rows[0];
    const state = {
      status: 'starting',
      runId: run.id,
      playlistId: input.playlistId,
      commandSeq: 0,
      stateRevision: 1,
      recoveryMode: 'fresh',
      overlayVersionId: overlay.version_id,
    };
    const operation = (
      await client.query(
        `insert into broadcast_recovery_operations(broadcast_run_id,requested_by,requested_by_user_id,reason,operation_type,idempotency_key,idempotency_scope,request_fingerprint,playlist_id,recovery_mode,initial_state_revision,start_snapshot)
         values($1,$2,$3,'start-broadcast-run','start',$4,$5,$6,$7,'fresh',1,$8) returning *`,
        [
          run.id,
          input.requestedBy ?? null,
          input.requestedByUserId ?? null,
          input.idempotencyKey ?? `start:${run.id}`,
          actorScope,
          fingerprint,
          input.playlistId,
          canonicalPlaybackState({ state, state_revision: 1, command_sequence: 0, recovery_mode: 'fresh' }),
        ],
      )
    ).rows[0];
    const psUpdate = await client.query(
      `insert into playback_state(id,state,state_revision,command_sequence,recovery_mode,updated_at) values(true,$1,1,0,'fresh',now())
       on conflict(id) do update set state=excluded.state,state_revision=1,command_sequence=0,recovery_mode='fresh',updated_at=now()`,
      [state],
    );
    if (psUpdate.rowCount !== 1) throw new BroadcastStartError('playback-start-state-lost');
    const playlistUpdate = await client.query(
      `update broadcast_playlists set status='starting',current_position=0,started_at=coalesce(started_at,now()),ended_at=null where id=$1`,
      [input.playlistId],
    );
    if (playlistUpdate.rowCount !== 1) throw new BroadcastStartError('playlist-start-update-lost');
    const event = await appendLiveEventTx(client, {
      type: 'broadcast-start-requested',
      broadcastRunId: run.id,
      overlayVersionId: overlay.version_id,
      payload: state,
      dedupeKey: `broadcast-start:${run.id}`,
    });
    return {
      run,
      operation,
      playback: canonicalPlaybackState({ state, state_revision: 1, command_sequence: 0, recovery_mode: 'fresh' }),
      event,
    };
  });
}

export async function applyRuntimeTransition(input: {
  broadcastRunId: string;
  playlistId: string;
  runnerId: string;
  leaseGeneration: number;
  expectedRevision: number;
  fromStatus?: string | null;
  status: string;
  runStatus?: string | null;
  playlistStatus?: string | null;
  itemStatus?: string | null;
  eventType: string;
  dedupeKey?: string | null;
  itemId?: string | null;
  articleId?: string | null;
  position?: number | null;
  payload?: Record<string, unknown>;
  media?: Record<string, unknown>;
  errorDetails?: Record<string, unknown> | null;
}) {
  return transaction(async (client) => {
    const lease = (
      await client.query<RunnerLeaseRecord>(
        `select * from broadcast_runner_leases where broadcast_run_id=$1 for update`,
        [input.broadcastRunId],
      )
    ).rows[0];
    if (!lease || lease.runner_id !== input.runnerId || Number(lease.lease_generation) !== input.leaseGeneration)
      throw new Error('lease-fencing-conflict');
    if ((await client.query(`select 1 where $1::timestamptz >= now()`, [lease.lease_expires_at])).rowCount !== 1)
      throw new Error('lease-expired');
    const run = (
      await client.query(`select * from broadcast_runs where id=$1 and playlist_id=$2 for update`, [
        input.broadcastRunId,
        input.playlistId,
      ])
    ).rows[0];
    if (!run) throw new Error('broadcast-run-invalid');
    const playlist = (
      await client.query(`select * from broadcast_playlists where id=$1 for update`, [input.playlistId])
    ).rows[0];
    if (!playlist) throw new Error('playlist-invalid');
    const ps = (await client.query(`select * from playback_state where id=true for update`)).rows[0];
    const currentState = (ps?.state ?? {}) as Record<string, unknown>;
    if (input.fromStatus && currentState.status !== input.fromStatus)
      throw new Error(`playback-status-conflict:${String(currentState.status)}:expected:${input.fromStatus}`);
    const currentRevision = Number(ps?.state_revision ?? 0);
    if (currentRevision !== input.expectedRevision) throw new Error(`playback-revision-conflict:${currentRevision}`);
    const nextRevision = currentRevision + 1;
    const state = {
      ...(input.payload ?? {}),
      status: input.status,
      runId: input.broadcastRunId,
      playlistId: input.playlistId,
      itemId: input.itemId,
      articleId: input.articleId,
      position: input.position,
      commandSeq: Number(ps?.command_sequence ?? 0),
      stateRevision: nextRevision,
      ...(input.media ?? {}),
    };
    const stateUpdate = await client.query(
      `update playback_state set state=$1,state_revision=$2,media_position_ms=coalesce($3,media_position_ms),media_duration_ms=coalesce($4,media_duration_ms),obs_confirmed_position_ms=coalesce($5,obs_confirmed_position_ms),obs_media_status=coalesce($6,obs_media_status),audio_path=coalesce($9,audio_path),last_obs_sync_at=case when $6::text is null then last_obs_sync_at else now() end,recovery_mode=$7,recovery_reason=$8,updated_at=now() where id=true`,
      [
        state,
        nextRevision,
        (input.media as any)?.mediaPositionMs ?? null,
        (input.media as any)?.mediaDurationMs ?? null,
        (input.media as any)?.obsConfirmedPositionMs ?? null,
        (input.media as any)?.obsMediaStatus ?? null,
        (input.media as any)?.recoveryMode ?? null,
        (input.media as any)?.recoveryReason ?? null,
        (input.media as any)?.audioPath ?? null,
      ],
    );
    if (stateUpdate.rowCount !== 1) throw new Error('playback-update-lost');
    const runUpdate = await client.query(
      `update broadcast_runs set status=coalesce($2,status),last_state=$3,ended_at=case when coalesce($2,status) in ('ended','error','interrupted') then now() else ended_at end where id=$1`,
      [input.broadcastRunId, input.runStatus ?? null, state],
    );
    if (runUpdate.rowCount !== 1) throw new Error('run-update-lost');
    const playlistUpdate = await client.query(
      `update broadcast_playlists set status=coalesce($2,status),current_position=coalesce($3,current_position),paused_at=case when coalesce($2,status)='paused' then now() else paused_at end,ended_at=case when coalesce($2,status) in ('ended','error','interrupted') then now() else ended_at end where id=$1`,
      [input.playlistId, input.playlistStatus ?? null, input.position ?? null],
    );
    if (playlistUpdate.rowCount !== 1) throw new Error('playlist-update-lost');
    if (input.itemId && input.itemStatus) {
      const itemUpdate = await client.query(
        `update broadcast_items set status=$2,error=coalesce($4,error),started_at=case when $2='playing' then coalesce(started_at,now()) else started_at end,finished_at=case when $2 in ('played','skipped','error') then coalesce(finished_at,now()) else finished_at end where id=$1 and playlist_id=$3`,
        [input.itemId, input.itemStatus, input.playlistId, input.errorDetails?.message ?? null],
      );
      if (itemUpdate.rowCount !== 1) throw new Error('item-update-lost');
    }
    if (input.articleId && input.itemStatus) {
      const articleStatus = input.itemStatus === 'preparing' || input.itemStatus === 'playing' ? 'published' : null;
      if (articleStatus) {
        const articleUpdate = await client.query(`update articles set status=$2 where id=$1 and deleted_at is null`, [
          input.articleId,
          articleStatus,
        ]);
        if (articleUpdate.rowCount !== 1) throw new Error('article-update-lost');
      }
    }
    const leaseUpdate = await client.query(
      `update broadcast_runner_leases set last_state_revision=$3 where broadcast_run_id=$1 and runner_id=$2 and lease_generation=$4`,
      [input.broadcastRunId, input.runnerId, nextRevision, input.leaseGeneration],
    );
    if (leaseUpdate.rowCount !== 1) throw new Error('lease-update-lost');
    const event = await appendLiveEventTx(client, {
      type: input.eventType,
      broadcastRunId: input.broadcastRunId,
      articleId: input.articleId,
      payload: state,
      dedupeKey: input.dedupeKey ?? `${input.broadcastRunId}:${nextRevision}:${input.status}`,
    });
    return {
      state,
      event,
      snapshot: canonicalPlaybackState({
        ...ps,
        state,
        state_revision: nextRevision,
        command_sequence: Number(ps?.command_sequence ?? 0),
        lease_generation: input.leaseGeneration,
      }),
    };
  });
}
export async function applyCommandResult(input: Parameters<typeof applyBroadcastCommandTransaction>[0]) {
  return applyBroadcastCommandTransaction(input);
}
export class BroadcastFencingError extends Error {
  readonly code = 'BROADCAST_FENCING_ERROR';
  constructor(
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export async function recordObsSnapshot(input: {
  broadcastRunId: string;
  runnerId: string;
  leaseGeneration: number;
  expectedRevision: number | null;
  phase: string;
  snapshot: Record<string, unknown>;
  itemId?: string | null;
  articleId?: string | null;
  audioPath?: string | null;
}) {
  const snap = input.snapshot ?? {};
  return transaction(async (client) => {
    const lease = (
      await client.query<RunnerLeaseRecord>(
        `select * from broadcast_runner_leases where broadcast_run_id=$1 for update`,
        [input.broadcastRunId],
      )
    ).rows[0];
    if (!lease || lease.runner_id !== input.runnerId || Number(lease.lease_generation) !== input.leaseGeneration) {
      throw new BroadcastFencingError('lease-fencing-conflict', {
        broadcastRunId: input.broadcastRunId,
        runnerId: input.runnerId,
      });
    }
    if ((await client.query(`select 1 where $1::timestamptz >= now()`, [lease.lease_expires_at])).rowCount !== 1) {
      throw new BroadcastFencingError('lease-expired', {
        broadcastRunId: input.broadcastRunId,
        runnerId: input.runnerId,
      });
    }
    const ps = (await client.query(`select * from playback_state where id=true for update`)).rows[0];
    const state = (ps?.state ?? {}) as Record<string, unknown>;
    if (state.runId !== input.broadcastRunId)
      throw new BroadcastFencingError('snapshot-run-mismatch', { stateRunId: state.runId });
    if (input.itemId && state.itemId && state.itemId !== input.itemId)
      throw new BroadcastFencingError('snapshot-item-mismatch', { stateItemId: state.itemId });
    if (input.articleId && state.articleId && state.articleId !== input.articleId)
      throw new BroadcastFencingError('snapshot-article-mismatch', { stateArticleId: state.articleId });
    const currentRevision = Number(ps?.state_revision ?? 0);
    if (input.expectedRevision != null && currentRevision !== input.expectedRevision) {
      throw new BroadcastFencingError('playback-revision-conflict', {
        currentRevision,
        expectedRevision: input.expectedRevision,
      });
    }
    if (input.itemId) {
      const item = (
        await client.query(
          `select bi.*,aa.filename audio_path from broadcast_items bi left join lateral (select * from scripts where article_id=bi.article_id order by created_at desc limit 1) sc on true left join lateral (select aa.*,ma.filename from audio_assets aa join media_assets ma on ma.id=aa.media_id where aa.script_id=sc.id order by ma.created_at desc,ma.id desc limit 1) aa on true where bi.id=$1 and bi.playlist_id=(select playlist_id from broadcast_runs where id=$2) for update of bi`,
          [input.itemId, input.broadcastRunId],
        )
      ).rows[0];
      if (!item) throw new BroadcastFencingError('snapshot-item-not-found', { itemId: input.itemId });
      const observedAudioPath = (snap as any).audioPath ?? input.audioPath ?? null;
      if (observedAudioPath && item.audio_path && observedAudioPath !== item.audio_path) {
        throw new BroadcastFencingError('snapshot-audio-path-mismatch', {
          observedAudioPath,
          expectedAudioPath: item.audio_path,
        });
      }
    }
    const nextState = {
      ...state,
      obsMediaStatus: (snap as any).status ?? state.obsMediaStatus ?? null,
      mediaPositionMs: (snap as any).mediaPositionMs ?? state.mediaPositionMs ?? null,
      mediaDurationMs: (snap as any).mediaDurationMs ?? state.mediaDurationMs ?? null,
      obsConfirmedPositionMs:
        (snap as any).obsConfirmedPositionMs ?? (snap as any).mediaPositionMs ?? state.obsConfirmedPositionMs ?? null,
      audioPath: (snap as any).audioPath ?? (state as any).audioPath ?? null,
      obsSyncPhase: input.phase,
    };
    const update = await client.query(
      `update playback_state set state=$1,media_position_ms=coalesce($2,media_position_ms),media_duration_ms=coalesce($3,media_duration_ms),obs_confirmed_position_ms=coalesce($4,obs_confirmed_position_ms),obs_media_status=coalesce($5,obs_media_status),audio_path=coalesce($6,audio_path),last_obs_sync_at=now(),updated_at=now() where id=true`,
      [
        nextState,
        (snap as any).mediaPositionMs ?? null,
        (snap as any).mediaDurationMs ?? null,
        (snap as any).obsConfirmedPositionMs ?? (snap as any).mediaPositionMs ?? null,
        (snap as any).status ?? null,
        (snap as any).audioPath ?? input.audioPath ?? null,
      ],
    );
    if (update.rowCount !== 1) throw new Error('playback-snapshot-update-lost');
    return canonicalPlaybackState({ ...ps, state: nextState, lease_generation: input.leaseGeneration });
  });
}
export async function finalizePlaybackRun(input: {
  broadcastRunId: string;
  playlistId: string;
  runnerId: string;
  leaseGeneration: number;
  expectedRevision: number;
  status: 'ended' | 'error' | 'interrupted';
  reason?: string;
}) {
  return applyRuntimeTransition({
    ...input,
    eventType: 'broadcast-stopped',
    runStatus: input.status,
    playlistStatus: input.status,
    status: input.status,
    payload: { reason: input.reason },
    media: { recoveryMode: input.status === 'interrupted' ? 'unavailable' : null },
  });
}

export async function scheduleSourceFetchJobs() {
  await query(
    `insert into worker_jobs(kind,payload,scheduled_at) select 'fetch-source',jsonb_build_object('sourceId',id),now() from sources where active=true and deleted_at is null and (last_success_at is null or last_success_at + (fetch_interval_seconds || ' seconds')::interval <= now() or (last_error is not null and last_success_at is null)) on conflict do nothing`,
  );
}
export async function claimWorkerJob(workerId: string) {
  const staleSeconds = boundedSettingNumber(process.env.WORKER_JOB_STALE_SECONDS, 30 * 60, 60, 24 * 60 * 60);
  return (
    (
      await query(
        `with job as (
          select id from worker_jobs
          where (status='queued' and scheduled_at<=now())
             or (status='running' and locked_at < now() - ($2 || ' seconds')::interval)
          order by scheduled_at,id
          for update skip locked limit 1
        )
        update worker_jobs w
        set status='running',attempts=attempts+1,started_at=now(),locked_at=now(),locked_by=$1,error=null
        from job where w.id=job.id returning w.*`,
        [workerId, staleSeconds],
      )
    ).rows[0] ?? null
  );
}
export async function completeWorkerJob(id: string) {
  await query(`update worker_jobs set status='done',finished_at=now(),locked_at=null where id=$1`, [id]);
}
export async function failWorkerJob(id: string, error: string, delaySeconds: number) {
  await query(
    `update worker_jobs set status=case when attempts>=max_attempts then 'failed' else 'queued' end,error=$2,scheduled_at=now()+($3||' seconds')::interval,finished_at=case when attempts>=max_attempts then now() else null end,locked_at=null where id=$1`,
    [id, error.slice(0, 1000), delaySeconds],
  );
}

export type BroadcastStatus =
  'draft' | 'starting' | 'running' | 'paused' | 'stopping' | 'recovering' | 'ended' | 'error' | 'interrupted';
export interface BroadcastPlaylistRecord {
  id: string;
  name: string;
  mode: string;
  kind: string;
  description: string | null;
  scheduled_at: string | null;
  overlay_project_id: string | null;
  settings: Record<string, unknown>;
  status: BroadcastStatus;
  current_position: number;
  started_at: string | null;
  paused_at: string | null;
  ended_at: string | null;
  created_at: string;
}
export interface BroadcastItemRecord {
  id: string;
  playlist_id: string;
  article_id: string | null;
  position: number;
  duration_seconds: number | null;
  status: string;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  rules: Record<string, unknown>;
  title?: string;
  audio_path?: string | null;
  audio_duration_seconds?: number | null;
}
export interface YoutubeVideoCategoryRecord {
  id: string;
  name: string;
  description: string | null;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export interface YoutubeVideoRecord {
  id: string;
  category_id: string | null;
  category_name?: string | null;
  category_color?: string | null;
  title: string;
  url: string;
  video_id: string;
  channel_title: string;
  description: string | null;
  duration_seconds: number;
  enabled: boolean;
  last_scheduled_at: string | null;
  created_at: string;
  updated_at: string;
}
export async function listYoutubeVideoCategories() {
  return (
    await query<YoutubeVideoCategoryRecord>(`select * from youtube_video_categories order by sort_order asc,name asc`)
  ).rows;
}
export async function createYoutubeVideoCategory(input: {
  name: string;
  description?: string | null;
  color?: string | null;
  sortOrder?: number | null;
}) {
  return (
    await query<YoutubeVideoCategoryRecord>(
      `insert into youtube_video_categories(name,description,color,sort_order)
       values($1,$2,coalesce($3,'#ef4444'),coalesce($4,0))
       returning *`,
      [input.name.trim(), input.description ?? null, input.color ?? null, input.sortOrder ?? null],
    )
  ).rows[0];
}
export async function updateYoutubeVideoCategory(
  id: string,
  input: Partial<{ name: string; description: string | null; color: string; sortOrder: number }>,
) {
  return (
    await query<YoutubeVideoCategoryRecord>(
      `update youtube_video_categories
       set name=coalesce($2,name),description=$3,color=coalesce($4,color),sort_order=coalesce($5,sort_order),updated_at=now()
       where id=$1 returning *`,
      [
        id,
        input.name?.trim() || null,
        input.description === undefined
          ? (
              await query<{ description: string | null }>(
                'select description from youtube_video_categories where id=$1',
                [id],
              )
            ).rows[0]?.description
          : input.description,
        input.color ?? null,
        input.sortOrder ?? null,
      ],
    )
  ).rows[0];
}
export async function deleteYoutubeVideoCategory(id: string) {
  await query(`delete from youtube_video_categories where id=$1`, [id]);
}
export async function listYoutubeVideos() {
  return (
    await query<YoutubeVideoRecord>(
      `select yv.*,yc.name category_name,yc.color category_color
       from youtube_videos yv
       left join youtube_video_categories yc on yc.id=yv.category_id
       where yv.deleted_at is null
       order by coalesce(yc.sort_order,9999),coalesce(yc.name,''),yv.created_at desc`,
    )
  ).rows;
}
export async function createYoutubeVideo(input: {
  title: string;
  url: string;
  videoId: string;
  channelTitle?: string | null;
  categoryId?: string | null;
  description?: string | null;
  durationSeconds?: number | null;
  enabled?: boolean;
}) {
  const channelTitle = input.channelTitle?.trim() || 'YouTube';
  const genericChannelTitle = channelTitle.toLowerCase() === 'youtube';
  return (
    await query<YoutubeVideoRecord>(
      `insert into youtube_videos(title,url,video_id,channel_title,category_id,description,duration_seconds,enabled)
       values($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (video_id) where deleted_at is null do update
       set title=excluded.title,
           url=excluded.url,
           channel_title=case
             when $9 then youtube_videos.channel_title
             else excluded.channel_title
           end,
           category_id=coalesce(excluded.category_id,youtube_videos.category_id),
           description=coalesce(excluded.description,youtube_videos.description),
           duration_seconds=excluded.duration_seconds,
           enabled=youtube_videos.enabled,
           updated_at=now()
       returning *`,
      [
        input.title.trim(),
        input.url,
        input.videoId,
        channelTitle,
        input.categoryId ?? null,
        input.description ?? null,
        Math.max(30, Math.min(24 * 3600, Math.floor(Number(input.durationSeconds ?? 900)))),
        input.enabled ?? true,
        genericChannelTitle,
      ],
    )
  ).rows[0];
}
export async function updateYoutubeVideo(
  id: string,
  input: Partial<{
    title: string;
    url: string;
    videoId: string;
    channelTitle: string;
    categoryId: string | null;
    description: string | null;
    durationSeconds: number;
    enabled: boolean;
  }>,
) {
  return (
    await query<YoutubeVideoRecord>(
      `update youtube_videos
       set title=coalesce($2,title),url=coalesce($3,url),video_id=coalesce($4,video_id),channel_title=coalesce($5,channel_title),category_id=$6,
           description=$7,duration_seconds=coalesce($8,duration_seconds),enabled=coalesce($9,enabled),updated_at=now()
       where id=$1 and deleted_at is null returning *`,
      [
        id,
        input.title?.trim() || null,
        input.url ?? null,
        input.videoId ?? null,
        input.channelTitle?.trim() || null,
        input.categoryId === undefined
          ? (await query<{ category_id: string | null }>('select category_id from youtube_videos where id=$1', [id]))
              .rows[0]?.category_id
          : input.categoryId,
        input.description === undefined
          ? (await query<{ description: string | null }>('select description from youtube_videos where id=$1', [id]))
              .rows[0]?.description
          : input.description,
        input.durationSeconds == null
          ? null
          : Math.max(30, Math.min(24 * 3600, Math.floor(Number(input.durationSeconds)))),
        input.enabled ?? null,
      ],
    )
  ).rows[0];
}
export async function deleteYoutubeVideo(id: string) {
  await query(`update youtube_videos set deleted_at=now(),updated_at=now() where id=$1`, [id]);
}
export async function createBroadcastPlaylist(
  name = 'Sendeliste',
  options: {
    description?: string | null;
    scheduledAt?: string | null;
    kind?: string;
    overlayProjectId?: string | null;
    settings?: Record<string, unknown>;
  } = {},
) {
  return (
    await query<BroadcastPlaylistRecord>(
      `insert into broadcast_playlists(name,description,scheduled_at,kind,overlay_project_id,settings,status,current_position)
       values($1,$2,$3,$4,$5,$6,'draft',0) returning *`,
      [
        name,
        options.description ?? null,
        options.scheduledAt ?? null,
        options.kind ?? 'playlist',
        options.overlayProjectId ?? null,
        options.settings ?? {},
      ],
    )
  ).rows[0];
}
export async function createBroadcastPlaylistWithArticles(
  name: string,
  requestedArticleIds: string[],
  options: {
    description?: string | null;
    scheduledAt?: string | null;
    kind?: string;
    overlayProjectId?: string | null;
    settings?: Record<string, unknown>;
  } = {},
) {
  const articleIds = [...new Set(requestedArticleIds)];
  if (!articleIds.length) {
    throw Object.assign(new Error('Die Sendeliste benötigt mindestens einen Beitrag.'), { statusCode: 400 });
  }
  return transaction(async (client) => {
    const candidates = (
      await client.query<{ id: string; status: string; media_ready: boolean }>(
        `select a.id,a.status,exists(
           select 1 from media_links ml
           join media_assets ma on ma.id=ml.media_id
           where ml.article_id=a.id
             and ma.storage_path is not null
             and (
               (ml.purpose='article-video' and ma.mime_type like 'video/%')
               or (ml.purpose='article-graphic' and ma.mime_type like 'image/%')
             )
         ) media_ready
         from articles a
         where a.id=any($1::uuid[]) and a.deleted_at is null
         for update of a`,
        [articleIds],
      )
    ).rows;
    const candidateById = new Map(candidates.map((article) => [article.id, article]));
    const unavailable = articleIds.filter((id) => {
      const article = candidateById.get(id);
      return !article || !['approved', 'published'].includes(article.status);
    });
    if (unavailable.length) {
      throw Object.assign(new Error('Mindestens ein ausgewählter Beitrag ist nicht mehr freigegeben.'), {
        statusCode: 409,
      });
    }
    const requireVisual = (
      await client.query<{ required: boolean }>(
        `select coalesce(
           (select (value->>'requireVideo')::boolean from system_settings where key='autopilot.config'),
           true
         ) required`,
      )
    ).rows[0]?.required;
    const missingVisuals = requireVisual ? candidates.filter((article) => !article.media_ready) : [];
    if (missingVisuals.length) {
      throw Object.assign(
        new Error(`Kein freigegebenes lokales Video oder Bild/Grafik für Beitrag ${missingVisuals[0]!.id} vorhanden`),
        { statusCode: 409 },
      );
    }
    const playlist = (
      await client.query<BroadcastPlaylistRecord>(
        `insert into broadcast_playlists(name,description,scheduled_at,kind,overlay_project_id,settings,status,current_position)
         values($1,$2,$3,$4,$5,$6,'draft',0) returning *`,
        [
          name,
          options.description ?? null,
          options.scheduledAt ?? null,
          options.kind ?? 'show',
          options.overlayProjectId ?? null,
          options.settings ?? {},
        ],
      )
    ).rows[0];
    const items: BroadcastItemRecord[] = [];
    for (const [position, articleId] of articleIds.entries()) {
      const item = (
        await client.query<BroadcastItemRecord>(
          `insert into broadcast_items(playlist_id,article_id,position,status) values($1,$2,$3,'planned') returning *`,
          [playlist.id, articleId, position],
        )
      ).rows[0];
      items.push(item);
    }
    return { playlist, items };
  });
}
export async function listBroadcastPlaylists() {
  return (await query<BroadcastPlaylistRecord>(`select * from broadcast_playlists order by created_at desc`)).rows;
}
export async function getBroadcastPlaylist(id: string) {
  return (await query<BroadcastPlaylistRecord>(`select * from broadcast_playlists where id=$1`, [id])).rows[0] ?? null;
}
export async function updateBroadcastPlaylist(
  id: string,
  input: Partial<{
    name: string;
    description: string | null;
    scheduledAt: string | null;
    kind: string;
    overlayProjectId: string | null;
    settings: Record<string, unknown>;
  }>,
) {
  const current = await getBroadcastPlaylist(id);
  if (!current) throw Object.assign(new Error('Sendung nicht gefunden.'), { statusCode: 404 });
  if (!['draft', 'error', 'ended', 'interrupted'].includes(current.status)) {
    throw Object.assign(new Error('Laufende Sendungen können nicht direkt bearbeitet werden.'), { statusCode: 409 });
  }
  const nextSettings = { ...(current.settings ?? {}), ...(input.settings ?? {}) };
  return (
    await query<BroadcastPlaylistRecord>(
      `update broadcast_playlists
       set name=coalesce($2,name),description=$3,scheduled_at=$4,kind=coalesce($5,kind),overlay_project_id=$6,settings=$7
       where id=$1 returning *`,
      [
        id,
        input.name?.trim() || current.name,
        input.description ?? current.description,
        input.scheduledAt === undefined ? current.scheduled_at : input.scheduledAt,
        input.kind ?? current.kind,
        input.overlayProjectId === undefined ? current.overlay_project_id : input.overlayProjectId,
        nextSettings,
      ],
    )
  ).rows[0];
}
export async function deleteBroadcastPlaylist(id: string) {
  await transaction(async (client) => {
    const playlist = (
      await client.query<BroadcastPlaylistRecord>(`select * from broadcast_playlists where id=$1 for update`, [id])
    ).rows[0];
    if (!playlist) throw Object.assign(new Error('Sendung nicht gefunden.'), { statusCode: 404 });
    if (['starting', 'running', 'paused', 'stopping', 'recovering'].includes(playlist.status)) {
      throw Object.assign(new Error('Laufende Sendungen können nicht gelöscht werden.'), { statusCode: 409 });
    }
    await client.query(`delete from broadcast_items where playlist_id=$1`, [id]);
    await client.query(`delete from broadcast_playlists where id=$1`, [id]);
  });
}
export async function listBroadcastItems(playlistId: string) {
  return (
    await query<BroadcastItemRecord>(
      `select bi.*,
              coalesce(a.title,bi.rules->>'title','YouTube-Video') title,
              aa.filename audio_path,
              aa.duration_seconds audio_duration_seconds
       from broadcast_items bi
       left join articles a on a.id=bi.article_id
       left join lateral (select * from scripts where article_id=a.id order by created_at desc limit 1) sc on true
       left join lateral (
         select aa.*,ma.filename
         from audio_assets aa
         join media_assets ma on ma.id=aa.media_id
         where aa.script_id=sc.id
         order by ma.created_at desc,ma.id desc
         limit 1
       ) aa on true
       where bi.playlist_id=$1
       order by bi.position asc`,
      [playlistId],
    )
  ).rows;
}
export async function listBroadcastCandidateArticles(limit = 80) {
  return (
    await query<ArticleDetailRecord>(
      `select a.*,s.name source_name,
              null::text summary,null::jsonb editorial_notes,null::text summary_model,
              null::text summary_model_version,null::text prompt_version,
              sc.text script_text,sc.screen_text,sc.ticker_text,
              aa.filename audio_path,aa.duration_seconds audio_duration_seconds
       from articles a
       left join sources s on s.id=a.source_id
       left join lateral (select * from scripts where article_id=a.id order by created_at desc limit 1) sc on true
       left join lateral (select aa.*,ma.filename from audio_assets aa join media_assets ma on ma.id=aa.media_id where aa.script_id=sc.id order by ma.created_at desc,ma.id desc limit 1) aa on true
       where a.deleted_at is null and a.status in ('approved','published')
       order by case when a.status='approved' then 0 else 1 end, coalesce(a.published_at,a.fetched_at) desc
       limit $1`,
      [Math.max(1, Math.min(500, Math.floor(limit)))],
    )
  ).rows;
}
export async function addBroadcastItem(playlistId: string, articleId: string) {
  return transaction(async (client) => {
    const playlist = (
      await client.query<{ id: string }>('select id from broadcast_playlists where id=$1 for update', [playlistId])
    ).rows[0];
    if (!playlist) return undefined;
    const article = (
      await client.query<{ id: string; status: string; media_ready: boolean; require_visual: boolean }>(
        `select a.id,a.status,exists(
           select 1 from media_links ml
           join media_assets ma on ma.id=ml.media_id
           where ml.article_id=a.id
             and ma.storage_path is not null
             and (
               (ml.purpose='article-video' and ma.mime_type like 'video/%')
               or (ml.purpose='article-graphic' and ma.mime_type like 'image/%')
             )
         ) media_ready,
         coalesce(
           (select (value->>'requireVideo')::boolean from system_settings where key='autopilot.config'),
           true
         ) require_visual
         from articles a
         where a.id=$1 and a.deleted_at is null
         for update of a`,
        [articleId],
      )
    ).rows[0];
    if (!article || !['approved', 'published'].includes(article.status)) return undefined;
    if (article.require_visual && !article.media_ready) {
      throw Object.assign(
        new Error(`Kein freigegebenes lokales Video oder Bild/Grafik für Beitrag ${article.id} vorhanden`),
        { statusCode: 409 },
      );
    }
    const pos = (
      await client.query<{ next: number }>(
        `select coalesce(max(position)+1,0) next from broadcast_items where playlist_id=$1`,
        [playlistId],
      )
    ).rows[0].next;
    return (
      await client.query<BroadcastItemRecord>(
        `insert into broadcast_items(playlist_id,article_id,position,status) select $1,id,$3,'planned' from articles where id=$2 and status in ('approved','published') returning *`,
        [playlistId, articleId, pos],
      )
    ).rows[0];
  });
}
export async function addBroadcastYoutubeItem(
  playlistId: string,
  video: {
    id?: string;
    title: string;
    url: string;
    videoId: string;
    channelTitle?: string | null;
    categoryId?: string | null;
    categoryName?: string | null;
    durationSeconds: number;
    sidebarRotationSeconds?: number | null;
  },
) {
  return transaction(async (client) => {
    const playlist = (
      await client.query<{ id: string }>('select id from broadcast_playlists where id=$1 for update', [playlistId])
    ).rows[0];
    if (!playlist) return undefined;
    const pos = (
      await client.query<{ next: number }>(
        `select coalesce(max(position)+1,0) next from broadcast_items where playlist_id=$1`,
        [playlistId],
      )
    ).rows[0].next;
    const durationSeconds = Math.max(30, Math.min(24 * 3600, Math.floor(Number(video.durationSeconds))));
    return (
      await client.query<BroadcastItemRecord>(
        `insert into broadcast_items(playlist_id,article_id,position,duration_seconds,status,rules)
         values($1,null,$2,$3,'planned',$4) returning *`,
        [
          playlistId,
          pos,
          durationSeconds,
          {
            kind: 'youtube-video',
            youtubeLibraryId: video.id ?? null,
            youtubeVideoId: video.videoId,
            url: video.url,
            title: video.title,
            channelTitle: video.channelTitle ?? 'YouTube',
            categoryId: video.categoryId ?? null,
            categoryName: video.categoryName ?? null,
            durationSeconds,
          },
        ],
      )
    ).rows[0];
  });
}
export type BroadcastSidebarNewsItem = {
  articleId: string;
  title: string;
  text: string;
  source: string;
};
export async function addBroadcastYoutubeNewsSidebarItem(
  playlistId: string,
  video: {
    id?: string;
    title: string;
    url: string;
    videoId: string;
    channelTitle?: string | null;
    categoryId?: string | null;
    categoryName?: string | null;
    durationSeconds: number;
    sidebarRotationSeconds?: number | null;
  },
  news: BroadcastSidebarNewsItem[],
) {
  return transaction(async (client) => {
    const playlist = (
      await client.query<{ id: string }>('select id from broadcast_playlists where id=$1 for update', [playlistId])
    ).rows[0];
    if (!playlist) return undefined;
    const pos = (
      await client.query<{ next: number }>(
        `select coalesce(max(position)+1,0) next from broadcast_items where playlist_id=$1`,
        [playlistId],
      )
    ).rows[0].next;
    const durationSeconds = Math.max(30, Math.min(24 * 3600, Math.floor(Number(video.durationSeconds))));
    return (
      await client.query<BroadcastItemRecord>(
        `insert into broadcast_items(playlist_id,article_id,position,duration_seconds,status,rules)
         values($1,null,$2,$3,'planned',$4) returning *`,
        [
          playlistId,
          pos,
          durationSeconds,
          {
            kind: 'youtube-news-sidebar',
            youtubeLibraryId: video.id ?? null,
            youtubeVideoId: video.videoId,
            url: video.url,
            title: video.title,
            channelTitle: video.channelTitle ?? 'YouTube',
            categoryId: video.categoryId ?? null,
            categoryName: video.categoryName ?? null,
            durationSeconds,
            sidebarRotationSeconds: Math.max(3, Math.min(120, Math.floor(Number(video.sidebarRotationSeconds ?? 12)))),
            news: news.slice(0, 20).map((item) => ({
              articleId: item.articleId,
              title: item.title.slice(0, 180),
              text: item.text.slice(0, 2200),
              source: item.source.slice(0, 120),
            })),
          },
        ],
      )
    ).rows[0];
  });
}
export async function removeBroadcastItem(playlistId: string, itemId: string) {
  await transaction(async (client) => {
    await client.query('select id from broadcast_playlists where id=$1 for update', [playlistId]);
    await client.query(`delete from broadcast_items where playlist_id=$1 and id=$2`, [playlistId, itemId]);
    const ids = (
      await client.query<{ id: string }>(`select id from broadcast_items where playlist_id=$1 order by position`, [
        playlistId,
      ])
    ).rows.map((r) => r.id);
    for (const [idx, id] of ids.entries())
      await client.query(`update broadcast_items set position=$3 where playlist_id=$1 and id=$2`, [
        playlistId,
        id,
        idx,
      ]);
  });
}
export async function reorderBroadcastItems(playlistId: string, itemIds: string[]) {
  await transaction(async (client) => {
    await client.query('select id from broadcast_playlists where id=$1 for update', [playlistId]);
    const existingIds = (
      await client.query<{ id: string }>('select id from broadcast_items where playlist_id=$1', [playlistId])
    ).rows.map((row) => row.id);
    if (
      new Set(itemIds).size !== itemIds.length ||
      existingIds.length !== itemIds.length ||
      existingIds.some((id) => !itemIds.includes(id))
    ) {
      throw Object.assign(new Error('Die neue Reihenfolge muss jeden Beitrag genau einmal enthalten.'), {
        statusCode: 400,
      });
    }
    for (const [idx, id] of itemIds.entries())
      await client.query(`update broadcast_items set position=$3 where playlist_id=$1 and id=$2`, [
        playlistId,
        id,
        idx,
      ]);
  });
}
export async function tryStartBroadcastRun(playlistId: string) {
  return transaction(async (client) => {
    const active = (
      await client.query(
        `select id from broadcast_runs where status in ('starting','running','paused','stopping','recovering') for update`,
      )
    ).rows[0];
    if (active) return null;
    return (
      (
        await client.query(
          `insert into broadcast_runs(playlist_id,started_at,status,last_state) values($1,now(),'running',$2) returning *`,
          [playlistId, { playlistId, status: 'running' }],
        )
      ).rows[0] ?? null
    );
  });
}
export async function getBroadcastRun(id: string) {
  return (await query(`select * from broadcast_runs where id=$1`, [id])).rows[0] ?? null;
}
export async function activeBroadcastRun() {
  return (
    (
      await query(
        `select * from broadcast_runs where status in ('starting','running','paused','stopping','recovering') order by started_at desc limit 1`,
      )
    ).rows[0] ?? null
  );
}
export async function updateBroadcastRun(id: string, status: string, lastState: unknown) {
  await query(
    `update broadcast_runs set status=$2,last_state=$3,ended_at=case when $2 in ('ended','error','interrupted') then now() else ended_at end where id=$1`,
    [id, status, lastState],
  );
}
export async function setBroadcastPlaylistState(id: string, status: BroadcastStatus, currentPosition?: number) {
  return (
    await query<BroadcastPlaylistRecord>(
      `update broadcast_playlists set status=$2,current_position=coalesce($3,current_position),started_at=case when $2='running' and started_at is null then now() else started_at end,paused_at=case when $2='paused' then now() else paused_at end,ended_at=case when $2 in ('ended','error','interrupted') then now() else ended_at end where id=$1 returning *`,
      [id, status, currentPosition ?? null],
    )
  ).rows[0];
}
export async function markBroadcastItem(id: string, status: string, error?: string) {
  await query(
    `update broadcast_items set status=$2,error=$3,started_at=case when $2='playing' then now() else started_at end,finished_at=case when $2 in ('played','skipped','error') then now() else finished_at end where id=$1`,
    [id, status, error ?? null],
  );
}

export async function recoverActiveBroadcastRuns(mode: 'resume' | 'interrupt' = 'interrupt') {
  const run = await activeBroadcastRun();
  if (!run) return null;
  const writeRecoveryPlaybackState = async (state: Record<string, unknown>, recoveryMode: string | null = null) => {
    await query(
      `insert into playback_state(id,state,state_revision,command_sequence,recovery_mode,recovery_reason,updated_at)
       values(true,$1,1,0,$2,$3,now())
       on conflict(id) do update
       set state=excluded.state,
           state_revision=playback_state.state_revision+1,
           command_sequence=0,
           recovery_mode=excluded.recovery_mode,
           recovery_reason=excluded.recovery_reason,
           updated_at=now()`,
      [state, recoveryMode, typeof state.reason === 'string' ? state.reason : null],
    );
  };
  if (mode === 'resume') {
    const state = run.last_state ?? {};
    const position = typeof state.position === 'number' ? state.position : 0;
    await query(
      `update broadcast_items set status='planned' where playlist_id=$1 and position>=$2 and status in ('playing','planned')`,
      [run.playlist_id, position],
    );
    await setBroadcastPlaylistState(run.playlist_id, 'running', position);
    await writeRecoveryPlaybackState(
      { ...state, status: 'recovering', runId: run.id, playlistId: run.playlist_id, position },
      'resume',
    );
    return run;
  }
  await updateBroadcastRun(run.id, 'interrupted', {
    status: 'interrupted',
    reason: 'API-Neustart ohne aktiven Prozess',
  });
  await setBroadcastPlaylistState(run.playlist_id, 'error');
  await writeRecoveryPlaybackState(
    { status: 'interrupted', runId: run.id, playlistId: run.playlist_id, reason: 'API-Neustart ohne aktiven Prozess' },
    'unavailable',
  );
  return null;
}
export async function interruptStaleBroadcastRuns(maxAgeSeconds = 300) {
  await query(
    `update broadcast_runs set status='interrupted',ended_at=now(),last_state=jsonb_set(coalesce(last_state,'{}'::jsonb),'{reason}',to_jsonb('Stale active run interrupted'::text),true) where status in ('starting','running','paused','stopping','recovering') and started_at < now()-($1||' seconds')::interval`,
    [maxAgeSeconds],
  );
}

export interface OverlayProjectRecord {
  id: string;
  name: string;
  width: number;
  height: number;
  template: string;
  status: string;
  created_by: string | null;
  version: number;
  created_at: string;
  updated_at?: string;
  draft_version?: number | null;
  published_version?: number | null;
}
export async function listOverlayProjects() {
  return (
    await query<OverlayProjectRecord>(
      `select p.*,
         draft.version draft_version,
         published.version published_version,
         greatest(p.created_at,coalesce(latest.created_at,p.created_at)) updated_at
       from overlay_projects p
       left join lateral (
         select version from overlay_versions where project_id=p.id and status='draft' order by version desc limit 1
       ) draft on true
       left join lateral (
         select version from overlay_versions where project_id=p.id and status='published' order by version desc limit 1
       ) published on true
       left join lateral (
         select created_at from overlay_versions where project_id=p.id order by version desc,created_at desc limit 1
       ) latest on true
       where p.deleted_at is null
       order by greatest(p.created_at,coalesce(latest.created_at,p.created_at)) desc`,
    )
  ).rows;
}
export async function createOverlayProject(input: {
  name: string;
  width: number;
  height: number;
  template: string;
  snapshot: unknown;
  userId?: string;
}) {
  return transaction(async (c) => {
    const p = (
      await c.query<OverlayProjectRecord>(
        `insert into overlay_projects(name,width,height,template,created_by) values($1,$2,$3,$4,$5) returning *`,
        [input.name, input.width, input.height, input.template, input.userId ?? null],
      )
    ).rows[0];
    await c.query(
      `insert into overlay_versions(project_id,version,snapshot,status,created_by,label) values($1,1,$2,'draft',$3,'Entwurf 1')`,
      [p.id, input.snapshot, input.userId ?? null],
    );
    return p;
  });
}
export async function updateOverlayDraft(id: string, snapshot: unknown, userId?: string) {
  return transaction(async (c) => {
    const p = (
      await c.query<OverlayProjectRecord>(
        `update overlay_projects set version=version+1 where id=$1 and deleted_at is null returning *`,
        [id],
      )
    ).rows[0];
    if (!p) throw new Error('Overlay-Projekt nicht gefunden');
    await c.query(
      `insert into overlay_versions(project_id,version,snapshot,status,created_by,label) values($1,$2,$3,'draft',$4,$5)`,
      [id, p.version, snapshot, userId ?? null, `Entwurf ${p.version}`],
    );
    return p;
  });
}
export async function getOverlayProject(id: string) {
  return (
    (await query<OverlayProjectRecord>(`select * from overlay_projects where id=$1 and deleted_at is null`, [id]))
      .rows[0] ?? null
  );
}
export async function updateOverlayProject(id: string, input: { name: string }) {
  return (
    (
      await query<OverlayProjectRecord>(
        `update overlay_projects set name=$2 where id=$1 and deleted_at is null returning *`,
        [id, input.name],
      )
    ).rows[0] ?? null
  );
}
export async function overlayVersions(projectId: string) {
  return (
    await query(`select * from overlay_versions where project_id=$1 order by version desc,created_at desc`, [projectId])
  ).rows;
}
export async function latestOverlayDraft(projectId: string) {
  return (
    (
      await query(
        `select * from overlay_versions where project_id=$1 and status='draft' order by version desc limit 1`,
        [projectId],
      )
    ).rows[0] ?? null
  );
}
export async function latestOverlayVersion(projectId: string) {
  return (
    (
      await query(`select * from overlay_versions where project_id=$1 order by version desc,created_at desc limit 1`, [
        projectId,
      ])
    ).rows[0] ?? null
  );
}
export async function ensureEditableOverlayDraft(projectId: string, userId?: string) {
  const draft = await latestOverlayDraft(projectId);
  if (draft) return draft;
  const latest = await latestOverlayVersion(projectId);
  if (!latest) return null;
  await updateOverlayDraft(projectId, latest.snapshot, userId);
  return latestOverlayDraft(projectId);
}
export async function publishOverlayVersion(projectId: string, versionId: string, userId?: string) {
  return transaction(async (c) => {
    await c.query(
      `update overlay_versions set status='archived',published=false where project_id=$1 and status='published'`,
      [projectId],
    );
    const v = (
      await c.query(
        `update overlay_versions set status='published',published=true,created_by=coalesce(created_by,$3) where project_id=$1 and id=$2 returning *`,
        [projectId, versionId, userId ?? null],
      )
    ).rows[0];
    if (!v) throw new Error('Version nicht gefunden');
    return v;
  });
}
export async function rollbackOverlay(projectId: string, versionId: string, userId?: string) {
  const v = (await query(`select * from overlay_versions where project_id=$1 and id=$2`, [projectId, versionId]))
    .rows[0];
  if (!v) throw new Error('Version nicht gefunden');
  return updateOverlayDraft(projectId, v.snapshot, userId);
}
export async function duplicateOverlayProject(projectId: string, userId?: string, name?: string) {
  const p = await getOverlayProject(projectId);
  const v =
    (await latestOverlayDraft(projectId)) ??
    (await query(`select * from overlay_versions where project_id=$1 order by version desc limit 1`, [projectId]))
      .rows[0];
  if (!p || !v) throw new Error('Overlay-Projekt nicht gefunden');
  return createOverlayProject({
    name: name?.trim() || `${p.name} Kopie`,
    width: p.width,
    height: p.height,
    template: p.template,
    snapshot: v.snapshot,
    userId,
  });
}
export async function deleteOverlayProject(id: string) {
  await query(`update overlay_projects set deleted_at=now(),status='archived' where id=$1`, [id]);
}
export async function getPublishedOverlay(template = 'main-news') {
  return (
    (
      await query(
        `select p.*,v.snapshot,v.id version_id from overlay_projects p join overlay_versions v on v.project_id=p.id where p.deleted_at is null and p.template=$1 and v.status='published' order by v.created_at desc limit 1`,
        [template],
      )
    ).rows[0] ?? null
  );
}
export async function getConfiguredOverlay(template = 'main-news') {
  return (
    (
      await query(
        `select p.*,v.snapshot,v.id version_id,v.version published_version
         from overlay_projects p
         join overlay_versions v on v.id=p.obs_configured_version_id
         where p.deleted_at is null
           and p.template=$1
           and p.obs_configured_url is not null
         order by p.obs_configured_at desc nulls last
         limit 1`,
        [template],
      )
    ).rows[0] ?? null
  );
}

export async function createMediaAsset(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  sha256: string;
  author?: string;
  source?: string;
  licenseName?: string;
  attribution?: string;
  metadata?: unknown;
}) {
  return (
    await query(
      `insert into media_assets(filename,mime_type,size_bytes,storage_path,sha256,author,source,license_name,attribution,metadata,usage) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'overlay-media') returning *`,
      [
        input.filename,
        input.mimeType,
        input.sizeBytes,
        input.storagePath,
        input.sha256,
        input.author ?? null,
        input.source ?? null,
        input.licenseName ?? null,
        input.attribution ?? null,
        input.metadata ?? {},
      ],
    )
  ).rows[0];
}
export async function listMediaAssets(search = '') {
  return (
    await query(
      `select m.*,not exists(select 1 from media_links l where l.media_id=m.id) as unused from media_assets m where m.usage='overlay-media' and ($1='' or filename ilike '%'||$1||'%' or coalesce(author,'') ilike '%'||$1||'%') order by created_at desc`,
      [search],
    )
  ).rows;
}
export async function getMediaAsset(id: string) {
  return (await query(`select * from media_assets where id=$1`, [id])).rows[0] ?? null;
}
export async function linkMedia(
  mediaId: string,
  articleId?: string,
  overlayProjectId?: string,
  purpose = 'attachment',
) {
  return (
    await query(
      `insert into media_links(media_id,article_id,overlay_project_id,purpose) values($1,$2,$3,$4) returning *`,
      [mediaId, articleId ?? null, overlayProjectId ?? null, purpose],
    )
  ).rows[0];
}

export async function setOverlayPublicToken(projectId: string, tokenHash: string) {
  await query(
    `update overlay_projects set public_token_hash=$2, public_token_created_at=now() where id=$1 and deleted_at is null`,
    [projectId, tokenHash],
  );
}

export async function findPublishedOverlayByTokenHash(tokenHash: string, template?: string) {
  return (
    (
      await query(
        `select p.*, v.snapshot, v.id version_id, v.version published_version
       from overlay_projects p
       join overlay_versions v on v.project_id=p.id
       where p.deleted_at is null
         and p.public_token_hash=$1
         and v.status='published'
         and ($2::text is null or p.template=$2)
       order by v.created_at desc
       limit 1`,
        [tokenHash, template ?? null],
      )
    ).rows[0] ?? null
  );
}

export async function createMediaAssetWithDerivatives(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  sha256: string;
  author?: string;
  source?: string;
  licenseName?: string;
  attribution?: string;
  metadata?: unknown;
  derivativePaths?: unknown;
}) {
  return (
    await query(
      `insert into media_assets(
         filename,mime_type,size_bytes,storage_path,sha256,author,source,license_name,attribution,metadata,derivative_paths,usage
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'overlay-media')
       on conflict (sha256) where usage='overlay-media'
       do update set filename=excluded.filename
       returning *`,
      [
        input.filename,
        input.mimeType,
        input.sizeBytes,
        input.storagePath,
        input.sha256,
        input.author ?? null,
        input.source ?? null,
        input.licenseName ?? null,
        input.attribution ?? null,
        input.metadata ?? {},
        input.derivativePaths ?? {},
      ],
    )
  ).rows[0];
}

export async function listMediaUsage(mediaId: string) {
  return (
    await query(
      `select l.*, a.title article_title, p.name overlay_name
       from media_links l
       left join articles a on a.id=l.article_id
       left join overlay_projects p on p.id=l.overlay_project_id
       where l.media_id=$1
       order by l.created_at desc`,
      [mediaId],
    )
  ).rows;
}

export type LiveEventType =
  | 'article-prepared'
  | 'item-started'
  | 'item-paused'
  | 'item-resumed'
  | 'item-ended'
  | 'item-skipped'
  | 'broadcast-stopped'
  | 'broadcast-control'
  | 'overlay-published'
  | 'overlay-version-changed'
  | 'media-derivative-updated'
  | 'obs-disconnected'
  | 'obs-restored'
  | 'scene-changed';

export async function appendLiveEvent(input: {
  type: LiveEventType | string;
  broadcastRunId?: string | null;
  articleId?: string | null;
  overlayVersionId?: string | null;
  payload?: unknown;
  dedupeKey?: string | null;
}) {
  return transaction((client) => appendLiveEventTx(client, input));
}

export async function listLiveEventsAfter(lastId = 0, limit = 200) {
  return (
    await query(`select * from live_events where id>$1 order by id asc limit $2`, [
      lastId,
      Math.min(Math.max(limit, 1), 1000),
    ])
  ).rows;
}

export async function pruneLiveEvents(maxAgeHours = 48) {
  await query(`delete from live_events where created_at < now()-($1||' hours')::interval`, [maxAgeHours]);
}

export async function ensureOverlayPublicIdentity(
  projectId: string,
  tokenHashValue: string,
  publicUrl: string,
  liveId: string,
) {
  return (
    await query(
      `update overlay_projects
       set public_live_id=coalesce(public_live_id,$4),
           public_token_hash=coalesce(public_token_hash,$2),
           public_token_created_at=coalesce(public_token_created_at,now()),
           public_url=coalesce(public_url,$3)
       where id=$1 and deleted_at is null
       returning *`,
      [projectId, tokenHashValue, publicUrl, liveId],
    )
  ).rows[0];
}

export async function rotateOverlayPublicToken(projectId: string, tokenHashValue: string, publicUrl: string) {
  return (
    await query(
      `update overlay_projects set public_token_hash=$2,public_token_created_at=now(),public_url=$3 where id=$1 and deleted_at is null returning *`,
      [projectId, tokenHashValue, publicUrl],
    )
  ).rows[0];
}

export async function rememberObsOverlaySource(input: {
  projectId: string;
  sceneName: string;
  inputName: string;
  url: string;
  versionId: string;
  width: number;
  height: number;
  status?: string;
  lastError?: string | null;
}) {
  return transaction(async (client) => {
    await client.query(
      `update overlay_projects
       set obs_scene_name=null,
           obs_input_name=null,
           obs_configured_url=null,
           obs_configured_version_id=null,
           obs_width=null,
           obs_height=null,
           obs_configured_at=null
       where id<>$1 and obs_scene_name=$2 and obs_input_name=$3`,
      [input.projectId, input.sceneName, input.inputName],
    );
    await client.query(`delete from obs_overlay_sources where project_id<>$1 and scene_name=$2 and input_name=$3`, [
      input.projectId,
      input.sceneName,
      input.inputName,
    ]);
    await client.query(
      `insert into obs_overlay_sources(project_id,scene_name,input_name,url,version_id,width,height,status,last_error)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict(project_id) do update set scene_name=excluded.scene_name,input_name=excluded.input_name,url=excluded.url,
         version_id=excluded.version_id,width=excluded.width,height=excluded.height,configured_at=now(),status=excluded.status,last_error=excluded.last_error`,
      [
        input.projectId,
        input.sceneName,
        input.inputName,
        input.url,
        input.versionId,
        input.width,
        input.height,
        input.status ?? 'configured',
        input.lastError ?? null,
      ],
    );
    return (
      await client.query(
        `update overlay_projects set obs_scene_name=$2,obs_input_name=$3,obs_configured_url=$4,obs_configured_version_id=$5,obs_width=$6,obs_height=$7,obs_configured_at=now() where id=$1 returning *`,
        [input.projectId, input.sceneName, input.inputName, input.url, input.versionId, input.width, input.height],
      )
    ).rows[0];
  });
}

export async function publishedMainOverlayUrl() {
  return (
    await query(
      `select public_url
       from (
         select p.public_url,0 prio,p.obs_configured_at sort_at
         from overlay_projects p
         join overlay_versions v on v.id=p.obs_configured_version_id
         where p.template='main-news' and p.deleted_at is null and p.obs_configured_url is not null and p.public_url is not null
         union all
         select p.public_url,1 prio,v.created_at sort_at
         from overlay_projects p
         join overlay_versions v on v.project_id=p.id
         where p.template='main-news' and p.deleted_at is null and v.status='published' and p.public_url is not null
       ) candidates
       order by prio asc, sort_at desc nulls last
       limit 1`,
    )
  ).rows[0]?.public_url as string | undefined;
}

export async function isPublicMediaInPublishedOverlay(mediaId: string) {
  const r = await query<{ ok: boolean }>(
    `select exists(
      select 1 from overlay_versions v
      join overlay_projects p on p.id=v.project_id
      where v.status='published' and p.deleted_at is null and v.snapshot::text like '%'||$1||'%'
    ) ok`,
    [mediaId],
  );
  return Boolean(r.rows[0]?.ok);
}

export type LiveStudioLayout = 'fullscreen' | 'split' | 'grid' | 'pip' | 'reaction';
export type LiveStudioTransition = 'cut' | 'fade' | 'swipe' | 'slide' | 'luma_wipe';
export type LiveStudioSourceTransition = 'cut' | 'fade' | 'slide' | 'zoom' | 'wipe';
export type LiveStudioSourceLabelStyle = 'lower-third' | 'badge' | 'minimal';

export interface LiveStudioSettingsRecord extends QueryResultRow {
  enabled: boolean;
  layout: LiveStudioLayout;
  transition: LiveStudioTransition;
  transition_duration_ms: number;
  program_source_id: string | null;
  preview_source_id: string | null;
  overlay_project_id: string | null;
  chat_url: string | null;
  chat_visible: boolean;
  overlay_visible: boolean;
  source_transition: LiveStudioSourceTransition;
  source_transition_duration_ms: number;
  source_auto_layout: boolean;
  source_overlay_enabled: boolean;
  source_label_style: LiveStudioSourceLabelStyle;
  stinger_settings: Record<string, unknown>;
  reaction_enabled: boolean;
  reaction_previous_layout: Exclude<LiveStudioLayout, 'reaction'>;
  reaction_previous_auto_layout: boolean;
  reaction_youtube_source_id: string | null;
  reaction_camera_source_ids: string[];
  reaction_position: 'left' | 'right' | 'top' | 'bottom';
  reaction_size_percent: number;
  reaction_gap: number;
  reaction_style: 'neon' | 'news' | 'glass' | 'clean';
  reaction_animation: 'fade' | 'slide' | 'pop' | 'pulse';
  reaction_title: string;
  reaction_accent_color: string;
  updated_at: string;
}

export interface LiveStudioSourceRecord extends QueryResultRow {
  source_id: string;
  input_name: string;
  display_name: string;
  user_name: string | null;
  viewer_url: string | null;
  muted: boolean;
  hidden: boolean;
  slot_index: number;
  in_program: boolean;
  last_portal_state: Record<string, unknown>;
  added_at: string;
  updated_at: string;
}

export async function getLiveStudioSettings() {
  return (
    await query<LiveStudioSettingsRecord>(
      `insert into live_studio_settings(id)
       values(true)
       on conflict(id) do update set id=excluded.id
       returning enabled,layout,transition,transition_duration_ms,program_source_id,preview_source_id,overlay_project_id,chat_url,chat_visible,
                 overlay_visible,source_transition,source_transition_duration_ms,source_auto_layout,source_overlay_enabled,source_label_style,
                 stinger_settings,reaction_enabled,reaction_previous_layout,reaction_previous_auto_layout,reaction_youtube_source_id,
                 case when jsonb_typeof(reaction_camera_source_ids)='array' then reaction_camera_source_ids else '[]'::jsonb end reaction_camera_source_ids,
                 reaction_position,reaction_size_percent,reaction_gap,reaction_style,reaction_animation,reaction_title,reaction_accent_color,
                 updated_at`,
    )
  ).rows[0];
}

export async function updateLiveStudioSettings(input: {
  enabled?: boolean;
  layout?: LiveStudioLayout;
  transition?: LiveStudioTransition;
  transitionDurationMs?: number;
  programSourceId?: string | null;
  previewSourceId?: string | null;
  overlayProjectId?: string | null;
  chatUrl?: string | null;
  chatVisible?: boolean;
  overlayVisible?: boolean;
  sourceTransition?: LiveStudioSourceTransition;
  sourceTransitionDurationMs?: number;
  sourceAutoLayout?: boolean;
  sourceOverlayEnabled?: boolean;
  sourceLabelStyle?: LiveStudioSourceLabelStyle;
  stingerSettings?: Record<string, unknown>;
  reactionEnabled?: boolean;
  reactionPreviousLayout?: Exclude<LiveStudioLayout, 'reaction'>;
  reactionPreviousAutoLayout?: boolean;
  reactionYoutubeSourceId?: string | null;
  reactionCameraSourceIds?: string[];
  reactionPosition?: 'left' | 'right' | 'top' | 'bottom';
  reactionSizePercent?: number;
  reactionGap?: number;
  reactionStyle?: 'neon' | 'news' | 'glass' | 'clean';
  reactionAnimation?: 'fade' | 'slide' | 'pop' | 'pulse';
  reactionTitle?: string;
  reactionAccentColor?: string;
}) {
  const current = await getLiveStudioSettings();
  return (
    await query<LiveStudioSettingsRecord>(
      `update live_studio_settings
       set enabled=$1,
           layout=$2,
           program_source_id=$3,
           preview_source_id=$4,
           overlay_project_id=$5,
           transition=$6,
           transition_duration_ms=$7,
           chat_url=$8,
           chat_visible=$9,
           overlay_visible=$10,
           source_transition=$11,
           source_transition_duration_ms=$12,
           source_auto_layout=$13,
           source_overlay_enabled=$14,
           source_label_style=$15,
           stinger_settings=$16,
           reaction_enabled=$17,
           reaction_previous_layout=$18,
           reaction_previous_auto_layout=$19,
           reaction_youtube_source_id=$20,
           reaction_camera_source_ids=$21,
           reaction_position=$22,
           reaction_size_percent=$23,
           reaction_gap=$24,
           reaction_style=$25,
           reaction_animation=$26,
           reaction_title=$27,
           reaction_accent_color=$28,
           updated_at=now()
       where id=true
       returning enabled,layout,transition,transition_duration_ms,program_source_id,preview_source_id,overlay_project_id,chat_url,chat_visible,
                 overlay_visible,source_transition,source_transition_duration_ms,source_auto_layout,source_overlay_enabled,source_label_style,
                 stinger_settings,reaction_enabled,reaction_previous_layout,reaction_previous_auto_layout,reaction_youtube_source_id,
                 case when jsonb_typeof(reaction_camera_source_ids)='array' then reaction_camera_source_ids else '[]'::jsonb end reaction_camera_source_ids,
                 reaction_position,reaction_size_percent,reaction_gap,reaction_style,reaction_animation,reaction_title,reaction_accent_color,
                 updated_at`,
      [
        input.enabled ?? current.enabled,
        input.layout ?? current.layout,
        input.programSourceId === undefined ? current.program_source_id : input.programSourceId,
        input.previewSourceId === undefined ? current.preview_source_id : input.previewSourceId,
        input.overlayProjectId === undefined ? current.overlay_project_id : input.overlayProjectId,
        input.transition ?? current.transition,
        input.transitionDurationMs === undefined ? current.transition_duration_ms : input.transitionDurationMs,
        input.chatUrl === undefined ? current.chat_url : input.chatUrl,
        input.chatVisible === undefined ? current.chat_visible : input.chatVisible,
        input.overlayVisible === undefined ? current.overlay_visible : input.overlayVisible,
        input.sourceTransition ?? current.source_transition,
        input.sourceTransitionDurationMs === undefined
          ? current.source_transition_duration_ms
          : input.sourceTransitionDurationMs,
        input.sourceAutoLayout === undefined ? current.source_auto_layout : input.sourceAutoLayout,
        input.sourceOverlayEnabled === undefined ? current.source_overlay_enabled : input.sourceOverlayEnabled,
        input.sourceLabelStyle ?? current.source_label_style,
        input.stingerSettings ?? current.stinger_settings,
        input.reactionEnabled === undefined ? current.reaction_enabled : input.reactionEnabled,
        input.reactionPreviousLayout ?? current.reaction_previous_layout,
        input.reactionPreviousAutoLayout === undefined
          ? current.reaction_previous_auto_layout
          : input.reactionPreviousAutoLayout,
        input.reactionYoutubeSourceId === undefined
          ? current.reaction_youtube_source_id
          : input.reactionYoutubeSourceId,
        JSON.stringify(input.reactionCameraSourceIds ?? current.reaction_camera_source_ids),
        input.reactionPosition ?? current.reaction_position,
        input.reactionSizePercent === undefined ? current.reaction_size_percent : input.reactionSizePercent,
        input.reactionGap === undefined ? current.reaction_gap : input.reactionGap,
        input.reactionStyle ?? current.reaction_style,
        input.reactionAnimation ?? current.reaction_animation,
        input.reactionTitle ?? current.reaction_title,
        input.reactionAccentColor ?? current.reaction_accent_color,
      ],
    )
  ).rows[0];
}

export async function listLiveStudioSources() {
  return (
    await query<LiveStudioSourceRecord>(
      `select * from live_studio_sources order by slot_index asc,added_at asc,source_id asc`,
    )
  ).rows;
}

export async function upsertLiveStudioSource(input: {
  sourceId: string;
  inputName: string;
  displayName: string;
  userName?: string | null;
  viewerUrl?: string | null;
  muted?: boolean;
  hidden?: boolean;
  slotIndex?: number;
  inProgram?: boolean;
  portalState?: unknown;
}) {
  return (
    await query<LiveStudioSourceRecord>(
      `insert into live_studio_sources(
         source_id,input_name,display_name,user_name,viewer_url,muted,hidden,slot_index,in_program,last_portal_state
       )
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict(source_id) do update
       set input_name=excluded.input_name,
           display_name=excluded.display_name,
           user_name=excluded.user_name,
           viewer_url=excluded.viewer_url,
           muted=excluded.muted,
           hidden=excluded.hidden,
           slot_index=excluded.slot_index,
           in_program=excluded.in_program,
           last_portal_state=excluded.last_portal_state,
           updated_at=now()
       returning *`,
      [
        input.sourceId,
        input.inputName,
        input.displayName,
        input.userName ?? null,
        input.viewerUrl ?? null,
        input.muted ?? false,
        input.hidden ?? false,
        input.slotIndex ?? 0,
        input.inProgram ?? false,
        input.portalState ?? {},
      ],
    )
  ).rows[0];
}

export async function updateLiveStudioSource(
  sourceId: string,
  input: Partial<Pick<LiveStudioSourceRecord, 'muted' | 'hidden' | 'slot_index' | 'in_program' | 'viewer_url'>>,
) {
  const current = (
    await query<LiveStudioSourceRecord>(`select * from live_studio_sources where source_id=$1`, [sourceId])
  ).rows[0];
  if (!current) return null;
  return (
    await query<LiveStudioSourceRecord>(
      `update live_studio_sources
       set muted=$2,hidden=$3,slot_index=$4,in_program=$5,viewer_url=$6,updated_at=now()
       where source_id=$1
       returning *`,
      [
        sourceId,
        input.muted ?? current.muted,
        input.hidden ?? current.hidden,
        input.slot_index ?? current.slot_index,
        input.in_program ?? current.in_program,
        input.viewer_url === undefined ? current.viewer_url : input.viewer_url,
      ],
    )
  ).rows[0];
}

export async function setLiveStudioProgramSource(sourceId: string) {
  const current = (
    await query<LiveStudioSourceRecord>(`select * from live_studio_sources where source_id=$1`, [sourceId])
  ).rows[0];
  if (!current) return null;
  await query(
    `update live_studio_sources
     set slot_index=slot_index+1,in_program=false,updated_at=now()
     where source_id<>$1`,
    [sourceId],
  );
  return (
    await query<LiveStudioSourceRecord>(
      `update live_studio_sources
       set slot_index=0,hidden=false,in_program=true,updated_at=now()
       where source_id=$1
       returning *`,
      [sourceId],
    )
  ).rows[0];
}

export async function removeLiveStudioSource(sourceId: string) {
  await query(`delete from live_studio_sources where source_id=$1`, [sourceId]);
}

export interface BroadcastCommandRecord extends QueryResultRow {
  id: string;
  broadcast_run_id: string;
  playlist_id: string | null;
  command: string;
  sequence: string;
  status: string;
  idempotency_key: string | null;
  runner_id: string | null;
  expected_revision: string | null;
  expected_status: string | null;
  target_status: string | null;
  command_fingerprint: string | null;
  lease_generation: string | null;
  claimed_at: string | null;
  executing_at: string | null;
  completed_at: string | null;
  rejected_at: string | null;
  failed_at: string | null;
  expired_at: string | null;
  error_code: string | null;
  error_details: unknown;
  completed_state_revision: string | null;
  created_at: string;
}
export interface RunnerLeaseRecord extends QueryResultRow {
  broadcast_run_id: string;
  runner_id: string;
  heartbeat_at: string;
  lease_expires_at: string;
  acquired_at: string;
  last_state_revision: string;
  lease_generation: string;
}
export function fingerprintBroadcastCommand(
  command: string,
  expectedRevision?: number | null,
  expectedStatus?: string | null,
  targetStatus?: string | null,
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        command,
        expectedRevision: expectedRevision ?? null,
        expectedStatus: expectedStatus ?? null,
        targetStatus: targetStatus ?? null,
      }),
    )
    .digest('hex');
}

export async function createBroadcastCommand(input: {
  broadcastRunId: string;
  playlistId?: string | null;
  command: string;
  idempotencyKey?: string | null;
  expectedRevision?: number | null;
  expectedStatus?: string | null;
  targetStatus?: string | null;
}) {
  return transaction(async (client) => {
    const state = (
      await client.query(`select state,state_revision,command_sequence from playback_state where id=true for update`)
    ).rows[0];
    const expectedRevision = input.expectedRevision ?? Number(state?.state_revision ?? 0);
    const expectedStatus =
      input.expectedStatus ?? (typeof state?.state?.status === 'string' ? state.state.status : null);
    const targetStatus = input.targetStatus ?? input.command;
    const fingerprint = fingerprintBroadcastCommand(input.command, expectedRevision, expectedStatus, targetStatus);
    if (input.idempotencyKey) {
      const existing = (
        await client.query<BroadcastCommandRecord>(
          `select * from broadcast_commands where broadcast_run_id=$1 and idempotency_key=$2 for update`,
          [input.broadcastRunId, input.idempotencyKey],
        )
      ).rows[0];
      if (existing) {
        if (existing.command_fingerprint !== fingerprint) {
          const err = new Error('idempotency-key-conflict');
          (err as Error & { code?: string }).code = '409';
          throw err;
        }
        return existing;
      }
    }
    const seq = Number(state?.command_sequence ?? 0) + 1;
    const cmd = (
      await client.query<BroadcastCommandRecord>(
        `insert into broadcast_commands(broadcast_run_id,playlist_id,command,sequence,idempotency_key,expected_revision,expected_status,target_status,command_fingerprint)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [
          input.broadcastRunId,
          input.playlistId ?? null,
          input.command,
          seq,
          input.idempotencyKey ?? null,
          expectedRevision,
          expectedStatus,
          targetStatus,
          fingerprint,
        ],
      )
    ).rows[0];
    const updated = await client.query(`update playback_state set command_sequence=$1,updated_at=now() where id=true`, [
      seq,
    ]);
    if (updated.rowCount !== 1) throw new Error('playback-state-missing');
    await appendLiveEventTx(client, {
      type: 'broadcast-control',
      broadcastRunId: input.broadcastRunId,
      payload: {
        command: input.command,
        commandId: cmd.id,
        sequence: Number(cmd.sequence),
        status: 'pending',
        expectedRevision,
        expectedStatus,
        targetStatus,
      },
      dedupeKey: `broadcast-command:${cmd.id}:created`,
    });
    return cmd;
  });
}
export async function claimNextBroadcastCommand(
  broadcastRunId: string,
  runnerId: string,
  leaseSeconds = 15,
  leaseGeneration?: number,
) {
  return (
    (
      await query<BroadcastCommandRecord>(`select * from claim_broadcast_command($1,$2,$3,$4) where id is not null`, [
        broadcastRunId,
        runnerId,
        leaseSeconds,
        leaseGeneration ?? null,
      ])
    ).rows[0] ?? null
  );
}
export async function markBroadcastCommandExecuting(
  id: string,
  runnerId: string,
  leaseGeneration: number,
  details?: unknown,
) {
  return (
    (
      await query<BroadcastCommandRecord>(
        `update broadcast_commands set status='executing',executing_at=now(),error_details=coalesce($4,error_details) where id=$1 and runner_id=$2 and lease_generation=$3 and status='claimed' returning *`,
        [id, runnerId, leaseGeneration, details ?? null],
      )
    ).rows[0] ?? null
  );
}
export async function failBroadcastCommand(
  id: string,
  runnerId: string,
  leaseGeneration: number,
  errorCode: string,
  errorDetails: unknown,
) {
  return (
    (
      await query<BroadcastCommandRecord>(
        `update broadcast_commands set status='failed',failed_at=now(),error_code=$4,error_details=$5 where id=$1 and runner_id=$2 and lease_generation=$3 and status in ('claimed','executing') returning *`,
        [id, runnerId, leaseGeneration, errorCode, errorDetails],
      )
    ).rows[0] ?? null
  );
}
export async function updateBroadcastCommandPhase(
  id: string,
  runnerId: string,
  leaseGeneration: number,
  phase:
    | 'before_obs'
    | 'obs_requested'
    | 'obs_confirmed'
    | 'persisting'
    | 'completed'
    | 'failed'
    | 'reconciliation_required',
  details?: Record<string, unknown>,
) {
  return (
    (
      await query<BroadcastCommandRecord>(
        `update broadcast_commands set action_phase=$4,obs_last_confirmation=coalesce($5,obs_last_confirmation),obs_cursor_ms=coalesce($6,obs_cursor_ms),obs_checked_at=case when $5::jsonb is null then obs_checked_at else now() end,error_details=case when $4 in ('failed','reconciliation_required') then coalesce($5,error_details) else error_details end where id=$1 and runner_id=$2 and lease_generation=$3 and status in ('claimed','executing','failed') returning *`,
        [id, runnerId, leaseGeneration, phase, details ?? null, (details as any)?.mediaPositionMs ?? null],
      )
    ).rows[0] ?? null
  );
}
export async function markBroadcastCommandReconciliationRequired(input: {
  id: string;
  runnerId: string;
  leaseGeneration: number;
  error: unknown;
  obsState?: unknown;
}) {
  return (
    (
      await query<BroadcastCommandRecord>(
        `update broadcast_commands set status='reconciliation_required',action_phase='reconciliation_required',failed_at=now(),error_code='db_conflict_after_obs_confirmed',error_details=$4,obs_last_confirmation=coalesce($5,obs_last_confirmation),obs_checked_at=now() where id=$1 and runner_id=$2 and lease_generation=$3 and status in ('claimed','executing','failed') returning *`,
        [
          input.id,
          input.runnerId,
          input.leaseGeneration,
          { message: input.error instanceof Error ? input.error.message : String(input.error) },
          input.obsState ?? null,
        ],
      )
    ).rows[0] ?? null
  );
}
export async function completeBroadcastCommand(id: string, stateRevision?: number) {
  return (
    (
      await query<BroadcastCommandRecord>(
        `update broadcast_commands set status='completed',completed_at=now(),completed_state_revision=coalesce($2,completed_state_revision) where id=$1 returning *`,
        [id, stateRevision ?? null],
      )
    ).rows[0] ?? null
  );
}
export async function rejectBroadcastCommand(id: string, reason: string) {
  return (
    (
      await query<BroadcastCommandRecord>(
        `update broadcast_commands set status='rejected',rejected_at=now(),error_details=$2 where id=$1 returning *`,
        [id, { reason }],
      )
    ).rows[0] ?? null
  );
}
export async function getBroadcastCommand(id: string) {
  return (await query<BroadcastCommandRecord>(`select * from broadcast_commands where id=$1`, [id])).rows[0] ?? null;
}
export async function listBroadcastCommands(broadcastRunId: string, limit = 25) {
  return (
    await query<BroadcastCommandRecord>(
      `select * from broadcast_commands where broadcast_run_id=$1 order by sequence desc limit $2`,
      [broadcastRunId, Math.min(Math.max(limit, 1), 100)],
    )
  ).rows;
}
export async function acquireRunnerLease(broadcastRunId: string, runnerId: string, leaseSeconds = 15) {
  return transaction(async (client) => {
    const row = (
      await client.query<RunnerLeaseRecord>(
        `select * from broadcast_runner_leases where broadcast_run_id=$1 for update`,
        [broadcastRunId],
      )
    ).rows[0];
    if (row && row.runner_id !== runnerId && new Date(row.lease_expires_at).getTime() > Date.now()) return null;
    return (
      await client.query<RunnerLeaseRecord>(
        `insert into broadcast_runner_leases(broadcast_run_id,runner_id,heartbeat_at,lease_expires_at,acquired_at,last_state_revision,lease_generation)
       values($1,$2,now(),now()+($3||' seconds')::interval,now(),coalesce((select state_revision from playback_state where id=true),0),1)
       on conflict(broadcast_run_id) do update set runner_id=excluded.runner_id,heartbeat_at=excluded.heartbeat_at,lease_expires_at=excluded.lease_expires_at,acquired_at=case when broadcast_runner_leases.runner_id=$2 then broadcast_runner_leases.acquired_at else now() end, lease_generation=case when broadcast_runner_leases.runner_id=$2 then broadcast_runner_leases.lease_generation else broadcast_runner_leases.lease_generation+1 end
       returning *`,
        [broadcastRunId, runnerId, leaseSeconds],
      )
    ).rows[0];
  });
}
export async function renewRunnerLease(
  broadcastRunId: string,
  runnerId: string,
  leaseSeconds = 15,
  leaseGeneration?: number,
) {
  return (
    (
      await query<RunnerLeaseRecord>(
        `update broadcast_runner_leases set heartbeat_at=now(),lease_expires_at=now()+($3||' seconds')::interval where broadcast_run_id=$1 and runner_id=$2 and ($4::bigint is null or lease_generation=$4) and lease_expires_at>=now() returning *`,
        [broadcastRunId, runnerId, leaseSeconds, leaseGeneration ?? null],
      )
    ).rows[0] ?? null
  );
}
export async function releaseRunnerLease(broadcastRunId: string, runnerId: string, leaseGeneration?: number) {
  await query(
    `delete from broadcast_runner_leases where broadcast_run_id=$1 and runner_id=$2 and ($3::bigint is null or lease_generation=$3)`,
    [broadcastRunId, runnerId, leaseGeneration ?? null],
  );
}
export async function getRunnerLease(broadcastRunId: string) {
  return (
    (
      await query<RunnerLeaseRecord>(`select * from broadcast_runner_leases where broadcast_run_id=$1`, [
        broadcastRunId,
      ])
    ).rows[0] ?? null
  );
}
export async function takeOverExpiredLease(broadcastRunId: string, runnerId: string, leaseSeconds = 15) {
  return (
    (
      await query<RunnerLeaseRecord>(
        `update broadcast_runner_leases set runner_id=$2,heartbeat_at=now(),lease_expires_at=now()+($3||' seconds')::interval,acquired_at=now(),lease_generation=lease_generation+1 where broadcast_run_id=$1 and lease_expires_at<now() returning *`,
        [broadcastRunId, runnerId, leaseSeconds],
      )
    ).rows[0] ?? null
  );
}
export async function appendLiveEventTx(
  client: pg.PoolClient,
  input: {
    type: string;
    broadcastRunId?: string | null;
    articleId?: string | null;
    overlayVersionId?: string | null;
    payload?: unknown;
    dedupeKey?: string | null;
  },
) {
  const inserted = (
    await client.query(
      `insert into live_events(type,broadcast_run_id,article_id,overlay_version_id,payload,dedupe_key)
     values($1,$2,$3,$4,$5,$6)
     on conflict (dedupe_key) where dedupe_key is not null do nothing returning *`,
      [
        input.type,
        input.broadcastRunId ?? null,
        input.articleId ?? null,
        input.overlayVersionId ?? null,
        input.payload ?? {},
        input.dedupeKey ?? null,
      ],
    )
  ).rows[0];
  if (inserted) await client.query(`select pg_notify('live_events', $1)`, [String(inserted.id)]);
  if (inserted) return inserted;
  return input.dedupeKey
    ? (await client.query(`select * from live_events where dedupe_key=$1`, [input.dedupeKey])).rows[0]
    : null;
}
export async function applyBroadcastCommandTransaction(input: {
  commandId: string;
  runnerId: string;
  leaseGeneration: number;
  expectedRevision: number;
  status: string;
  playlistStatus: string;
  runStatus: string;
  playlistId: string;
  broadcastRunId: string;
  itemId?: string | null;
  articleId?: string | null;
  position?: number | null;
  eventType: string;
  payload?: Record<string, unknown>;
  media?: Record<string, unknown>;
}) {
  return transaction(async (client) => {
    const cmd = (
      await client.query<BroadcastCommandRecord>(`select * from broadcast_commands where id=$1 for update`, [
        input.commandId,
      ])
    ).rows[0];
    if (!cmd || cmd.broadcast_run_id !== input.broadcastRunId) throw new Error('command-not-found');
    if (!['claimed', 'executing'].includes(cmd.status)) throw new Error(`command-not-executable:${cmd.status}`);
    if (cmd.runner_id !== input.runnerId || Number(cmd.lease_generation ?? 0) !== input.leaseGeneration)
      throw new Error('lease-fencing-conflict');
    const lease = (
      await client.query<RunnerLeaseRecord>(
        `select * from broadcast_runner_leases where broadcast_run_id=$1 for update`,
        [input.broadcastRunId],
      )
    ).rows[0];
    if (!lease || lease.runner_id !== input.runnerId || Number(lease.lease_generation) !== input.leaseGeneration)
      throw new Error('lease-fencing-conflict');
    const liveLease = await client.query(`select 1 where $1::timestamptz >= now()`, [lease.lease_expires_at]);
    if (liveLease.rowCount !== 1) throw new Error('lease-expired');
    const run = (
      await client.query(`select * from broadcast_runs where id=$1 and playlist_id=$2 for update`, [
        input.broadcastRunId,
        input.playlistId,
      ])
    ).rows[0];
    if (!run) throw new Error('broadcast-run-invalid');
    const playlist = (
      await client.query(`select * from broadcast_playlists where id=$1 for update`, [input.playlistId])
    ).rows[0];
    if (!playlist) throw new Error('playlist-invalid');
    const ps = (await client.query(`select state_revision from playback_state where id=true for update`)).rows[0];
    const currentRevision = Number(ps?.state_revision ?? 0);
    if (currentRevision !== input.expectedRevision)
      throw new Error(`playback-revision-conflict:${currentRevision}:expected:${input.expectedRevision}`);
    const nextRevision = currentRevision + 1;
    const commandUpdate = await client.query(
      `update broadcast_commands set status='completed',completed_at=now(),completed_state_revision=$2 where id=$1 and runner_id=$3 and lease_generation=$4 and status in ('claimed','executing')`,
      [input.commandId, nextRevision, input.runnerId, input.leaseGeneration],
    );
    if (commandUpdate.rowCount !== 1) throw new Error('command-complete-lost');
    const runUpdate = await client.query(
      `update broadcast_runs set status=$2,last_state=$3,ended_at=case when $2 in ('ended','error','interrupted') then now() else ended_at end where id=$1`,
      [input.broadcastRunId, input.runStatus, { ...input.payload, status: input.status, stateRevision: nextRevision }],
    );
    if (runUpdate.rowCount !== 1) throw new Error('run-update-lost');
    const playlistUpdate = await client.query(
      `update broadcast_playlists set status=$2,current_position=coalesce($3,current_position),paused_at=case when $2='paused' then now() else paused_at end,ended_at=case when $2 in ('ended','error','interrupted') then now() else ended_at end where id=$1`,
      [input.playlistId, input.playlistStatus, input.position ?? null],
    );
    if (playlistUpdate.rowCount !== 1) throw new Error('playlist-update-lost');
    if (input.itemId) {
      const itemUpdate = await client.query(
        `update broadcast_items set status=case when $2='skipping' then 'skipped' when $2='ended' then 'played' else status end, finished_at=case when $2 in ('skipping','ended') then now() else finished_at end where id=$1 and playlist_id=$3`,
        [input.itemId, input.status, input.playlistId],
      );
      if (itemUpdate.rowCount !== 1) throw new Error('item-update-lost');
    }
    const state = {
      ...(input.payload ?? {}),
      status: input.status,
      runId: input.broadcastRunId,
      playlistId: input.playlistId,
      itemId: input.itemId,
      articleId: input.articleId,
      position: input.position,
      commandSeq: Number(cmd.sequence),
      stateRevision: nextRevision,
      ...(input.media ?? {}),
    };
    const stateUpdate = await client.query(
      `update playback_state set state=$1,state_revision=$2,command_sequence=greatest(command_sequence,$3),media_position_ms=$4,media_duration_ms=$5,obs_confirmed_position_ms=$6,obs_media_status=$7,last_obs_sync_at=now(),recovery_mode=$8,updated_at=now() where id=true`,
      [
        state,
        nextRevision,
        state.commandSeq,
        (input.media as any)?.mediaPositionMs ?? null,
        (input.media as any)?.mediaDurationMs ?? null,
        (input.media as any)?.obsConfirmedPositionMs ?? null,
        (input.media as any)?.obsMediaStatus ?? null,
        (input.media as any)?.recoveryMode ?? null,
      ],
    );
    if (stateUpdate.rowCount !== 1) throw new Error('playback-update-lost');
    const event = await appendLiveEventTx(client, {
      type: input.eventType,
      broadcastRunId: input.broadcastRunId,
      articleId: input.articleId,
      payload: state,
      dedupeKey: `${input.commandId}:completed`,
    });
    const leaseUpdate = await client.query(
      `update broadcast_runner_leases set last_state_revision=$3 where broadcast_run_id=$1 and runner_id=$2 and lease_generation=$4`,
      [input.broadcastRunId, input.runnerId, nextRevision, input.leaseGeneration],
    );
    if (leaseUpdate.rowCount !== 1) throw new Error('lease-update-lost');
    return {
      state,
      event,
      snapshot: canonicalPlaybackState({
        ...ps,
        state,
        state_revision: nextRevision,
        command_sequence: Number(ps?.command_sequence ?? 0),
        lease_generation: input.leaseGeneration,
      }),
    };
  });
}

export async function requestBroadcastRecoveryOperation(input: {
  broadcastRunId: string;
  requestedBy?: string | null;
  reason: string;
  operationType: 'recover' | 'takeover';
}) {
  return transaction(async (client) => {
    const lease = (
      await client.query<RunnerLeaseRecord>(
        `select * from broadcast_runner_leases where broadcast_run_id=$1 for update`,
        [input.broadcastRunId],
      )
    ).rows[0];
    if (lease) {
      const expired = await client.query(`select 1 where $1::timestamptz < now()`, [lease.lease_expires_at]);
      if (expired.rowCount !== 1) throw new Error('Lease ist nicht abgelaufen');
    }
    return (
      await client.query(
        `insert into broadcast_recovery_operations(broadcast_run_id,requested_by,reason,operation_type,previous_runner_id,previous_lease_generation,idempotency_scope)
         values($1,$2,$3,$4,$5,$6,$7) returning *`,
        [
          input.broadcastRunId,
          input.requestedBy ?? null,
          input.reason,
          input.operationType,
          lease?.runner_id ?? null,
          lease?.lease_generation ?? null,
          `system:${input.requestedBy ?? 'anonymous'}`,
        ],
      )
    ).rows[0];
  });
}

const BROADCAST_RECOVERY_MAX_ATTEMPTS = 5;

const BROADCAST_RECOVERY_CLAIM_TIMEOUT_SECONDS = boundedSettingNumber(
  process.env.BROADCAST_RECOVERY_CLAIM_TIMEOUT_SECONDS,
  30,
  1,
  3600,
);
const BROADCAST_RECOVERY_RETRY_MAX_DELAY_SECONDS = boundedSettingNumber(
  process.env.BROADCAST_RECOVERY_RETRY_MAX_DELAY_SECONDS,
  60,
  1,
  3600,
);

export async function claimBroadcastRecoveryOperation(runnerId: string) {
  return transaction(async (client) => {
    await client.query(
      `with orphaned as (
         select o.id,o.retry_count
         from broadcast_recovery_operations o
         left join broadcast_runner_leases l
           on l.broadcast_run_id=o.broadcast_run_id
          and l.runner_id=o.new_runner_id
          and l.lease_expires_at >= now()
         where o.status='claimed'
           and o.claimed_at < now()-($2||' seconds')::interval
           and l.broadcast_run_id is null
         for update of o skip locked
       )
       update broadcast_recovery_operations o
       set status=case when orphaned.retry_count + 1 >= $1 then 'failed' else 'pending' end,
           claimed_at=null,
           new_runner_id=null,
           retry_count=orphaned.retry_count + 1,
           next_attempt_at=case when orphaned.retry_count + 1 >= $1 then o.next_attempt_at else now() end,
           completed_at=case when orphaned.retry_count + 1 >= $1 then now() else null end,
           error_details=jsonb_build_object('code','recovery-operation-orphaned','previousRunnerId',o.new_runner_id,'claimTimeoutSeconds',$2)
       from orphaned
       where o.id=orphaned.id`,
      [BROADCAST_RECOVERY_MAX_ATTEMPTS, BROADCAST_RECOVERY_CLAIM_TIMEOUT_SECONDS],
    );
    const op = (
      await client.query(
        `select * from broadcast_recovery_operations
         where status='pending' and (next_attempt_at is null or next_attempt_at <= now())
         order by created_at asc
         for update skip locked
         limit 1`,
      )
    ).rows[0];
    if (!op) return null;
    await client.query(
      `update broadcast_recovery_operations set status='claimed',new_runner_id=$2,claimed_at=now() where id=$1`,
      [op.id, runnerId],
    );
    return { ...op, status: 'claimed', new_runner_id: runnerId };
  });
}

export async function findRecoverableBroadcastRun() {
  return (
    (
      await query(
        `select * from broadcast_runs where status in ('starting','running','paused','stopping','recovering') order by started_at desc limit 1`,
      )
    ).rows[0] ?? null
  );
}

export class BroadcastRecoveryOperationError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, details?: unknown) {
    super(code);
    this.name = 'BroadcastRecoveryOperationError';
    this.code = code;
    this.details = details;
  }
}

export async function completeBroadcastRecoveryOperation(input: {
  id: string;
  runnerId: string;
  broadcastRunId: string;
  leaseGeneration: number;
  recoveryMode: string;
  result?: unknown;
}) {
  return transaction(async (client) => {
    const operation = (
      await client.query(`select * from broadcast_recovery_operations where id=$1 for update`, [input.id])
    ).rows[0];
    if (!operation) throw new BroadcastRecoveryOperationError('recovery-operation-not-found', { id: input.id });
    if (
      operation.status !== 'claimed' ||
      operation.broadcast_run_id !== input.broadcastRunId ||
      operation.new_runner_id !== input.runnerId
    ) {
      throw new BroadcastRecoveryOperationError('recovery-operation-conflict', { id: input.id });
    }

    const run = (await client.query(`select * from broadcast_runs where id=$1 for update`, [input.broadcastRunId]))
      .rows[0];
    const playlist = run
      ? (await client.query(`select * from broadcast_playlists where id=$1 for update`, [run.playlist_id])).rows[0]
      : null;
    const lease = (
      await client.query(`select * from broadcast_runner_leases where broadcast_run_id=$1 for update`, [
        input.broadcastRunId,
      ])
    ).rows[0];
    if (
      lease?.runner_id !== input.runnerId ||
      Number(lease?.lease_generation) !== Number(input.leaseGeneration) ||
      !lease?.lease_expires_at
    ) {
      throw new BroadcastRecoveryOperationError('recovery-lease-expired', { id: input.id });
    }
    const leaseLive =
      (await client.query(`select 1 where $1::timestamptz >= now()`, [lease.lease_expires_at])).rowCount === 1;
    if (!leaseLive) throw new BroadcastRecoveryOperationError('recovery-lease-expired', { id: input.id });

    const playback = (await client.query(`select * from playback_state where id=true for update`)).rows[0];
    const playbackState = playback?.state ?? {};
    const operationType = operation.operation_type as string;
    let allowed: string[];
    let restoredStatus: 'running' | 'paused';

    switch (operationType) {
      case 'start':
        allowed = ['starting'];
        restoredStatus = 'running';
        break;
      case 'recover':
      case 'takeover':
        allowed = ['running', 'paused', 'recovering'];
        restoredStatus =
          run?.status === 'paused' || playlist?.status === 'paused' || String(playbackState.status) === 'paused'
            ? 'paused'
            : 'running';
        break;
      case 'reconcile-command':
        allowed = ['running', 'paused', 'recovering'];
        restoredStatus = String(playbackState.status) === 'paused' ? 'paused' : 'running';
        break;
      default:
        throw new BroadcastRecoveryOperationError('recovery-operation-type-unsupported', {
          id: input.id,
          operationType,
        });
    }

    if (
      !run?.playlist_id ||
      !playlist?.id ||
      playlist.id !== run.playlist_id ||
      playbackState.runId !== run.id ||
      playbackState.playlistId !== playlist.id ||
      !allowed.includes(run.status) ||
      !allowed.includes(playlist.status) ||
      !allowed.includes(String(playbackState.status))
    ) {
      throw new BroadcastRecoveryOperationError('recovery-state-mismatch', { id: input.id, operationType });
    }

    const nextRevision = Number(playback.state_revision ?? playbackState.stateRevision ?? 0) + 1;
    const nextState = {
      ...playbackState,
      status: operationType === 'reconcile-command' ? playbackState.status : restoredStatus,
      stateRevision: nextRevision,
      recoveryMode: input.recoveryMode,
      leaseGeneration: input.leaseGeneration,
    };
    switch (operationType) {
      case 'start': {
        const runUpdate = await client.query(
          `update broadcast_runs set status='running',last_state=$2 where id=$1 and status='starting'`,
          [run.id, nextState],
        );
        if (runUpdate.rowCount !== 1) throw new BroadcastRecoveryOperationError('recovery-state-mismatch');
        const playlistUpdate = await client.query(
          `update broadcast_playlists set status='running' where id=$1 and status='starting'`,
          [playlist.id],
        );
        if (playlistUpdate.rowCount !== 1) throw new BroadcastRecoveryOperationError('recovery-state-mismatch');
        const playbackUpdate = await client.query(
          `update playback_state set state=$1,state_revision=$2,recovery_mode=$3,updated_at=now() where id=true`,
          [nextState, nextRevision, input.recoveryMode],
        );
        if (playbackUpdate.rowCount !== 1) throw new BroadcastRecoveryOperationError('recovery-state-mismatch');
        break;
      }
      case 'recover':
      case 'takeover': {
        const runUpdate = await client.query(
          `update broadcast_runs set status=$2,last_state=$3 where id=$1 and status=any($4::text[])`,
          [run.id, restoredStatus, nextState, allowed],
        );
        if (runUpdate.rowCount !== 1) throw new BroadcastRecoveryOperationError('recovery-state-mismatch');
        const playlistUpdate = await client.query(
          `update broadcast_playlists set status=$2 where id=$1 and status=any($3::text[])`,
          [playlist.id, restoredStatus, allowed],
        );
        if (playlistUpdate.rowCount !== 1) throw new BroadcastRecoveryOperationError('recovery-state-mismatch');
        const playbackUpdate = await client.query(
          `update playback_state set state=$1,state_revision=$2,recovery_mode=$3,updated_at=now() where id=true`,
          [nextState, nextRevision, input.recoveryMode],
        );
        if (playbackUpdate.rowCount !== 1) throw new BroadcastRecoveryOperationError('recovery-state-mismatch');
        break;
      }
      case 'reconcile-command': {
        break;
      }
      default:
        throw new BroadcastRecoveryOperationError('recovery-operation-type-unsupported', {
          id: input.id,
          operationType,
        });
    }
    const operationUpdate = await client.query(
      `update broadcast_recovery_operations set status='completed',completed_at=now(),new_lease_generation=$4,result=$5 where id=$1 and broadcast_run_id=$3 and new_runner_id=$2 and status='claimed' returning *`,
      [
        input.id,
        input.runnerId,
        input.broadcastRunId,
        input.leaseGeneration,
        input.result ?? { recoveryMode: input.recoveryMode },
      ],
    );
    if (operationUpdate.rowCount !== 1) throw new BroadcastRecoveryOperationError('recovery-operation-conflict');
    if (operationType === 'recover' || operationType === 'takeover') {
      await appendLiveEventTx(client, {
        type: 'broadcast-recovered',
        broadcastRunId: run.id,
        payload: {
          previousRunnerId: operation.previous_runner_id,
          newRunnerId: input.runnerId,
          previousLeaseGeneration:
            operation.previous_lease_generation == null ? null : Number(operation.previous_lease_generation),
          newLeaseGeneration: Number(input.leaseGeneration),
          restoredStatus,
          position: typeof nextState.position === 'number' ? nextState.position : playlist.current_position,
          stateRevision: nextRevision,
        },
        dedupeKey: `broadcast-recovered:${operation.id}`,
      });
    }
    return operationUpdate.rows[0];
  });
}

export async function failBroadcastRecoveryOperation(input: { id: string; runnerId: string; error: unknown }) {
  return (
    (
      await query(
        `update broadcast_recovery_operations set status='failed',completed_at=now(),error_details=$3 where id=$1 and new_runner_id=$2 and status='claimed' returning *`,
        [input.id, input.runnerId, input.error],
      )
    ).rows[0] ?? null
  );
}

export async function releaseOrRetryBroadcastRecoveryOperation(input: {
  id: string;
  runnerId: string;
  delaySeconds?: number;
  error?: unknown;
}) {
  return (
    (
      await query(
        `update broadcast_recovery_operations
         set status=case when retry_count + 1 >= $3 then 'failed' else 'pending' end,
             claimed_at=null,
             new_runner_id=null,
             retry_count=retry_count+1,
             next_attempt_at=case
               when retry_count + 1 >= $3 then next_attempt_at
               else now()+(least($4::int, coalesce($5::int, least($4::int, (5 * power(2, retry_count))::int)))||' seconds')::interval
             end,
             completed_at=case when retry_count + 1 >= $3 then now() else null end,
             error_details=jsonb_build_object(
               'code', case when retry_count + 1 >= $3 then 'recovery-operation-max-attempts' else 'recovery-operation-retry' end,
               'attempt', retry_count + 1,
               'maxAttempts', $3,
               'error', $6::jsonb
             )
         where id=$1 and new_runner_id=$2 and status='claimed'
         returning *`,
        [
          input.id,
          input.runnerId,
          BROADCAST_RECOVERY_MAX_ATTEMPTS,
          BROADCAST_RECOVERY_RETRY_MAX_DELAY_SECONDS,
          input.delaySeconds ?? null,
          JSON.stringify(input.error ?? null),
        ],
      )
    ).rows[0] ?? null
  );
}

export async function getBroadcastRecoveryOperation(id: string) {
  return (await query(`select * from broadcast_recovery_operations where id=$1`, [id])).rows[0] ?? null;
}

export async function listBroadcastRecoveryOperations(broadcastRunId: string, limit = 20) {
  return (
    await query(
      `select * from broadcast_recovery_operations where broadcast_run_id=$1 order by created_at desc limit $2`,
      [broadcastRunId, Math.min(Math.max(limit, 1), 100)],
    )
  ).rows;
}
