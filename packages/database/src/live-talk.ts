import { query } from './index.js';

export type LiveTalkLayout = 'host-guest' | 'interview' | 'panel' | 'townhall';
export type LiveTalkStatus = 'draft' | 'ready' | 'on_air' | 'ended' | 'archived' | 'error';

export type LiveTalkShow = {
  id: string;
  title: string;
  subtitle: string;
  topic: string;
  status: LiveTalkStatus;
  layout: LiveTalkLayout;
  source_ids: string[];
  ava_enabled: boolean;
  mia_enabled: boolean;
  chat_enabled: boolean;
  advertising_enabled: boolean;
  advertising_interval_minutes: number;
  accent_color: string;
  planned_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  last_ad_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LiveTalkInput = {
  title: string;
  subtitle?: string;
  topic?: string;
  layout?: LiveTalkLayout;
  sourceIds?: string[];
  avaEnabled?: boolean;
  miaEnabled?: boolean;
  chatEnabled?: boolean;
  advertisingEnabled?: boolean;
  advertisingIntervalMinutes?: number;
  accentColor?: string;
  plannedAt?: string | null;
};

function normalizedSourceIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))].slice(0, 8);
}

export async function listLiveTalkShows(includeArchived = false) {
  return (
    await query<LiveTalkShow>(
      `select id,title,subtitle,topic,status,layout,
              case when jsonb_typeof(source_ids)='array' then source_ids else '[]'::jsonb end source_ids,
              ava_enabled,mia_enabled,chat_enabled,advertising_enabled,advertising_interval_minutes,
              accent_color,planned_at,started_at,ended_at,last_ad_at,created_at,updated_at
       from live_talk_shows
       where ($1::boolean or status<>'archived')
       order by case status when 'on_air' then 0 when 'ready' then 1 when 'draft' then 2 else 3 end,
                coalesce(planned_at,created_at) desc`,
      [includeArchived],
    )
  ).rows;
}

export async function getLiveTalkShow(id: string) {
  return (
    (
      await query<LiveTalkShow>(
        `select id,title,subtitle,topic,status,layout,
                case when jsonb_typeof(source_ids)='array' then source_ids else '[]'::jsonb end source_ids,
                ava_enabled,mia_enabled,chat_enabled,advertising_enabled,advertising_interval_minutes,
                accent_color,planned_at,started_at,ended_at,last_ad_at,created_at,updated_at
         from live_talk_shows where id=$1`,
        [id],
      )
    ).rows[0] ?? null
  );
}

export async function createLiveTalkShow(input: LiveTalkInput, userId?: string | null) {
  return (
    await query<LiveTalkShow>(
      `insert into live_talk_shows(
         title,subtitle,topic,layout,source_ids,ava_enabled,mia_enabled,chat_enabled,
         advertising_enabled,advertising_interval_minutes,accent_color,planned_at,created_by
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning *`,
      [
        input.title.trim(),
        input.subtitle?.trim() ?? '',
        input.topic?.trim() ?? '',
        input.layout ?? 'host-guest',
        JSON.stringify(normalizedSourceIds(input.sourceIds)),
        input.avaEnabled ?? true,
        input.miaEnabled ?? true,
        input.chatEnabled ?? true,
        input.advertisingEnabled ?? true,
        input.advertisingIntervalMinutes ?? 20,
        input.accentColor ?? '#22d3ee',
        input.plannedAt ?? null,
        userId ?? null,
      ],
    )
  ).rows[0];
}

export async function updateLiveTalkShow(id: string, input: LiveTalkInput) {
  return (
    (
      await query<LiveTalkShow>(
        `update live_talk_shows set
           title=$2,subtitle=$3,topic=$4,layout=$5,source_ids=$6,ava_enabled=$7,mia_enabled=$8,
           chat_enabled=$9,advertising_enabled=$10,advertising_interval_minutes=$11,
           accent_color=$12,planned_at=$13,updated_at=now()
         where id=$1 and status<>'archived'
         returning *`,
        [
          id,
          input.title.trim(),
          input.subtitle?.trim() ?? '',
          input.topic?.trim() ?? '',
          input.layout ?? 'host-guest',
          JSON.stringify(normalizedSourceIds(input.sourceIds)),
          input.avaEnabled ?? true,
          input.miaEnabled ?? true,
          input.chatEnabled ?? true,
          input.advertisingEnabled ?? true,
          input.advertisingIntervalMinutes ?? 20,
          input.accentColor ?? '#22d3ee',
          input.plannedAt ?? null,
        ],
      )
    ).rows[0] ?? null
  );
}

export async function setLiveTalkShowStatus(id: string, status: LiveTalkStatus, error?: string | null) {
  const result = (
    await query<LiveTalkShow>(
      `update live_talk_shows set
         status=$2,
         started_at=case when $2='on_air' then coalesce(started_at,now()) else started_at end,
         ended_at=case when $2='ended' then now() when $2='on_air' then null else ended_at end,
         topic=case when $2='error' and nullif($3,'') is not null then topic||E'\n\nRegiefehler: '||$3 else topic end,
         updated_at=now()
       where id=$1 returning *`,
      [id, status, error ?? null],
    )
  ).rows[0];
  return result ?? null;
}

export async function archiveLiveTalkShow(id: string) {
  return setLiveTalkShowStatus(id, 'archived');
}

export async function saveLiveTalkInvitation(input: {
  showId: string;
  portalInvitationId: string;
  displayName: string;
  invitationUrl: string;
  status: string;
  sourceId?: string | null;
  expiresAt: string;
}) {
  return (
    await query(
      `insert into live_talk_portal_invitations(
         show_id,portal_invitation_id,display_name,invitation_url,status,source_id,expires_at
       ) values($1,$2,$3,$4,$5,$6,$7)
       on conflict(portal_invitation_id) do update set
         status=excluded.status,source_id=excluded.source_id,expires_at=excluded.expires_at,updated_at=now()
       returning *`,
      [
        input.showId,
        input.portalInvitationId,
        input.displayName,
        input.invitationUrl,
        input.status,
        input.sourceId ?? null,
        input.expiresAt,
      ],
    )
  ).rows[0];
}

export async function listLiveTalkInvitations(showId?: string) {
  return (
    await query(
      `select * from live_talk_portal_invitations
       where ($1::uuid is null or show_id=$1)
       order by created_at desc`,
      [showId ?? null],
    )
  ).rows;
}

export async function syncLiveTalkInvitation(input: {
  portalInvitationId: string;
  status: string;
  sourceId?: string | null;
  expiresAt: string;
}) {
  return (
    await query(
      `update live_talk_portal_invitations set
         status=$2,source_id=$3,expires_at=$4,updated_at=now()
       where portal_invitation_id=$1 returning *`,
      [input.portalInvitationId, input.status, input.sourceId ?? null, input.expiresAt],
    )
  ).rows[0] ?? null;
}
