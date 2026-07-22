import type { PoolClient } from 'pg';
import { query, transaction } from './index.js';

export type VideoEditorAspectRatio = '16:9' | '9:16' | '1:1';
export type VideoEditorQuality = '720p' | '1080p' | '1440p';
export type VideoEditorSourceKind = 'youtube-url' | 'youtube-library' | 'media';
export type VideoEditorTransition =
  | 'cut'
  | 'fade'
  | 'dissolve'
  | 'fadeblack'
  | 'wipeleft'
  | 'wiperight'
  | 'slideleft'
  | 'slideright'
  | 'smoothleft'
  | 'smoothright'
  | 'circleopen'
  | 'pixelize';

export type VideoEditorClip = {
  id: string;
  sourceId: string;
  name: string;
  sourceStart: number;
  duration: number;
  volume: number;
  fit: 'contain' | 'cover';
  transition: VideoEditorTransition;
  transitionDuration: number;
  effect: 'none' | 'cinematic' | 'warm' | 'cool' | 'monochrome' | 'high-contrast' | 'soft' | 'sharpen';
  effectIntensity: number;
  motion: 'none' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right';
};

export type VideoEditorAudioTrack = {
  id: string;
  sourceId: string;
  name: string;
  startAt: number;
  sourceStart: number;
  duration: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  muted: boolean;
};

export type VideoEditorTextTrack = {
  id: string;
  text: string;
  startAt: number;
  duration: number;
  x: number;
  y: number;
  width: number;
  fontFamily: 'dejavu-sans' | 'ibm-plex-sans' | 'ibm-plex-condensed' | 'liberation-sans';
  fontSize: number;
  fontWeight: 'regular' | 'semibold' | 'bold';
  color: string;
  backgroundColor: string;
  backgroundOpacity: number;
  opacity: number;
  outlineColor: string;
  outlineWidth: number;
  shadowColor: string;
  shadowX: number;
  shadowY: number;
  align: 'left' | 'center' | 'right';
  animation: 'none' | 'fade' | 'rise' | 'slide-left' | 'slide-right';
};

export type VideoEditorImageTrack = {
  id: string;
  sourceId: string;
  name: string;
  startAt: number;
  duration: number;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation: number;
  fit: 'contain' | 'cover';
  animation: 'none' | 'fade' | 'rise' | 'slide-left' | 'slide-right';
};

export type VideoEditorDocument = {
  version: 1;
  canvas: {
    aspectRatio: VideoEditorAspectRatio;
    backgroundColor: string;
    fps: 25 | 30 | 50 | 60;
  };
  clips: VideoEditorClip[];
  audioTracks: VideoEditorAudioTrack[];
  textTracks: VideoEditorTextTrack[];
  imageTracks: VideoEditorImageTrack[];
};

export type VideoEditorProject = {
  id: string;
  name: string;
  description: string | null;
  document: VideoEditorDocument;
  revision: number;
  status: 'draft' | 'queued' | 'rendering' | 'ready' | 'failed';
  duration_seconds: number;
  last_error: string | null;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  source_count?: number;
  render_count?: number;
  ready_render_count?: number;
};

