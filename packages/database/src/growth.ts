import { query, transaction } from './index.js';

export type GrowthSettings = {
  id: boolean;
  enabled: boolean;
  auto_detect: boolean;
  auto_create_social_pack: boolean;
  approval_required: boolean;
  minimum_score: number;
  minimum_chat_messages: number;
  clip_preroll_seconds: number;
  clip_duration_seconds: number;
  participation_overlay: boolean;
  share_url: string | null;
  share_prompt: string;
  platforms: string[];
  updated_at: string;
};

export type GrowthMoment = {
  id: string;
  ai_host_session_id: string | null;
  broadcast_item_id: string | null;
  youtube_video_id: string | null;
  title: string;
  hook: string;
  reason: string;
  score: number;
  chat_count: number;
  media_position_ms: number | null;
  status: 'detected' | 'approved' | 'rejected' | 'rendering' | 'ready' | 'published' | 'failed';
  social_pack: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export async function getGrowthSettings() {
  return (await query<GrowthSettings>('select * from growth_settings where id=true')).rows[0];
}

export async function updateGrowthSettings(input: Partial<{
  enabled: boolean;
  autoDetect: boolean;
  autoCreateSocialPack: boolean;
  approvalRequired: boolean;
  minimumScore: number;
  minimumChatMessages: number;
  clipPrerollSeconds: number;
  clipDurationSeconds: number;
  participationOverlay: boolean;
  shareUrl: string | null;
  sharePrompt: string;
  platforms: string[];
}>) {
  return (
    await query<GrowthSettings>(
      `update growth_settings set enabled=coalesce($1,enabled),auto_detect=coalesce($2,auto_detect),
       auto_create_social_pack=coalesce($3,auto_create_social_pack),approval_required=coalesce($4,approval_required),
       minimum_score=coalesce($5,minimum_score),minimum_chat_messages=coalesce($6,minimum_chat_messages),
       clip_preroll_seconds=coalesce($7,clip_preroll_seconds),clip_duration_seconds=coalesce($8,clip_duration_seconds),
       participation_overlay=coalesce($9,participation_overlay),share_url=case when $10 then $11 else share_url end,
       share_prompt=coalesce($12,share_prompt),platforms=coalesce($13,platforms),updated_at=now() where id=true returning *`,
      [input.enabled ?? null,input.autoDetect ?? null,input.autoCreateSocialPack ?? null,input.approvalRequired ?? null,
       input.minimumScore ?? null,input.minimumChatMessages ?? null,input.clipPrerollSeconds ?? null,input.clipDurationSeconds ?? null,
       input.participationOverlay ?? null,Object.prototype.hasOwnProperty.call(input,'shareUrl'),input.shareUrl ?? null,
       input.sharePrompt ?? null,input.platforms ?? null],
    )
  ).rows[0];
}

export async function createGrowthMoment(input: {
  sessionId?: string | null;
  broadcastItemId?: string | null;
  youtubeVideoId?: string | null;
  title: string;
  hook: string;
  reason: string;
  score: number;
  chatCount?: number;
  mediaPositionMs?: number | null;
  socialPack?: Record<string, unknown>;
}) {
  return transaction(async (client) => {
    if (input.sessionId) {
      const existing = (await client.query<GrowthMoment>(
        `select * from growth_moments where ai_host_session_id=$1 and hook=$2 and created_at>now()-interval '15 minutes' limit 1`,
        [input.sessionId,input.hook],
      )).rows[0];
      if (existing) return existing;
    }
    return (await client.query<GrowthMoment>(
      `insert into growth_moments(ai_host_session_id,broadcast_item_id,youtube_video_id,title,hook,reason,score,chat_count,media_position_ms,social_pack)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [input.sessionId ?? null,input.broadcastItemId ?? null,input.youtubeVideoId ?? null,input.title.slice(0,180),
       input.hook.slice(0,500),input.reason.slice(0,500),Math.max(1,Math.min(100,Math.round(input.score))),
       input.chatCount ?? 0,input.mediaPositionMs ?? null,input.socialPack ?? {}],
    )).rows[0];
  });
}

export async function listGrowthMoments(limit=50) {
  return (await query<GrowthMoment>(`select * from growth_moments order by created_at desc limit $1`,[Math.max(1,Math.min(200,limit))])).rows;
}

export async function updateGrowthMomentStatus(id:string,status:GrowthMoment['status']) {
  return (await query<GrowthMoment>('update growth_moments set status=$2,updated_at=now() where id=$1 returning *',[id,status])).rows[0] ?? null;
}

export async function growthSummary() {
  return (await query(`select
    count(*) filter(where created_at>now()-interval '24 hours')::int moments_24h,
    count(*) filter(where status in ('approved','ready','published'))::int approved,
    count(*) filter(where status='published')::int published,
    coalesce(round(avg(score))::int,0) average_score,
    coalesce(sum(chat_count),0)::int chat_signals
    from growth_moments`)).rows[0];
}
