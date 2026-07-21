import { query, transaction } from './index.js';

export type AiPresenterMediaState = 'idle' | 'speaking';

export type AiPresenterMedia = {
  id: string;
  staff_member_id: string;
  state: AiPresenterMediaState;
  original_filename: string;
  original_path: string;
  rendered_path: string;
  thumbnail_path: string | null;
  mime_type: string;
  sha256: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  green_screen: boolean;
  managed: boolean;
  created_at: string;
  updated_at: string;
};

export type AiPresenterProfile = {
  staff_member_id: string;
  display_name: string;
  job_title: string;
  role: string;
  enabled: boolean;
  accent_color: string;
  tts_voice: string;
  updated_at: string;
  media: Partial<Record<AiPresenterMediaState, AiPresenterMedia>>;
};

type PresenterRow = Omit<AiPresenterProfile, 'media'> & { media: AiPresenterMedia[] | null };

function normalizeProfile(row: PresenterRow): AiPresenterProfile {
  const media = Object.fromEntries((row.media ?? []).map((entry) => [entry.state, entry]));
  return { ...row, media };
}

export async function listAiPresenterProfiles() {
  const rows = (
    await query<PresenterRow>(
      `select m.id staff_member_id,m.display_name,m.job_title,m.role,m.enabled,m.accent_color,
              coalesce(p.tts_voice,'') tts_voice,coalesce(p.updated_at,m.updated_at) updated_at,
              coalesce(
                jsonb_agg(to_jsonb(media) order by media.state) filter(where media.id is not null),
                '[]'::jsonb
              ) media
       from ai_staff_members m
       left join ai_presenter_profiles p on p.staff_member_id=m.id
       left join ai_presenter_media media on media.staff_member_id=m.id
       where m.role in ('moderator','chat-moderator')
       group by m.id,m.display_name,m.job_title,m.role,m.enabled,m.accent_color,p.tts_voice,p.updated_at,m.updated_at
       order by case m.role when 'moderator' then 0 else 1 end,m.display_name`,
    )
  ).rows;
  return rows.map(normalizeProfile);
}

export async function getAiPresenterProfile(staffMemberId: string) {
  return (await listAiPresenterProfiles()).find((profile) => profile.staff_member_id === staffMemberId) ?? null;
}

export async function setAiPresenterVoice(staffMemberId: string, voice: string) {
  const row = (
    await query<{ staff_member_id: string; tts_voice: string; updated_at: string }>(
      `insert into ai_presenter_profiles(staff_member_id,tts_voice,updated_at)
       select id,$2,now() from ai_staff_members where id=$1 and role in ('moderator','chat-moderator')
       on conflict(staff_member_id) do update set tts_voice=excluded.tts_voice,updated_at=now()
       returning *`,
      [staffMemberId, voice.trim()],
    )
  ).rows[0];
  return row ?? null;
}

export async function replaceAiPresenterMedia(input: {
  staffMemberId: string;
  state: AiPresenterMediaState;
  originalFilename: string;
  originalPath: string;
  renderedPath: string;
  thumbnailPath?: string | null;
  mimeType?: string;
  sha256: string;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  greenScreen: boolean;
}) {
  return transaction(async (client) => {
    const previous =
      (
        await client.query<AiPresenterMedia>(
          `select media.* from ai_presenter_media media
         join ai_staff_members member on member.id=media.staff_member_id
         where media.staff_member_id=$1 and media.state=$2 for update`,
          [input.staffMemberId, input.state],
        )
      ).rows[0] ?? null;
    const current = (
      await client.query<AiPresenterMedia>(
        `insert into ai_presenter_media(
           staff_member_id,state,original_filename,original_path,rendered_path,thumbnail_path,mime_type,
           sha256,width,height,duration_seconds,green_screen,managed,updated_at
         )
         select id,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,now()
         from ai_staff_members where id=$1 and role in ('moderator','chat-moderator')
         on conflict(staff_member_id,state) do update set
           original_filename=excluded.original_filename,original_path=excluded.original_path,
           rendered_path=excluded.rendered_path,thumbnail_path=excluded.thumbnail_path,mime_type=excluded.mime_type,
           sha256=excluded.sha256,width=excluded.width,height=excluded.height,
           duration_seconds=excluded.duration_seconds,green_screen=excluded.green_screen,managed=true,updated_at=now()
         returning *`,
        [
          input.staffMemberId,
          input.state,
          input.originalFilename,
          input.originalPath,
          input.renderedPath,
          input.thumbnailPath ?? null,
          input.mimeType ?? 'video/webm',
          input.sha256,
          input.width ?? null,
          input.height ?? null,
          input.durationSeconds ?? null,
          input.greenScreen,
        ],
      )
    ).rows[0];
    return current ? { current, previous } : null;
  });
}

export async function deleteAiPresenterMedia(staffMemberId: string, state: AiPresenterMediaState) {
  return (
    (
      await query<AiPresenterMedia>(
        `delete from ai_presenter_media where staff_member_id=$1 and state=$2 returning *`,
        [staffMemberId, state],
      )
    ).rows[0] ?? null
  );
}

export async function getAiPresenterMedia(staffMemberId: string, state: AiPresenterMediaState) {
  return (
    (
      await query<AiPresenterMedia>(`select * from ai_presenter_media where staff_member_id=$1 and state=$2`, [
        staffMemberId,
        state,
      ])
    ).rows[0] ?? null
  );
}
