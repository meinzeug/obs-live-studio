import { query } from './index.js';

export type BroadcastFormatContentMode = 'news' | 'youtube' | 'mixed' | 'youtube-news-sidebar' | 'youtube-context';

export type BroadcastFormatLayout =
  'main-news' | 'youtube-video' | 'youtube-news-sidebar' | 'youtube-context' | 'custom';

export interface BroadcastFormatRecord {
  id: string;
  name: string;
  system_key: string | null;
  description: string | null;
  content_mode: BroadcastFormatContentMode;
  layout: BroadcastFormatLayout;
  overlay_project_id: string | null;
  overlay_project_name: string | null;
  overlay_template: string | null;
  default_duration_minutes: number;
  default_item_count: number;
  color: string;
  icon: string;
  settings: Record<string, unknown>;
  flow: Record<string, unknown>;
  active: boolean;
  is_system: boolean;
  usage_count: number;
  upcoming_count: number;
  next_scheduled_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface BroadcastFormatInput {
  name: string;
  description?: string | null;
  contentMode: BroadcastFormatContentMode;
  layout: BroadcastFormatLayout;
  overlayProjectId?: string | null;
  defaultDurationMinutes: number;
  defaultItemCount: number;
  color: string;
  icon?: string;
  settings?: Record<string, unknown>;
  active?: boolean;
}

const formatSelect = `
  select f.*,
         op.name overlay_project_name,
         op.template overlay_template,
         count(bp.id)::int usage_count,
         count(bp.id) filter(
           where bp.scheduled_at>=now() and bp.status in ('draft','starting','running','paused')
         )::int upcoming_count,
         min(bp.scheduled_at) filter(
           where bp.scheduled_at>=now() and bp.status in ('draft','starting','running','paused')
         ) next_scheduled_at
  from broadcast_templates f
  left join overlay_projects op on op.id=f.overlay_project_id and op.deleted_at is null
  left join broadcast_playlists bp on bp.format_id=f.id
`;

const formatGroup = `
  group by f.id,op.id,op.name,op.template
`;

export async function listBroadcastFormats(options: { includeInactive?: boolean } = {}) {
  return (
    await query<BroadcastFormatRecord>(
      `${formatSelect}
       where f.deleted_at is null
         and ($1::boolean or f.active=true)
       ${formatGroup}
       order by f.is_system desc,f.active desc,f.name asc`,
      [Boolean(options.includeInactive)],
    )
  ).rows;
}

export async function getBroadcastFormat(id: string, includeDeleted = false) {
  return (
    (
      await query<BroadcastFormatRecord>(
        `${formatSelect}
         where f.id=$1 and ($2::boolean or f.deleted_at is null)
         ${formatGroup}`,
        [id, includeDeleted],
      )
    ).rows[0] ?? null
  );
}

function formatFlow(input: BroadcastFormatInput) {
  return {
    version: 1,
    contentMode: input.contentMode,
    layout: input.layout,
    settings: input.settings ?? {},
  };
}

export async function createBroadcastFormat(input: BroadcastFormatInput) {
  const inserted = (
    await query<{ id: string }>(
      `insert into broadcast_templates(
         name,description,content_mode,layout,overlay_project_id,
         default_duration_minutes,default_item_count,color,icon,settings,active,is_system,flow
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12)
       returning id`,
      [
        input.name.trim(),
        input.description?.trim() || null,
        input.contentMode,
        input.layout,
        input.overlayProjectId ?? null,
        input.defaultDurationMinutes,
        input.defaultItemCount,
        input.color,
        input.icon?.trim() || 'clapperboard',
        input.settings ?? {},
        input.active ?? true,
        formatFlow(input),
      ],
    )
  ).rows[0];
  return getBroadcastFormat(inserted!.id);
}

export async function updateBroadcastFormat(id: string, input: BroadcastFormatInput) {
  const current = await getBroadcastFormat(id);
  if (!current) throw Object.assign(new Error('Sendeformat nicht gefunden.'), { statusCode: 404 });
  await query(
    `update broadcast_templates
     set name=$2,description=$3,content_mode=$4,layout=$5,overlay_project_id=$6,
         default_duration_minutes=$7,default_item_count=$8,color=$9,icon=$10,
         settings=$11,active=$12,flow=$13,updated_at=now()
     where id=$1 and deleted_at is null`,
    [
      id,
      input.name.trim(),
      input.description?.trim() || null,
      input.contentMode,
      input.layout,
      input.overlayProjectId ?? null,
      input.defaultDurationMinutes,
      input.defaultItemCount,
      input.color,
      input.icon?.trim() || current.icon || 'clapperboard',
      input.settings ?? {},
      input.active ?? current.active,
      formatFlow(input),
    ],
  );
  return getBroadcastFormat(id);
}

export async function duplicateBroadcastFormat(id: string, name?: string) {
  const source = await getBroadcastFormat(id);
  if (!source) throw Object.assign(new Error('Sendeformat nicht gefunden.'), { statusCode: 404 });
  return createBroadcastFormat({
    name: name?.trim() || `${source.name} – Kopie`,
    description: source.description,
    contentMode: source.content_mode,
    layout: source.layout,
    overlayProjectId: source.overlay_project_id,
    defaultDurationMinutes: source.default_duration_minutes,
    defaultItemCount: source.default_item_count,
    color: source.color,
    icon: source.icon,
    settings: source.settings,
    active: true,
  });
}

export async function archiveBroadcastFormat(id: string) {
  const format = await getBroadcastFormat(id);
  if (!format) throw Object.assign(new Error('Sendeformat nicht gefunden.'), { statusCode: 404 });
  if (format.is_system) {
    throw Object.assign(new Error('Mitgelieferte Studioformate können deaktiviert, aber nicht gelöscht werden.'), {
      statusCode: 409,
    });
  }
  await query(`update broadcast_templates set active=false,deleted_at=now(),updated_at=now() where id=$1`, [id]);
}

export async function setBroadcastPlaylistFormat(playlistId: string, formatId: string | null) {
  if (formatId) {
    const format = await getBroadcastFormat(formatId);
    if (!format || !format.active)
      throw Object.assign(new Error('Das gewählte Sendeformat ist nicht aktiv.'), { statusCode: 409 });
  }
  return (
    (await query(`update broadcast_playlists set format_id=$2 where id=$1 returning *`, [playlistId, formatId]))
      .rows[0] ?? null
  );
}

export async function listBroadcastPlaylistsWithFormats() {
  return (
    await query(
      `select bp.*,
              f.name format_name,f.color format_color,f.content_mode format_content_mode,
              f.layout format_layout,f.icon format_icon,(f.deleted_at is not null) format_archived
       from broadcast_playlists bp
       left join broadcast_templates f on f.id=bp.format_id
       order by bp.created_at desc`,
    )
  ).rows;
}

export async function getBroadcastPlaylistWithFormat(id: string) {
  return (
    (
      await query(
        `select bp.*,
                f.name format_name,f.color format_color,f.content_mode format_content_mode,
                f.layout format_layout,f.icon format_icon,(f.deleted_at is not null) format_archived
         from broadcast_playlists bp
         left join broadcast_templates f on f.id=bp.format_id
         where bp.id=$1`,
        [id],
      )
    ).rows[0] ?? null
  );
}
