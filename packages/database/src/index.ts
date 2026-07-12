import pg from 'pg';
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
      `insert into sources(name,url,domain,type,category,region,language,description,priority,trust_level,fetch_interval_seconds,max_articles,max_fetch_seconds,active,user_agent) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
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
export async function listArticles(limit = 100) {
  return (
    await query<ArticleRecord>(
      `select a.*,s.name as source_name from articles a left join sources s on s.id=a.source_id where a.deleted_at is null order by coalesce(a.published_at,a.fetched_at) desc limit $1`,
      [limit],
    )
  ).rows;
}
export async function getArticleDetail(id: string) {
  return (
    (
      await query<ArticleDetailRecord>(
        `select a.*,s.name as source_name,sm.summary,sc.text script_text,sc.screen_text,sc.ticker_text,ma.filename audio_path,aa.duration_seconds audio_duration_seconds from articles a left join sources s on s.id=a.source_id left join lateral (select * from summaries where article_id=a.id order by created_at desc limit 1) sm on true left join lateral (select * from scripts where article_id=a.id order by created_at desc limit 1) sc on true left join lateral (select aa.* from audio_assets aa join scripts sx on sx.id=aa.script_id where sx.article_id=a.id order by aa.id desc limit 1) aa on true left join media_assets ma on ma.id=aa.media_id where a.id=$1 and a.deleted_at is null`,
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
) {
  return query(
    'with s as (insert into summaries(article_id,source_passages,summary,model_name,model_version,prompt_version) values($1,$2,$3,$4,$5,$6) returning id), sc as (insert into scripts(article_id,text,screen_text,ticker_text) values($1,$7,$8,$9) returning id) update articles set status=$10,version=version+1 where id=$1 returning *',
    [
      articleId,
      [],
      summary,
      'rule-based',
      '1',
      'article-to-broadcast-v1',
      script,
      screenText ?? summary,
      tickerText ?? summary.slice(0, 140),
      'review',
    ],
  );
}
export async function saveAudioAsset(articleId: string, filename: string, durationSeconds: number) {
  return query(
    `with sc as (select id from scripts where article_id=$1 order by created_at desc limit 1), ma as (insert into media_assets(filename,mime_type,duration_seconds,usage) values($2,'audio/wav',$3,'article-voice') returning id) insert into audio_assets(script_id,media_id,duration_seconds) select sc.id,ma.id,$3 from sc,ma`,
    [articleId, filename, durationSeconds],
  );
}
export async function getPublishedMainArticle() {
  return (
    (
      await query<ArticleDetailRecord>(
        `select a.*,s.name source_name,sm.summary,sc.text script_text,ma.filename audio_path,aa.duration_seconds audio_duration_seconds from articles a left join sources s on s.id=a.source_id left join lateral (select * from summaries where article_id=a.id order by created_at desc limit 1) sm on true left join lateral (select * from scripts where article_id=a.id order by created_at desc limit 1) sc on true left join lateral (select aa.* from audio_assets aa join scripts sx on sx.id=aa.script_id where sx.article_id=a.id order by aa.id desc limit 1) aa on true left join media_assets ma on ma.id=aa.media_id where a.status in ('published','approved') and a.deleted_at is null order by case when a.status='published' then 0 else 1 end, coalesce(a.published_at,a.fetched_at) desc limit 1`,
      )
    ).rows[0] ?? null
  );
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
export async function getPlaybackState<T = unknown>() {
  return (
    (await query<{ state: T }>('select state from playback_state where id=true')).rows[0]?.state ?? { status: 'idle' }
  );
}
export async function setPlaybackState(state: unknown) {
  await query(
    'insert into playback_state(id,state,updated_at) values(true,$1,now()) on conflict(id) do update set state=excluded.state,updated_at=now()',
    [state],
  );
}
export async function scheduleSourceFetchJobs() {
  await query(
    `insert into worker_jobs(kind,payload,scheduled_at) select 'fetch-source',jsonb_build_object('sourceId',id),now() from sources where active=true and deleted_at is null and (last_success_at is null or last_success_at + (fetch_interval_seconds || ' seconds')::interval <= now() or (last_error is not null and last_success_at is null)) on conflict do nothing`,
  );
}
export async function claimWorkerJob(workerId: string) {
  return (
    (
      await query(
        `with job as (select id from worker_jobs where status='queued' and scheduled_at<=now() order by scheduled_at,id for update skip locked limit 1) update worker_jobs w set status='running',attempts=attempts+1,started_at=now(),locked_at=now(),locked_by=$1,error=null from job where w.id=job.id returning w.*`,
        [workerId],
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
  'draft' | 'starting' | 'running' | 'paused' | 'stopping' | 'ended' | 'error' | 'interrupted';
export interface BroadcastPlaylistRecord {
  id: string;
  name: string;
  mode: string;
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
  article_id: string;
  position: number;
  duration_seconds: number | null;
  status: string;
  error: string | null;
  title?: string;
  audio_path?: string | null;
  audio_duration_seconds?: number | null;
}
export async function createBroadcastPlaylist(name = 'Sendeliste') {
  return (
    await query<BroadcastPlaylistRecord>(
      `insert into broadcast_playlists(name,status,current_position) values($1,'draft',0) returning *`,
      [name],
    )
  ).rows[0];
}
export async function listBroadcastPlaylists() {
  return (await query<BroadcastPlaylistRecord>(`select * from broadcast_playlists order by created_at desc`)).rows;
}
export async function getBroadcastPlaylist(id: string) {
  return (await query<BroadcastPlaylistRecord>(`select * from broadcast_playlists where id=$1`, [id])).rows[0] ?? null;
}
export async function listBroadcastItems(playlistId: string) {
  return (
    await query<BroadcastItemRecord>(
      `select bi.*,a.title,ma.filename audio_path,aa.duration_seconds audio_duration_seconds from broadcast_items bi join articles a on a.id=bi.article_id left join lateral (select * from scripts where article_id=a.id order by created_at desc limit 1) sc on true left join lateral (select aa.* from audio_assets aa where aa.script_id=sc.id order by aa.id desc limit 1) aa on true left join media_assets ma on ma.id=aa.media_id where bi.playlist_id=$1 order by bi.position asc`,
      [playlistId],
    )
  ).rows;
}
export async function addBroadcastItem(playlistId: string, articleId: string) {
  const pos = (
    await query<{ next: number }>(`select coalesce(max(position)+1,0) next from broadcast_items where playlist_id=$1`, [
      playlistId,
    ])
  ).rows[0].next;
  return (
    await query<BroadcastItemRecord>(
      `insert into broadcast_items(playlist_id,article_id,position,status) select $1,id,$3,'planned' from articles where id=$2 and status in ('approved','published') returning *`,
      [playlistId, articleId, pos],
    )
  ).rows[0];
}
export async function removeBroadcastItem(playlistId: string, itemId: string) {
  await transaction(async (client) => {
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
        `select id from broadcast_runs where status in ('starting','running','paused','stopping') for update`,
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
export async function activeBroadcastRun() {
  return (
    (
      await query(
        `select * from broadcast_runs where status in ('starting','running','paused','stopping') order by started_at desc limit 1`,
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
  if (mode === 'resume') {
    const state = run.last_state ?? {};
    const position = typeof state.position === 'number' ? state.position : 0;
    await query(
      `update broadcast_items set status='planned' where playlist_id=$1 and position>=$2 and status in ('playing','planned')`,
      [run.playlist_id, position],
    );
    await setBroadcastPlaylistState(run.playlist_id, 'running', position);
    await setPlaybackState({ ...state, status: 'recovering', runId: run.id, playlistId: run.playlist_id, position });
    return run;
  }
  await updateBroadcastRun(run.id, 'interrupted', {
    status: 'interrupted',
    reason: 'API-Neustart ohne aktiven Prozess',
  });
  await setBroadcastPlaylistState(run.playlist_id, 'error');
  await setPlaybackState({ status: 'interrupted', runId: run.id, playlistId: run.playlist_id });
  return null;
}
export async function interruptStaleBroadcastRuns(maxAgeSeconds = 300) {
  await query(
    `update broadcast_runs set status='interrupted',ended_at=now(),last_state=jsonb_set(coalesce(last_state,'{}'::jsonb),'{reason}',to_jsonb('Stale active run interrupted'::text),true) where status in ('starting','running','paused','stopping') and started_at < now()-($1||' seconds')::interval`,
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
}
export async function listOverlayProjects() {
  return (
    await query<OverlayProjectRecord>(
      `select * from overlay_projects where deleted_at is null order by created_at desc`,
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
export async function duplicateOverlayProject(projectId: string, userId?: string) {
  const p = await getOverlayProject(projectId);
  const v =
    (await latestOverlayDraft(projectId)) ??
    (await query(`select * from overlay_versions where project_id=$1 order by version desc limit 1`, [projectId]))
      .rows[0];
  if (!p || !v) throw new Error('Overlay-Projekt nicht gefunden');
  return createOverlayProject({
    name: `${p.name} Kopie`,
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
  return (
    await query(
      `insert into live_events(type,broadcast_run_id,article_id,overlay_version_id,payload,dedupe_key)
       values($1,$2,$3,$4,$5,$6)
       on conflict (dedupe_key) where dedupe_key is not null do update set dedupe_key=excluded.dedupe_key
       returning *`,
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
  await query(
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
    await query(
      `update overlay_projects set obs_scene_name=$2,obs_input_name=$3,obs_configured_url=$4,obs_configured_version_id=$5,obs_width=$6,obs_height=$7,obs_configured_at=now() where id=$1 returning *`,
      [input.projectId, input.sceneName, input.inputName, input.url, input.versionId, input.width, input.height],
    )
  ).rows[0];
}

export async function publishedMainOverlayUrl() {
  return (
    await query(
      `select public_url from overlay_projects p join overlay_versions v on v.project_id=p.id where p.template='main-news' and p.deleted_at is null and v.status='published' and p.public_url is not null order by v.created_at desc limit 1`,
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
