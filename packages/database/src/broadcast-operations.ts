import { query, transaction, type BroadcastItemRecord, type BroadcastPlaylistRecord } from './index.js';

export type BroadcastProductionStatus =
  'draft' | 'incomplete' | 'ready' | 'scheduled' | 'prepared' | 'on_air' | 'completed' | 'error';

export type BroadcastReadinessIssue = {
  code: string;
  severity: 'error' | 'warning';
  label: string;
  detail: string;
  itemId?: string;
};

export type BroadcastReadinessResult = {
  playlistId: string;
  ready: boolean;
  status: BroadcastProductionStatus;
  checkedAt: string;
  itemCount: number;
  totalRuntimeSeconds: number;
  targetRuntimeSeconds: number | null;
  issues: BroadcastReadinessIssue[];
};

type ReadinessPlaylist = BroadcastPlaylistRecord & {
  production_status: BroadcastProductionStatus;
  format_name: string | null;
  format_content_mode: string | null;
  overlay_project_name: string | null;
  overlay_published: boolean;
};

type ReadinessItem = BroadcastItemRecord & {
  title?: string;
  article_status?: string | null;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isYoutubeItem(item: ReadinessItem) {
  return ['youtube-video', 'youtube-news-sidebar', 'youtube-context'].includes(String(objectValue(item.rules).kind));
}

export function evaluateBroadcastReadiness(
  playlist: ReadinessPlaylist,
  items: ReadinessItem[],
  checkedAt = new Date().toISOString(),
): BroadcastReadinessResult {
  const issues: BroadcastReadinessIssue[] = [];
  const settings = objectValue(playlist.settings);
  if (!items.length) {
    issues.push({
      code: 'no-content',
      severity: 'error',
      label: 'Keine Inhalte',
      detail: 'Die Sendung enthält noch keinen Beitrag.',
    });
  }

  for (const item of items) {
    const title = item.title?.trim() || `Beitrag ${item.position + 1}`;
    const rules = objectValue(item.rules);
    if (item.status === 'error' || item.error) {
      issues.push({
        code: 'item-error',
        severity: 'error',
        label: `${title}: fehlerhaft`,
        detail: item.error || 'Der Beitrag ist als fehlerhaft markiert.',
        itemId: item.id,
      });
    }
    if (isYoutubeItem(item)) {
      if (!String(rules.url ?? '').trim() || !String(rules.youtubeVideoId ?? '').trim()) {
        issues.push({
          code: 'youtube-source-missing',
          severity: 'error',
          label: `${title}: YouTube-Quelle fehlt`,
          detail: 'Video-URL oder Video-ID ist nicht vollständig.',
          itemId: item.id,
        });
      }
      if (positiveNumber(item.duration_seconds ?? rules.durationSeconds) < 1) {
        issues.push({
          code: 'youtube-duration-missing',
          severity: 'error',
          label: `${title}: Laufzeit fehlt`,
          detail: 'Die Videolaufzeit konnte nicht ermittelt werden.',
          itemId: item.id,
        });
      }
    } else {
      if (!item.article_id || !item.article_status) {
        issues.push({
          code: 'article-missing',
          severity: 'error',
          label: `${title}: Beitrag fehlt`,
          detail: 'Der verknüpfte Nachrichtenbeitrag ist nicht mehr verfügbar.',
          itemId: item.id,
        });
      } else if (!['approved', 'published'].includes(item.article_status)) {
        issues.push({
          code: 'article-not-approved',
          severity: 'error',
          label: `${title}: nicht freigegeben`,
          detail: 'Der Nachrichtenbeitrag muss vor der Ausstrahlung freigegeben sein.',
          itemId: item.id,
        });
      }
      if (!item.audio_path || positiveNumber(item.audio_duration_seconds ?? item.duration_seconds) < 1) {
        issues.push({
          code: 'audio-missing',
          severity: 'error',
          label: `${title}: Audio fehlt`,
          detail: 'Der Sprechertext ist noch nicht vollständig vertont.',
          itemId: item.id,
        });
      }
    }
  }

  if (!playlist.overlay_project_id) {
    issues.push({
      code: 'overlay-default',
      severity: 'warning',
      label: 'Standard-Overlay',
      detail: 'Kein eigenes Overlay gewählt; die Sendung verwendet das Studio-Standardlayout.',
    });
  } else if (!playlist.overlay_published) {
    issues.push({
      code: 'overlay-unpublished',
      severity: 'error',
      label: 'Overlay nicht veröffentlicht',
      detail: `${playlist.overlay_project_name ?? 'Das gewählte Overlay'} besitzt keine veröffentlichte Version.`,
    });
  }

  if (!playlist.scheduled_at) {
    issues.push({
      code: 'not-scheduled',
      severity: 'warning',
      label: 'Noch nicht eingeplant',
      detail: 'Die Sendung kann vorbereitet werden, hat aber noch keine feste Startzeit.',
    });
  }

  const totalRuntimeSeconds = Math.round(
    items.reduce(
      (sum, item) =>
        sum +
        positiveNumber(
          isYoutubeItem(item)
            ? (item.duration_seconds ?? objectValue(item.rules).durationSeconds)
            : (item.audio_duration_seconds ?? item.duration_seconds),
        ),
      0,
    ),
  );
  const targetRuntimeSeconds = positiveNumber(settings.targetRuntimeMinutes)
    ? Math.round(positiveNumber(settings.targetRuntimeMinutes) * 60)
    : null;
  if (
    targetRuntimeSeconds &&
    totalRuntimeSeconds &&
    (totalRuntimeSeconds < targetRuntimeSeconds * 0.5 || totalRuntimeSeconds > targetRuntimeSeconds * 1.5)
  ) {
    issues.push({
      code: 'runtime-outside-target',
      severity: 'warning',
      label: 'Laufzeit weicht ab',
      detail: `Geplant sind ${Math.round(targetRuntimeSeconds / 60)} Minuten, der Rundown umfasst etwa ${Math.round(totalRuntimeSeconds / 60)} Minuten.`,
    });
  }

  const ready = !issues.some((issue) => issue.severity === 'error');
  const status: BroadcastProductionStatus = ready
    ? playlist.scheduled_at
      ? 'scheduled'
      : 'ready'
    : items.length
      ? 'incomplete'
      : 'draft';
  return {
    playlistId: playlist.id,
    ready,
    status,
    checkedAt,
    itemCount: items.length,
    totalRuntimeSeconds,
    targetRuntimeSeconds,
    issues,
  };
}

async function readinessSource(playlistId: string) {
  const playlist = (
    await query<ReadinessPlaylist>(
      `select bp.*,
              f.name format_name,f.content_mode format_content_mode,
              op.name overlay_project_name,
              case when bp.overlay_project_id is null then false else exists(
                select 1 from overlay_versions ov
                where ov.project_id=bp.overlay_project_id and ov.published=true
              ) end overlay_published
       from broadcast_playlists bp
       left join broadcast_templates f on f.id=bp.format_id
       left join overlay_projects op on op.id=bp.overlay_project_id and op.deleted_at is null
       where bp.id=$1`,
      [playlistId],
    )
  ).rows[0];
  if (!playlist) throw Object.assign(new Error('Sendung nicht gefunden.'), { statusCode: 404 });
  const items = (
    await query<ReadinessItem>(
      `select bi.*,
              coalesce(a.title,bi.rules->>'title','Beitrag') title,
              a.status article_status,
              aa.filename audio_path,
              aa.duration_seconds audio_duration_seconds
       from broadcast_items bi
       left join articles a on a.id=bi.article_id and a.deleted_at is null
       left join lateral (
         select * from scripts where article_id=a.id order by created_at desc limit 1
       ) script on true
       left join lateral (
         select audio.*,media.filename
         from audio_assets audio
         join media_assets media on media.id=audio.media_id
         where audio.script_id=script.id
         order by media.created_at desc,media.id desc limit 1
       ) aa on true
       where bi.playlist_id=$1
       order by bi.position`,
      [playlistId],
    )
  ).rows;
  return { playlist, items };
}

export async function checkBroadcastReadiness(playlistId: string, persist = true) {
  const { playlist, items } = await readinessSource(playlistId);
  const result = evaluateBroadcastReadiness(playlist, items);
  if (persist && !['starting', 'running', 'paused', 'stopping', 'recovering'].includes(playlist.status)) {
    await query(
      `update broadcast_playlists
       set production_status=$2,readiness_snapshot=$3,readiness_checked_at=$4
       where id=$1`,
      [playlistId, result.status, result, result.checkedAt],
    );
  }
  return result;
}

export async function prepareBroadcastPlaylist(playlistId: string, userId?: string | null) {
  const readiness = await checkBroadcastReadiness(playlistId, false);
  if (!readiness.ready) {
    throw Object.assign(new Error('Die Sendung ist noch nicht sendefertig.'), {
      statusCode: 409,
      readiness,
    });
  }
  const playlist = (
    await query(
      `update broadcast_playlists
       set production_status='prepared',readiness_snapshot=$2,readiness_checked_at=$3,
           prepared_at=now(),prepared_by=$4
       where id=$1 and status in ('draft','ended','error','interrupted')
       returning *`,
      [playlistId, readiness, readiness.checkedAt, userId ?? null],
    )
  ).rows[0];
  if (!playlist) {
    throw Object.assign(new Error('Eine laufende Sendung kann nicht erneut vorbereitet werden.'), { statusCode: 409 });
  }
  return { playlist, readiness };
}

export async function markBroadcastWorkflowDirty(playlistId: string) {
  await query(
    `update broadcast_playlists
     set production_status=case when scheduled_at is null then 'draft' else 'scheduled' end,
         readiness_snapshot='{}'::jsonb,readiness_checked_at=null,prepared_at=null,prepared_by=null
     where id=$1 and status not in ('starting','running','paused','stopping','recovering')`,
    [playlistId],
  );
}

export async function duplicateBroadcastPlaylist(playlistId: string, userId?: string | null) {
  return transaction(async (client) => {
    const source = (
      await client.query<BroadcastPlaylistRecord & { format_id: string | null }>(
        `select * from broadcast_playlists where id=$1 for update`,
        [playlistId],
      )
    ).rows[0];
    if (!source) throw Object.assign(new Error('Sendung nicht gefunden.'), { statusCode: 404 });
    const copy = (
      await client.query<BroadcastPlaylistRecord>(
        `insert into broadcast_playlists(
           name,mode,kind,description,scheduled_at,overlay_project_id,settings,status,current_position,format_id,
           production_status,readiness_snapshot,prepared_by
         )
         values($1,$2,$3,$4,null,$5,$6,'draft',0,$7,'draft','{}'::jsonb,$8)
         returning *`,
        [
          `${source.name} – Kopie`,
          source.mode,
          source.kind,
          source.description,
          source.overlay_project_id,
          source.settings,
          source.format_id,
          userId ?? null,
        ],
      )
    ).rows[0]!;
    await client.query(
      `insert into broadcast_items(playlist_id,article_id,position,duration_seconds,status,scene_id,rules)
       select $2,article_id,position,duration_seconds,'planned',scene_id,rules
       from broadcast_items where playlist_id=$1 order by position`,
      [playlistId, copy.id],
    );
    return copy;
  });
}

export async function listPreparedBroadcastPlaylists(limit = 12) {
  return (
    await query(
      `select bp.id,bp.name,bp.description,bp.scheduled_at,bp.production_status,bp.readiness_snapshot,
              bp.overlay_project_id,bp.format_id,f.name format_name,f.color format_color,
              count(bi.id)::int item_count,
              coalesce(sum(coalesce(bi.duration_seconds,0)),0)::int runtime_seconds
       from broadcast_playlists bp
       left join broadcast_templates f on f.id=bp.format_id
       left join broadcast_items bi on bi.playlist_id=bp.id
       where bp.status in ('draft','ended','error','interrupted')
         and (
           bp.production_status='prepared'
           or (bp.scheduled_at is not null and bp.scheduled_at>=now()-interval '10 minutes')
         )
       group by bp.id,f.id
       order by case when bp.production_status='prepared' then 0 else 1 end,
                bp.scheduled_at asc nulls last,bp.created_at desc
       limit $1`,
      [Math.max(1, Math.min(50, Math.floor(limit)))],
    )
  ).rows;
}

export type LiveInterruptionRecord = {
  id: string;
  status: 'active' | 'returned' | 'cancelled' | 'error';
  kind: 'live' | 'breaking';
  source_run_id: string | null;
  source_playlist_id: string | null;
  source_playlist_name?: string | null;
  source_item_id: string | null;
  source_item_title?: string | null;
  source_position: number | null;
  source_playback_status: string | null;
  autopilot_was_enabled: boolean;
  autopilot_was_paused: boolean;
  return_strategy: 'resume-position' | 'next-item' | 'next-show' | 'standby' | null;
  return_playlist_id: string | null;
  details: Record<string, unknown>;
  started_at: string;
  returned_at: string | null;
};

export async function getActiveLiveInterruption() {
  return (
    (
      await query<LiveInterruptionRecord>(
        `select interruption.*,
                playlist.name source_playlist_name,
                coalesce(article.title,item.rules->>'title') source_item_title
         from broadcast_live_interruptions interruption
         left join broadcast_playlists playlist on playlist.id=interruption.source_playlist_id
         left join broadcast_items item on item.id=interruption.source_item_id
         left join articles article on article.id=item.article_id
         where interruption.status='active'
         order by interruption.started_at desc limit 1`,
      )
    ).rows[0] ?? null
  );
}

export async function beginLiveInterruption(input: {
  kind: 'live' | 'breaking';
  runId?: string | null;
  playlistId?: string | null;
  itemId?: string | null;
  position?: number | null;
  playbackStatus?: string | null;
  autopilotEnabled: boolean;
  autopilotPaused: boolean;
  userId?: string | null;
  details?: Record<string, unknown>;
}) {
  return transaction(async (client) => {
    const active = (
      await client.query<LiveInterruptionRecord>(
        `select * from broadcast_live_interruptions where status='active' for update`,
      )
    ).rows[0];
    if (active) return active;
    return (
      await client.query<LiveInterruptionRecord>(
        `insert into broadcast_live_interruptions(
           kind,source_run_id,source_playlist_id,source_item_id,source_position,source_playback_status,
           autopilot_was_enabled,autopilot_was_paused,initiated_by,details
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [
          input.kind,
          input.runId ?? null,
          input.playlistId ?? null,
          input.itemId ?? null,
          input.position ?? null,
          input.playbackStatus ?? null,
          input.autopilotEnabled,
          input.autopilotPaused,
          input.userId ?? null,
          input.details ?? {},
        ],
      )
    ).rows[0]!;
  });
}

export async function completeLiveInterruption(input: {
  strategy: 'resume-position' | 'next-item' | 'next-show' | 'standby';
  returnPlaylistId?: string | null;
  userId?: string | null;
  details?: Record<string, unknown>;
}) {
  return (
    (
      await query<LiveInterruptionRecord>(
        `update broadcast_live_interruptions
       set status='returned',return_strategy=$1,return_playlist_id=$2,returned_by=$3,
           details=details||$4::jsonb,returned_at=now()
       where status='active'
       returning *`,
        [input.strategy, input.returnPlaylistId ?? null, input.userId ?? null, input.details ?? {}],
      )
    ).rows[0] ?? null
  );
}