export type VideoEditorSource = {
  id: string;
  project_id: string;
  source_kind: VideoEditorSourceKind;
  youtube_library_id: string | null;
  media_asset_id: string | null;
  youtube_video_id: string | null;
  source_url: string | null;
  title: string;
  channel_title: string | null;
  media_type: 'video' | 'audio' | 'image';
  duration_seconds: number;
  preview_url: string | null;
  local_path: string | null;
  status: 'remote' | 'queued' | 'downloading' | 'ready' | 'error' | 'cancelled';
  error: string | null;
  download_progress: number;
  download_quality: 'best' | '720p' | '1080p' | '1440p' | 'audio';
  download_mode: 'video' | 'audio';
  downloaded_size_bytes: number | null;
  download_metadata: Record<string, unknown>;
  download_attempts: number;
  download_locked_by: string | null;
  download_locked_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type VideoEditorRender = {
  id: string;
  project_id: string;
  project_revision: number;
  quality: VideoEditorQuality;
  status: 'queued' | 'rendering' | 'ready' | 'failed' | 'cancelled';
  progress: number;
  document_snapshot: VideoEditorDocument;
  output_path: string | null;
  thumbnail_path: string | null;
  media_asset_id: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  error: string | null;
  attempts: number;
  next_attempt_at: string;
  locked_by: string | null;
  locked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export function defaultVideoEditorDocument(): VideoEditorDocument {
  return {
    version: 1,
    canvas: { aspectRatio: '16:9', backgroundColor: '#050810', fps: 30 },
    clips: [],
    audioTracks: [],
    textTracks: [],
    imageTracks: [],
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function number(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function text(value: unknown, fallback: string, maximum: number) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) || fallback : fallback;
}

function identifier(value: unknown, fallback: string) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return /^[a-zA-Z0-9_-]{1,100}$/.test(candidate) ? candidate : fallback;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? (value as T) : fallback;
}

function frameRate(value: unknown): 25 | 30 | 50 | 60 {
  const parsed = Number(value);
  return parsed === 25 || parsed === 30 || parsed === 50 || parsed === 60 ? parsed : 30;
}

function color(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function normalizedItems<T>(items: unknown, maximum: number, factory: (item: unknown, index: number) => T) {
  return (Array.isArray(items) ? items : []).slice(0, maximum).map(factory);
}

export function normalizeVideoEditorDocument(value: unknown): VideoEditorDocument {
  const input = record(value);
  const canvas = record(input.canvas);
  const seen = new Set<string>();
  const uniqueId = (candidate: unknown, fallback: string) => {
    const base = identifier(candidate, fallback);
    let next = base;
    let suffix = 2;
    while (seen.has(next)) next = `${base}-${suffix++}`;
    seen.add(next);
    return next;
  };
  return {
    version: 1,
    canvas: {
      aspectRatio: enumValue(canvas.aspectRatio, ['16:9', '9:16', '1:1'] as const, '16:9'),
      backgroundColor: color(canvas.backgroundColor, '#050810'),
      fps: frameRate(canvas.fps),
    },
    clips: normalizedItems(input.clips, 100, (candidate, index) => {
      const clip = record(candidate);
      return {
        id: uniqueId(clip.id, `clip-${index + 1}`),
        sourceId: text(clip.sourceId, '', 80),
        name: text(clip.name, `Clip ${index + 1}`, 160),
        sourceStart: Number(number(clip.sourceStart, 0, 0, 21_600).toFixed(3)),
        duration: Number(number(clip.duration, 10, 0.25, 21_600).toFixed(3)),
        volume: Number(number(clip.volume, 1, 0, 2).toFixed(3)),
        fit: enumValue(clip.fit, ['contain', 'cover'] as const, 'cover'),
        transition: enumValue(
          clip.transition,
          [
            'cut',
            'fade',
            'dissolve',
            'fadeblack',
            'wipeleft',
            'wiperight',
            'slideleft',
            'slideright',
            'smoothleft',
            'smoothright',
            'circleopen',
            'pixelize',
          ] as const,
          'cut',
        ),
        transitionDuration: Number(number(clip.transitionDuration, 0.45, 0.1, 3).toFixed(3)),
        effect: enumValue(
          clip.effect,
          ['none', 'cinematic', 'warm', 'cool', 'monochrome', 'high-contrast', 'soft', 'sharpen'] as const,
          'none',
        ),
        effectIntensity: Number(number(clip.effectIntensity, 0.6, 0, 1).toFixed(3)),
        motion: enumValue(clip.motion, ['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right'] as const, 'none'),
      };
    }),
    audioTracks: normalizedItems(input.audioTracks, 30, (candidate, index) => {
      const track = record(candidate);
      return {
        id: uniqueId(track.id, `audio-${index + 1}`),
        sourceId: text(track.sourceId, '', 80),
        name: text(track.name, `Audiospur ${index + 1}`, 160),
        startAt: Number(number(track.startAt, 0, 0, 21_600).toFixed(3)),
        sourceStart: Number(number(track.sourceStart, 0, 0, 21_600).toFixed(3)),
        duration: Number(number(track.duration, 10, 0.25, 21_600).toFixed(3)),
        volume: Number(number(track.volume, 0.7, 0, 2).toFixed(3)),
        fadeIn: Number(number(track.fadeIn, 0, 0, 10).toFixed(3)),
        fadeOut: Number(number(track.fadeOut, 0, 0, 10).toFixed(3)),
        muted: track.muted === true,
      };
    }),
    textTracks: normalizedItems(input.textTracks, 50, (candidate, index) => {
      const track = record(candidate);
      return {
        id: uniqueId(track.id, `text-${index + 1}`),
        text: typeof track.text === 'string' ? track.text.trim().slice(0, 2_000) : '',
        startAt: Number(number(track.startAt, 0, 0, 21_600).toFixed(3)),
        duration: Number(number(track.duration, 5, 0.25, 21_600).toFixed(3)),
        x: Number(number(track.x, 500, 0, 1_000).toFixed(2)),
        y: Number(number(track.y, 820, 0, 1_000).toFixed(2)),
        width: Number(number(track.width, 820, 80, 1_000).toFixed(2)),
        fontFamily: enumValue(
          track.fontFamily,
          ['dejavu-sans', 'ibm-plex-sans', 'ibm-plex-condensed', 'liberation-sans'] as const,
          'ibm-plex-sans',
        ),
        fontSize: Math.round(number(track.fontSize, 54, 16, 180)),
        fontWeight: enumValue(track.fontWeight, ['regular', 'semibold', 'bold'] as const, 'bold'),
        color: color(track.color, '#ffffff'),
        backgroundColor: color(track.backgroundColor, '#050810'),
        backgroundOpacity: Number(number(track.backgroundOpacity, 0.78, 0, 1).toFixed(3)),
        opacity: Number(number(track.opacity, 1, 0, 1).toFixed(3)),
        outlineColor: color(track.outlineColor, '#000000'),
        outlineWidth: Math.round(number(track.outlineWidth, 0, 0, 12)),
        shadowColor: color(track.shadowColor, '#000000'),
        shadowX: Math.round(number(track.shadowX, 0, -30, 30)),
        shadowY: Math.round(number(track.shadowY, 3, -30, 30)),
        align: enumValue(track.align, ['left', 'center', 'right'] as const, 'center'),
        animation: enumValue(track.animation, ['none', 'fade', 'rise', 'slide-left', 'slide-right'] as const, 'fade'),
      };
    }),
    imageTracks: normalizedItems(input.imageTracks, 30, (candidate, index) => {
      const track = record(candidate);
      return {
        id: uniqueId(track.id, `image-${index + 1}`),
        sourceId: text(track.sourceId, '', 80),
        name: text(track.name, `Grafik ${index + 1}`, 160),
        startAt: Number(number(track.startAt, 0, 0, 21_600).toFixed(3)),
        duration: Number(number(track.duration, 8, 0.25, 21_600).toFixed(3)),
        x: Number(number(track.x, 700, 0, 1_000).toFixed(2)),
        y: Number(number(track.y, 70, 0, 1_000).toFixed(2)),
        width: Number(number(track.width, 240, 20, 1_000).toFixed(2)),
        height: Number(number(track.height, 240, 20, 1_000).toFixed(2)),
        opacity: Number(number(track.opacity, 1, 0, 1).toFixed(3)),
        rotation: Number(number(track.rotation, 0, -180, 180).toFixed(2)),
        fit: enumValue(track.fit, ['contain', 'cover'] as const, 'contain'),
        animation: enumValue(track.animation, ['none', 'fade', 'rise', 'slide-left', 'slide-right'] as const, 'fade'),
      };
    }),
  };
}

export function videoEditorTransitionOverlap(previous: VideoEditorClip | undefined, clip: VideoEditorClip) {
  if (!previous || clip.transition === 'cut') return 0;
  return Number(
    Math.min(clip.transitionDuration, Math.max(0, previous.duration - 0.25), Math.max(0, clip.duration - 0.25)).toFixed(
      3,
    ),
  );
}

export function videoEditorDuration(document: VideoEditorDocument) {
  return Number(
    document.clips
      .reduce(
        (total, clip, index, clips) => total + clip.duration - videoEditorTransitionOverlap(clips[index - 1], clip),
        0,
      )
      .toFixed(3),
  );
}

function normalizedProject(row: VideoEditorProject) {
  return { ...row, document: normalizeVideoEditorDocument(row.document) };
}

export async function listVideoEditorProjects() {
  return (
    await query<VideoEditorProject>(
      `select p.*,
         (select count(*)::int from youtube_video_editor_sources s where s.project_id=p.id) source_count,
         (select count(*)::int from youtube_video_editor_renders r where r.project_id=p.id) render_count,
         (select count(*)::int from youtube_video_editor_renders r where r.project_id=p.id and r.status='ready') ready_render_count
       from youtube_video_editor_projects p
       where p.deleted_at is null order by p.updated_at desc`,
    )
  ).rows.map(normalizedProject);
}

export async function getVideoEditorProject(id: string) {
  const project = (
    await query<VideoEditorProject>('select * from youtube_video_editor_projects where id=$1 and deleted_at is null', [
      id,
    ])
  ).rows[0];
  if (!project) return null;
  const [sources, renders] = await Promise.all([
    query<VideoEditorSource>(
      'select * from youtube_video_editor_sources where project_id=$1 order by sort_order,created_at',
      [id],
    ),
    query<VideoEditorRender>(
      'select * from youtube_video_editor_renders where project_id=$1 order by created_at desc limit 100',
      [id],
    ),
  ]);
  return {
    project: normalizedProject(project),
    sources: sources.rows,
    renders: renders.rows.map((render) => ({
      ...render,
      document_snapshot: normalizeVideoEditorDocument(render.document_snapshot),
    })),
  };
}

export async function getVideoEditorSource(id: string) {
  return (
    (
      await query<VideoEditorSource>(
        `select s.* from youtube_video_editor_sources s
         join youtube_video_editor_projects p on p.id=s.project_id
         where s.id=$1 and p.deleted_at is null`,
        [id],
      )
    ).rows[0] ?? null
  );
}

export async function createVideoEditorProject(input: {
  name: string;
  description?: string | null;
  createdBy?: string | null;
  document?: VideoEditorDocument;
}) {
  const document = normalizeVideoEditorDocument(input.document ?? defaultVideoEditorDocument());
  return normalizedProject(
    (
      await query<VideoEditorProject>(
        `insert into youtube_video_editor_projects(name,description,document,duration_seconds,created_by)
         values($1,$2,$3,$4,$5) returning *`,
        [
          input.name.trim(),
          input.description?.trim() || null,
          JSON.stringify(document),
          videoEditorDuration(document),
          input.createdBy ?? null,
        ],
      )
    ).rows[0],
  );
}

export async function updateVideoEditorProject(
  id: string,
  input: { name?: string; description?: string | null; document?: VideoEditorDocument; expectedRevision?: number },
) {
  const current = (
    await query<VideoEditorProject>('select * from youtube_video_editor_projects where id=$1 and deleted_at is null', [
      id,
    ])
  ).rows[0];
  if (!current) return { reason: 'not-found' as const, project: null };
  if (input.expectedRevision != null && current.revision !== input.expectedRevision)
    return { reason: 'conflict' as const, project: normalizedProject(current) };
  const document = input.document
    ? normalizeVideoEditorDocument(input.document)
    : normalizeVideoEditorDocument(current.document);
  const saved = (
    await query<VideoEditorProject>(
      `update youtube_video_editor_projects
       set name=coalesce($2,name),description=$3,document=$4,duration_seconds=$5,
           revision=revision+1,status='draft',last_error=null,updated_at=now()
       where id=$1 and deleted_at is null and revision=$6 returning *`,
      [
        id,
        input.name?.trim() || null,
        input.description === undefined ? current.description : input.description?.trim() || null,
        JSON.stringify(document),
        videoEditorDuration(document),
        current.revision,
      ],
    )
  ).rows[0];
  return saved ? { reason: null, project: normalizedProject(saved) } : { reason: 'conflict' as const, project: null };
}

export async function duplicateVideoEditorProject(id: string, createdBy?: string | null) {
  const source = await getVideoEditorProject(id);
  if (!source) return null;
  return transaction(async (client) => {
    const project = (
      await client.query<VideoEditorProject>(
        `insert into youtube_video_editor_projects(name,description,document,duration_seconds,created_by)
         values($1,$2,$3,$4,$5) returning *`,
        [
          `${source.project.name} – Kopie`,
          source.project.description,
          JSON.stringify(source.project.document),
          source.project.duration_seconds,
          createdBy ?? null,
        ],
      )
    ).rows[0];
    const sourceIdMap = new Map<string, string>();
    for (const item of source.sources) {
      const requiresOwnDownload = item.source_kind !== 'media';
      const copy = (
        await client.query<VideoEditorSource>(
          `insert into youtube_video_editor_sources(
             project_id,source_kind,youtube_library_id,media_asset_id,youtube_video_id,source_url,title,
             channel_title,media_type,duration_seconds,preview_url,local_path,status,error,sort_order,
             download_progress,download_quality,download_mode,downloaded_size_bytes,download_metadata
           ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning *`,
          [
            project.id,
            item.source_kind,
            item.youtube_library_id,
            item.media_asset_id,
            item.youtube_video_id,
            item.source_url,
            item.title,
            item.channel_title,
            item.media_type,
            item.duration_seconds,
            item.preview_url,
            requiresOwnDownload ? null : item.local_path,
            requiresOwnDownload ? 'queued' : item.status,
            null,
            item.sort_order,
            requiresOwnDownload ? 0 : item.download_progress,
            item.download_quality,
            item.download_mode,
            requiresOwnDownload ? null : item.downloaded_size_bytes,
            requiresOwnDownload ? {} : item.download_metadata,
          ],
        )
      ).rows[0];
      sourceIdMap.set(item.id, copy.id);
    }
    const document = normalizeVideoEditorDocument(source.project.document);
    document.clips = document.clips.map((clip) => ({ ...clip, sourceId: sourceIdMap.get(clip.sourceId) ?? '' }));
    document.audioTracks = document.audioTracks.map((track) => ({
      ...track,
      sourceId: sourceIdMap.get(track.sourceId) ?? '',
    }));
    document.imageTracks = document.imageTracks.map((track) => ({
      ...track,
      sourceId: sourceIdMap.get(track.sourceId) ?? '',
    }));
    const updated = (
      await client.query<VideoEditorProject>(
        'update youtube_video_editor_projects set document=$2,updated_at=now() where id=$1 returning *',
        [project.id, JSON.stringify(document)],
      )
    ).rows[0];
    return normalizedProject(updated);
  });
}

export async function softDeleteVideoEditorProject(id: string) {
  return (
    await query<{ output_paths: string[]; thumbnail_paths: string[]; media_asset_ids: string[] }>(
      `with target as (
         update youtube_video_editor_projects set deleted_at=now(),updated_at=now()
         where id=$1 and deleted_at is null
           and not exists(select 1 from youtube_video_editor_renders where project_id=$1 and status='rendering')
         returning id
       ), media as (
         update media_assets set deleted_at=now()
         where id in (select media_asset_id from youtube_video_editor_renders where project_id in (select id from target))
         returning id
       )
       select coalesce(array_agg(output_path) filter(where output_path is not null),'{}') output_paths,
              coalesce(array_agg(thumbnail_path) filter(where thumbnail_path is not null),'{}') thumbnail_paths,
              coalesce(array_agg(media_asset_id::text) filter(where media_asset_id is not null),'{}') media_asset_ids
       from youtube_video_editor_renders where project_id in (select id from target)`,
      [id],
    )
  ).rows[0];
}

export async function addVideoEditorSource(
  input: Omit<
    VideoEditorSource,
    | 'id'
    | 'created_at'
    | 'updated_at'
    | 'error'
    | 'download_progress'
    | 'download_quality'
    | 'download_mode'
    | 'downloaded_size_bytes'
    | 'download_metadata'
    | 'download_attempts'
    | 'download_locked_by'
    | 'download_locked_at'
  > & {
    error?: string | null;
    downloadProgress?: number;
    downloadQuality?: VideoEditorSource['download_quality'];
    downloadMode?: VideoEditorSource['download_mode'];
    downloadedSizeBytes?: number | null;
    downloadMetadata?: Record<string, unknown>;
  },
) {
  const uniqueColumn = input.media_asset_id ? 'media_asset_id' : 'youtube_video_id';
  const uniqueValue = input.media_asset_id ?? input.youtube_video_id;
  if (uniqueValue) {
    const existing = (
      await query<VideoEditorSource>(
        `select * from youtube_video_editor_sources where project_id=$1 and ${uniqueColumn}=$2 limit 1`,
        [input.project_id, uniqueValue],
      )
    ).rows[0];
    if (existing) return { source: existing, created: false };
  }
  const source = (
    await query<VideoEditorSource>(
      `insert into youtube_video_editor_sources(
         project_id,source_kind,youtube_library_id,media_asset_id,youtube_video_id,source_url,title,
         channel_title,media_type,duration_seconds,preview_url,local_path,status,error,sort_order,
         download_progress,download_quality,download_mode,downloaded_size_bytes,download_metadata
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning *`,
      [
        input.project_id,
        input.source_kind,
        input.youtube_library_id,
        input.media_asset_id,
        input.youtube_video_id,
        input.source_url,
        input.title.trim(),
        input.channel_title?.trim() || null,
        input.media_type,
        Math.max(0.25, Number(input.duration_seconds)),
        input.preview_url,
        input.local_path,
        input.status,
        input.error ?? null,
        input.sort_order,
        input.downloadProgress ?? (input.status === 'ready' ? 100 : 0),
        input.downloadQuality ?? 'best',
        input.downloadMode ?? (input.media_type === 'audio' ? 'audio' : 'video'),
        input.downloadedSizeBytes ?? null,
        input.downloadMetadata ?? {},
      ],
    )
  ).rows[0];
  await query('update youtube_video_editor_projects set updated_at=now() where id=$1', [input.project_id]);
  return { source, created: true };
}

export async function queueVideoEditorSourceDownload(
  id: string,
  input: { quality: VideoEditorSource['download_quality']; mode: VideoEditorSource['download_mode'] },
) {
  return (
    (
      await query<VideoEditorSource>(
        `update youtube_video_editor_sources set status='queued',download_progress=0,download_quality=$2,
         download_mode=$3,media_type=case when $3='audio' then 'audio' else 'video' end,error=null,
         download_attempts=0,download_locked_by=null,download_locked_at=null,updated_at=now()
         where id=$1 and source_kind in ('youtube-url','youtube-library') and status<>'downloading' returning *`,
        [id, input.mode === 'audio' ? 'audio' : input.quality, input.mode],
      )
    ).rows[0] ?? null
  );
}

export async function recoverStaleVideoEditorDownloads() {
  return query(
    `update youtube_video_editor_sources set status='queued',download_progress=0,
     error='Download nach einem Worker-Neustart erneut eingeplant.',download_locked_by=null,download_locked_at=null,
     updated_at=now()
     where status='downloading' and download_locked_at<now()-interval '30 minutes'`,
  );
}

export async function claimVideoEditorDownload(workerId: string) {
  return transaction(async (client) => {
    const source = (
      await client.query<VideoEditorSource>(
        `select s.* from youtube_video_editor_sources s
         join youtube_video_editor_projects p on p.id=s.project_id
         where s.status='queued' and s.source_kind in ('youtube-url','youtube-library') and p.deleted_at is null
         order by s.created_at for update of s skip locked limit 1`,
      )
    ).rows[0];
    if (!source) return null;
    return (
      await client.query<VideoEditorSource>(
        `update youtube_video_editor_sources set status='downloading',download_progress=greatest(1,download_progress),
         download_attempts=download_attempts+1,download_locked_by=$2,download_locked_at=now(),error=null,updated_at=now()
         where id=$1 returning *`,
        [source.id, workerId],
      )
    ).rows[0]!;
  });
}

export async function updateVideoEditorDownloadProgress(id: string, progress: number) {
  return query(
    `update youtube_video_editor_sources set download_progress=$2,download_locked_at=now(),updated_at=now()
     where id=$1 and status='downloading'`,
    [id, Math.max(1, Math.min(99, Math.floor(progress)))],
  );
}

export async function isVideoEditorDownloadActive(id: string, workerId: string) {
  return Boolean(
    (
      await query<{ active: boolean }>(
        `select exists(select 1 from youtube_video_editor_sources
         where id=$1 and status='downloading' and download_locked_by=$2) active`,
        [id, workerId],
      )
    ).rows[0]?.active,
  );
}

export async function cancelVideoEditorSourceDownload(id: string) {
  return (
    (
      await query<VideoEditorSource>(
        `update youtube_video_editor_sources set status='cancelled',
         error='Download auf Wunsch abgebrochen.',download_locked_by=null,download_locked_at=null,updated_at=now()
         where id=$1 and status in ('queued','downloading') returning *`,
        [id],
      )
    ).rows[0] ?? null
  );
}

export async function completeVideoEditorDownload(
  id: string,
  input: {
    localPath: string;
    sizeBytes: number;
    durationSeconds: number;
    metadata: Record<string, unknown>;
  },
) {
  return (
    (
      await query<VideoEditorSource>(
        `update youtube_video_editor_sources set status='ready',download_progress=100,local_path=$2,
         downloaded_size_bytes=$3,duration_seconds=$4,download_metadata=$5,error=null,
         download_locked_by=null,download_locked_at=null,updated_at=now() where id=$1 returning *`,
        [id, input.localPath, input.sizeBytes, input.durationSeconds, input.metadata],
      )
    ).rows[0] ?? null
  );
}

export async function failVideoEditorDownload(id: string, error: string) {
  return transaction(async (client) => {
    const current = (
      await client.query<VideoEditorSource>('select * from youtube_video_editor_sources where id=$1 for update', [id])
    ).rows[0];
    if (!current) return null;
    if (current.status === 'cancelled') return current;
    const retry = current.download_attempts < 3;
    return (
      await client.query<VideoEditorSource>(
        `update youtube_video_editor_sources set status=$2,download_progress=case when $2='queued' then 0 else download_progress end,
         error=$3,download_locked_by=null,download_locked_at=null,updated_at=now() where id=$1 returning *`,
        [id, retry ? 'queued' : 'error', error.slice(0, 1800)],
      )
    ).rows[0]!;
  });
}

export async function markVideoEditorSourceRemote(id: string) {
  return (
    (
      await query<VideoEditorSource>(
        `update youtube_video_editor_sources set status='remote',download_progress=0,local_path=null,
        downloaded_size_bytes=null,download_metadata='{}'::jsonb,error=null,download_locked_by=null,download_locked_at=null,
         updated_at=now() where id=$1 and source_kind in ('youtube-url','youtube-library') returning *`,
        [id],
      )
    ).rows[0] ?? null
  );
}

export async function deleteVideoEditorSource(projectId: string, sourceId: string) {
  return query(
    `delete from youtube_video_editor_sources s
     where s.id=$2 and s.project_id=$1
       and not exists(
         select 1 from youtube_video_editor_projects p
         where p.id=$1 and (
           exists(select 1 from jsonb_array_elements(coalesce(p.document->'clips','[]')) c where c->>'sourceId'=$2::text)
           or exists(select 1 from jsonb_array_elements(coalesce(p.document->'audioTracks','[]')) a where a->>'sourceId'=$2::text)
           or exists(select 1 from jsonb_array_elements(coalesce(p.document->'imageTracks','[]')) i where i->>'sourceId'=$2::text)
         )
       )`,
    [projectId, sourceId],
  );
}

export async function listVideoEditorMediaAssets() {
  return (
    await query<{
      id: string;
      filename: string;
      mime_type: string;
      size_bytes: number | null;
      duration_seconds: number | null;
      storage_path: string;
      derivative_paths: Record<string, unknown>;
      metadata: Record<string, unknown>;
      usage: string | null;
      created_at: string;
    }>(
      `select id,filename,mime_type,size_bytes,duration_seconds,storage_path,derivative_paths,metadata,usage,created_at
       from media_assets
       where deleted_at is null and storage_path is not null
         and (mime_type like 'video/%' or mime_type like 'audio/%' or mime_type like 'image/%')
       order by created_at desc limit 500`,
    )
  ).rows;
}

export async function createVideoEditorMediaAsset(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  sha256: string;
  durationSeconds: number;
  resolution?: string | null;
  metadata?: Record<string, unknown>;
  derivativePaths?: Record<string, unknown>;
  usage: 'video-editor-source' | 'video-editor-audio' | 'video-editor-image' | 'video-editor-render';
}) {
  return (
    await query<{
      id: string;
      filename: string;
      mime_type: string;
      duration_seconds: number;
      storage_path: string;
    }>(
      `insert into media_assets(
         filename,mime_type,size_bytes,duration_seconds,resolution,storage_path,sha256,metadata,derivative_paths,usage,
         source,license_name,license_status
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Lokale Videoproduktion','Eigene Produktion','cleared')
       returning *`,
      [
        input.filename,
        input.mimeType,
        input.sizeBytes,
        input.durationSeconds,
        input.resolution ?? null,
        input.storagePath,
        input.sha256,
        input.metadata ?? {},
        input.derivativePaths ?? {},
        input.usage,
      ],
    )
  ).rows[0];
}

export async function queueVideoEditorRenders(projectId: string, qualities: VideoEditorQuality[]) {
  return transaction(async (client) => {
    const project = (
      await client.query<VideoEditorProject>(
        'select * from youtube_video_editor_projects where id=$1 and deleted_at is null for update',
        [projectId],
      )
    ).rows[0];
    if (!project) return null;
    const document = normalizeVideoEditorDocument(project.document);
    const rows: VideoEditorRender[] = [];
    for (const quality of [...new Set(qualities)]) {
      rows.push(
        (
          await client.query<VideoEditorRender>(
            `insert into youtube_video_editor_renders(project_id,project_revision,quality,document_snapshot)
             values($1,$2,$3,$4) returning *`,
            [project.id, project.revision, quality, JSON.stringify(document)],
          )
        ).rows[0],
      );
    }
    await client.query(
      "update youtube_video_editor_projects set status='queued',last_error=null,updated_at=now() where id=$1",
      [projectId],
    );
    return rows;
  });
}

export async function recoverStaleVideoEditorRenders() {
  return query(
    `update youtube_video_editor_renders
     set status='queued',locked_by=null,locked_at=null,error='Nach einem Worker-Neustart erneut eingeplant.',
         next_attempt_at=now(),updated_at=now()
     where status='rendering' and locked_at<now()-interval '2 hours'`,
  );
}

export async function claimVideoEditorRender(workerId: string) {
  return transaction(async (client) => {
    const render = (
      await client.query<VideoEditorRender>(
        `select * from youtube_video_editor_renders
         where status='queued' and next_attempt_at<=now()
         order by created_at for update skip locked limit 1`,
      )
    ).rows[0];
    if (!render) return null;
    const claimed = (
      await client.query<VideoEditorRender>(
        `update youtube_video_editor_renders
         set status='rendering',progress=greatest(progress,2),attempts=attempts+1,locked_by=$2,locked_at=now(),
             started_at=coalesce(started_at,now()),error=null,updated_at=now()
         where id=$1 returning *`,
        [render.id, workerId],
      )
    ).rows[0];
    await client.query(
      "update youtube_video_editor_projects set status='rendering',last_error=null,updated_at=now() where id=$1",
      [render.project_id],
    );
    const sources = (
      await client.query<VideoEditorSource>(
        'select * from youtube_video_editor_sources where project_id=$1 order by sort_order,created_at',
        [render.project_id],
      )
    ).rows;
    return {
      render: { ...claimed, document_snapshot: normalizeVideoEditorDocument(claimed.document_snapshot) },
      sources,
    };
  });
}

export async function updateVideoEditorRenderProgress(id: string, progress: number) {
  return query(
    `update youtube_video_editor_renders set progress=$2,locked_at=now(),updated_at=now()
     where id=$1 and status='rendering'`,
    [id, Math.max(2, Math.min(98, Math.floor(progress)))],
  );
}

async function refreshProjectRenderStatus(client: PoolClient, projectId: string) {
  const summary = (
    await client.query<{ active: number; ready: number; failed: number }>(
      `select count(*) filter(where status in ('queued','rendering'))::int active,
              count(*) filter(where status='ready')::int ready,
              count(*) filter(where status='failed')::int failed
       from youtube_video_editor_renders where project_id=$1`,
      [projectId],
    )
  ).rows[0];
  const status = summary.active
    ? (
        await client.query(
          "select 1 from youtube_video_editor_renders where project_id=$1 and status='rendering' limit 1",
          [projectId],
        )
      ).rowCount
      ? 'rendering'
      : 'queued'
    : summary.ready
      ? 'ready'
      : summary.failed
        ? 'failed'
        : 'draft';
  await client.query('update youtube_video_editor_projects set status=$2,updated_at=now() where id=$1', [
    projectId,
    status,
  ]);
}

export async function completeVideoEditorRender(
  id: string,
  input: {
    outputPath: string;
    thumbnailPath: string;
    mediaAssetId: string;
    sizeBytes: number;
    durationSeconds: number;
    width: number;
    height: number;
  },
) {
  return transaction(async (client) => {
    const render = (
      await client.query<VideoEditorRender>(
        `update youtube_video_editor_renders set status='ready',progress=100,output_path=$2,thumbnail_path=$3,
           media_asset_id=$4,size_bytes=$5,duration_seconds=$6,width=$7,height=$8,error=null,locked_by=null,
           locked_at=null,completed_at=now(),updated_at=now() where id=$1 returning *`,
        [
          id,
          input.outputPath,
          input.thumbnailPath,
          input.mediaAssetId,
          input.sizeBytes,
          input.durationSeconds,
          input.width,
          input.height,
        ],
      )
    ).rows[0];
    if (render) await refreshProjectRenderStatus(client, render.project_id);
    return render;
  });
}

export async function failVideoEditorRender(id: string, error: string) {
  return transaction(async (client) => {
    const current = (
      await client.query<VideoEditorRender>('select * from youtube_video_editor_renders where id=$1 for update', [id])
    ).rows[0];
    if (!current || current.status === 'cancelled') return null;
    const retry = current.attempts < 3;
    const render = (
      await client.query<VideoEditorRender>(
        `update youtube_video_editor_renders
         set status=$2,progress=case when $2='queued' then 0 else progress end,error=$3,
             next_attempt_at=case when $2='queued' then now()+make_interval(secs=>$4) else next_attempt_at end,
             locked_by=null,locked_at=null,updated_at=now()
         where id=$1 returning *`,
        [id, retry ? 'queued' : 'failed', error.slice(0, 1800), Math.min(1800, 30 * 2 ** current.attempts)],
      )
    ).rows[0];
    await client.query('update youtube_video_editor_projects set last_error=$2,updated_at=now() where id=$1', [
      current.project_id,
      error.slice(0, 1800),
    ]);
    await refreshProjectRenderStatus(client, current.project_id);
    return render;
  });
}

export async function retryVideoEditorRender(id: string) {
  return transaction(async (client) => {
    const render =
      (
        await client.query<VideoEditorRender>(
          `update youtube_video_editor_renders
       set status='queued',progress=0,error=null,attempts=0,next_attempt_at=now(),completed_at=null,updated_at=now()
       where id=$1 and status in ('failed','cancelled') returning *`,
          [id],
        )
      ).rows[0] ?? null;
    if (render) await refreshProjectRenderStatus(client, render.project_id);
    return render;
  });
}

export async function cancelVideoEditorRender(id: string) {
  return transaction(async (client) => {
    const render =
      (
        await client.query<VideoEditorRender>(
          `update youtube_video_editor_renders set status='cancelled',error=null,updated_at=now()
       where id=$1 and status in ('queued','failed') returning *`,
          [id],
        )
      ).rows[0] ?? null;
    if (render) await refreshProjectRenderStatus(client, render.project_id);
    return render;
  });
}

export async function getVideoEditorRender(id: string) {
  const row = (await query<VideoEditorRender>('select * from youtube_video_editor_renders where id=$1', [id])).rows[0];
  return row ? { ...row, document_snapshot: normalizeVideoEditorDocument(row.document_snapshot) } : null;
}
