import { createHash } from 'node:crypto';
import { query, transaction, type YoutubeVideoRecord } from './index.js';

export const YOUTUBE_STRICT_GENERATOR_VERSION = 'codex-cli-complete-show-discussion-20-40-v2';

export type YoutubePreproducedCueKind =
  'intro' | 'context' | 'reaction' | 'fact-check' | 'question' | 'translation' | 'closing';

export type YoutubePreproducedCueDraft = {
  atMs: number;
  endMs?: number | null;
  presenterId: string;
  kind: YoutubePreproducedCueKind;
  respondsToPresenterId?: string | null;
  handoffToPresenterId?: string | null;
  discussionMove?: string | null;
  displayMode: 'inline' | 'takeover';
  headline: string;
  speakerText: string;
  audiencePrompt?: string | null;
  sourceExcerpt?: string | null;
  sourceStartMs?: number | null;
  sourceEndMs?: number | null;
  wit?: boolean;
  audioPath: string;
  audioDurationSeconds: number;
  aiModel: string;
  aiTier: 'codex';
  ttsEngine: string;
  ttsVoice: string;
};

export type YoutubePreproducedCue = {
  id: string;
  script_id: string;
  position: number;
  at_ms: number | string;
  end_ms: number | string | null;
  presenter_id: string;
  kind: YoutubePreproducedCueKind;
  responds_to_presenter_id: string | null;
  handoff_to_presenter_id: string | null;
  discussion_move: string | null;
  display_mode: 'inline' | 'takeover';
  headline: string;
  speaker_text: string;
  audience_prompt: string | null;
  source_excerpt: string | null;
  source_start_ms: number | string | null;
  source_end_ms: number | string | null;
  wit: boolean;
  audio_path: string | null;
  audio_duration_seconds: number | string | null;
  ai_model: string | null;
  ai_tier: 'codex' | null;
  tts_engine: string | null;
  tts_voice: string | null;
};

export type YoutubePreproducedScript = {
  id: string;
  youtube_video_id: string;
  status: 'pending' | 'processing' | 'ready' | 'partial' | 'unavailable' | 'error';
  transcript_hash: string | null;
  generator_version: string;
  cue_count: number;
  duration_ms: number | string;
  error: string | null;
  production_model: string | null;
  editorial_summary: string | null;
  generated_at: string | null;
  cues: YoutubePreproducedCue[];
};

export type YoutubePreproductionCandidate = YoutubeVideoRecord & {
  preproduction_status: YoutubePreproducedScript['status'] | null;
  preproduction_hash: string | null;
  preproduction_generator_version: string | null;
  preproduction_production_model: string | null;
};

export function youtubeTranscriptHash(video: Pick<YoutubeVideoRecord, 'transcript_text' | 'transcript_segments'>) {
  return createHash('sha256')
    .update(video.transcript_text ?? '')
    .update('\n')
    .update(JSON.stringify(video.transcript_segments ?? []))
    .digest('hex');
}

export async function listYoutubePreproductionCandidates(
  input: {
    limit?: number;
    includeReady?: boolean;
    missingTranscriptOnly?: boolean;
    generatorVersion?: string;
    videoId?: string;
  } = {},
) {
  const limit = Math.max(1, Math.min(10_000, Math.floor(input.limit ?? 10_000)));
  return (
    await query<YoutubePreproductionCandidate>(
      `select yv.*,script.status preproduction_status,script.transcript_hash preproduction_hash,
              script.generator_version preproduction_generator_version,
              script.production_model preproduction_production_model
       from youtube_videos yv
       left join youtube_preproduced_scripts script on script.youtube_video_id=yv.id
       where yv.deleted_at is null and yv.enabled=true
         and ($1::boolean=false or yv.transcript_status<>'ready')
         and ($4::uuid is null or yv.id=$4::uuid)
         and ($4::uuid is not null or script.status is null or script.status<>'error' or script.updated_at<now()-interval '10 minutes')
         and (
           $2::boolean=true
           or script.id is null
           or script.status<>'ready'
           or ($3::text<>'' and script.generator_version<>$3)
           or script.updated_at<coalesce(yv.transcript_fetched_at,yv.updated_at)
         )
       order by
         exists(
           select 1 from playback_state playback
           where playback.id=true
             and playback.state->>'youtubeVideoId'=yv.video_id
             and playback.state->>'status' in ('preparing','playing','paused')
         ) desc,
         exists(
           select 1 from broadcast_items item
           join broadcast_playlists playlist on playlist.id=item.playlist_id
           where item.rules->>'youtubeLibraryId'=yv.id::text
             and item.status in ('planned','preparing','playing')
             and playlist.status in ('draft','scheduled','starting','running','paused','recovering')
         ) desc,
         case yv.transcript_status when 'ready' then 0 when 'pending' then 1 else 2 end,
         yv.duration_seconds asc,
         yv.updated_at desc
       limit $5`,
      [
        input.missingTranscriptOnly === true,
        input.includeReady === true,
        input.generatorVersion?.trim() ?? '',
        input.videoId?.trim() || null,
        limit,
      ],
    )
  ).rows;
}

export async function markYoutubePreproductionStatus(
  youtubeVideoId: string,
  status: YoutubePreproducedScript['status'],
  error?: string | null,
  generatorVersion?: string | null,
) {
  return (
    await query<YoutubePreproducedScript>(
      `insert into youtube_preproduced_scripts(youtube_video_id,status,error,generator_version,updated_at)
       values($1,$2,$3,coalesce(nullif($4,''),'pending'),now())
       on conflict(youtube_video_id) do update
       set status=excluded.status,error=excluded.error,
           generator_version=coalesce(nullif($4,''),youtube_preproduced_scripts.generator_version),updated_at=now()
       returning *`,
      [youtubeVideoId, status, error?.slice(0, 1_500) ?? null, generatorVersion?.slice(0, 80) ?? null],
    )
  ).rows[0];
}

export async function saveYoutubePreproducedScript(input: {
  youtubeVideoId: string;
  transcriptHash: string;
  generatorVersion: string;
  productionModel: string;
  editorialSummary: string;
  durationMs: number;
  cues: YoutubePreproducedCueDraft[];
}) {
  return transaction(async (client) => {
    const script = (
      await client.query<YoutubePreproducedScript>(
        `insert into youtube_preproduced_scripts(
           youtube_video_id,status,transcript_hash,generator_version,production_model,editorial_summary,
           cue_count,duration_ms,error,generated_at,updated_at
         ) values($1,'processing',$2,$3,$4,$5,0,$6,null,null,now())
         on conflict(youtube_video_id) do update
         set status='processing',transcript_hash=excluded.transcript_hash,
             generator_version=excluded.generator_version,production_model=excluded.production_model,
             editorial_summary=excluded.editorial_summary,duration_ms=excluded.duration_ms,
             cue_count=0,error=null,updated_at=now()
         returning *`,
        [
          input.youtubeVideoId,
          input.transcriptHash,
          input.generatorVersion.slice(0, 80),
          input.productionModel.slice(0, 180),
          input.editorialSummary.slice(0, 1_800),
          Math.max(0, Math.floor(input.durationMs)),
        ],
      )
    ).rows[0]!;
    await client.query('delete from youtube_preproduced_cues where script_id=$1', [script.id]);
    const normalized = input.cues
      .filter(
        (cue) =>
          cue.speakerText.trim().length >= 10 &&
          cue.audioPath.trim().length > 0 &&
          Number.isFinite(cue.audioDurationSeconds) &&
          cue.audioDurationSeconds > 0 &&
          cue.aiTier === 'codex' &&
          cue.aiModel.startsWith('codex-cli'),
      )
      .sort((left, right) => left.atMs - right.atMs)
      .slice(0, 5_000);
    for (const [position, cue] of normalized.entries()) {
      await client.query(
        `insert into youtube_preproduced_cues(
           script_id,position,at_ms,end_ms,presenter_id,kind,responds_to_presenter_id,
           handoff_to_presenter_id,discussion_move,display_mode,headline,speaker_text,
           audience_prompt,source_excerpt,source_start_ms,source_end_ms,wit,
           audio_path,audio_duration_seconds,ai_model,ai_tier,tts_engine,tts_voice
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [
          script.id,
          position,
          Math.max(0, Math.floor(cue.atMs)),
          cue.endMs == null ? null : Math.max(Math.floor(cue.atMs), Math.floor(cue.endMs)),
          cue.presenterId,
          cue.kind,
          cue.respondsToPresenterId?.trim().slice(0, 80) || null,
          cue.handoffToPresenterId?.trim().slice(0, 80) || null,
          cue.discussionMove?.trim().slice(0, 40) || null,
          cue.displayMode,
          cue.headline.trim().slice(0, 180),
          cue.speakerText.trim().slice(0, 1_800),
          cue.audiencePrompt?.trim().slice(0, 360) || null,
          cue.sourceExcerpt?.trim().slice(0, 1_200) || null,
          cue.sourceStartMs == null ? null : Math.max(0, Math.floor(cue.sourceStartMs)),
          cue.sourceEndMs == null ? null : Math.max(0, Math.floor(cue.sourceEndMs)),
          cue.wit === true,
          cue.audioPath,
          cue.audioDurationSeconds,
          cue.aiModel,
          cue.aiTier,
          cue.ttsEngine,
          cue.ttsVoice,
        ],
      );
    }
    const distinctTimes = [...new Set(normalized.map((cue) => Math.floor(cue.atMs)))];
    const gapsAreDense = distinctTimes.every(
      (atMs, index) =>
        index === 0 || (atMs - distinctTimes[index - 1]! >= 20_000 && atMs - distinctTimes[index - 1]! <= 40_000),
    );
    const sixModerators = new Set(
      normalized.filter((cue) => cue.presenterId !== 'translator').map((cue) => cue.presenterId),
    );
    const discussionComplete = normalized.every(
      (cue) =>
        cue.presenterId === 'translator' ||
        ((cue.kind === 'intro' || Boolean(cue.respondsToPresenterId)) &&
          (cue.kind === 'closing' || Boolean(cue.handoffToPresenterId)) &&
          Boolean(cue.discussionMove)),
    );
    const ready =
      normalized.length >= 3 &&
      input.generatorVersion === YOUTUBE_STRICT_GENERATOR_VERSION &&
      input.productionModel.startsWith('codex-cli') &&
      distinctTimes[0] === 0 &&
      distinctTimes.at(-1)! >= Math.max(0, input.durationMs - 40_000) &&
      gapsAreDense &&
      ['moderator', 'presenter-leon', 'presenter-lea', 'presenter-jonas', 'chat-moderator', 'presenter-karim'].every(
        (presenterId) => sixModerators.has(presenterId),
      ) &&
      discussionComplete;
    return (
      await client.query<YoutubePreproducedScript>(
        `update youtube_preproduced_scripts
         set status=case when $3 then 'ready' else 'partial' end,
             cue_count=$2,error=case when $3 then null else 'Codex-Manuskript oder TTS-Paket ist unvollständig.' end,
             generated_at=now(),updated_at=now()
         where id=$1 returning *`,
        [script.id, normalized.length, ready],
      )
    ).rows[0]!;
  });
}

export async function getYoutubePreproducedScript(youtubeVideoId: string) {
  const script = (
    await query<YoutubePreproducedScript>(
      `select * from youtube_preproduced_scripts
       where youtube_video_id=$1 and status='ready'
         and youtube_preproduced_script_is_broadcast_ready(youtube_preproduced_scripts.id)
         and generator_version='codex-cli-complete-show-discussion-20-40-v2'
         and production_model like 'codex-cli%'
         and cue_count>=3
         and not exists(
           select 1 from youtube_preproduced_cues cue
           where cue.script_id=youtube_preproduced_scripts.id
             and (coalesce(cue.audio_path,'')='' or coalesce(cue.audio_duration_seconds,0)<=0
                  or cue.ai_tier<>'codex' or cue.ai_model not like 'codex-cli%')
         )`,
      [youtubeVideoId],
    )
  ).rows[0];
  if (!script) return null;
  script.cues = (
    await query<YoutubePreproducedCue>(`select * from youtube_preproduced_cues where script_id=$1 order by position`, [
      script.id,
    ])
  ).rows;
  return script;
}

export async function listYoutubeVideosWithReadyPreproduction() {
  return (
    await query<YoutubeVideoRecord>(
      `select video.*
       from youtube_videos video
       join youtube_preproduced_scripts script on script.youtube_video_id=video.id
       where video.deleted_at is null and video.enabled=true
         and script.status='ready'
         and youtube_preproduced_script_is_broadcast_ready(script.id)
         and script.generator_version='codex-cli-complete-show-discussion-20-40-v2'
         and script.production_model like 'codex-cli%'
         and script.cue_count>=3
         and not exists(
           select 1 from youtube_preproduced_cues cue
           where cue.script_id=script.id
             and (coalesce(cue.audio_path,'')='' or coalesce(cue.audio_duration_seconds,0)<=0
                  or cue.ai_tier<>'codex' or cue.ai_model not like 'codex-cli%')
         )
       order by video.updated_at desc`,
    )
  ).rows;
}

export async function claimYoutubePreproducedCue(input: {
  youtubeVideoId: string;
  runKey: string;
  broadcastItemId?: string | null;
  mediaPositionMs: number;
}) {
  return transaction(async (client) => {
    const due = (
      await client.query<YoutubePreproducedCue>(
        `with due_anchor as (
           select min(cue.at_ms) at_ms
           from youtube_preproduced_cues cue
           join youtube_preproduced_scripts script on script.id=cue.script_id
           where script.youtube_video_id=$1 and script.status='ready'
             and youtube_preproduced_script_is_broadcast_ready(script.id)
             and script.generator_version='codex-cli-complete-show-discussion-20-40-v2'
             and script.production_model like 'codex-cli%'
             and cue.audio_path is not null and cue.audio_duration_seconds>0
             and (
               cue.at_ms<=$2
               or exists(
                 select 1
                 from youtube_preproduced_cues started_sibling
                 join youtube_preproduced_cue_runs started_run on started_run.cue_id=started_sibling.id
                 where started_sibling.script_id=cue.script_id
                   and started_sibling.at_ms=cue.at_ms
                   and started_run.run_key=$3
               )
             )
             and not exists(
               select 1 from youtube_preproduced_cue_runs run
               where run.cue_id=cue.id and run.run_key=$3
             )
         )
         select cue.*
         from youtube_preproduced_cues cue
         join youtube_preproduced_scripts script on script.id=cue.script_id
         join due_anchor on due_anchor.at_ms=cue.at_ms
         where script.youtube_video_id=$1 and script.status='ready'
           and youtube_preproduced_script_is_broadcast_ready(script.id)
           and script.generator_version='codex-cli-complete-show-discussion-20-40-v2'
           and script.production_model like 'codex-cli%'
           and cue.audio_path is not null and cue.audio_duration_seconds>0
           and not exists(
             select 1 from youtube_preproduced_cue_runs run
             where run.cue_id=cue.id and run.run_key=$3
           )
         order by cue.position
         limit 1
         for update of cue skip locked`,
        [input.youtubeVideoId, Math.max(0, Math.floor(input.mediaPositionMs)) + 250, input.runKey],
      )
    ).rows[0];
    if (!due) return null;
    await client.query(
      `insert into youtube_preproduced_cue_runs(cue_id,run_key,broadcast_item_id,status,completed_at)
       values($1,$2,$3,'claimed',null)
       on conflict(cue_id,run_key) do nothing`,
      [due.id, input.runKey.slice(0, 240), input.broadcastItemId ?? null],
    );
    return due;
  });
}

export async function hasPendingYoutubePreproducedCueInGroup(cueId: string, runKey: string) {
  return Boolean(
    (
      await query<{ pending: boolean }>(
        `select exists(
           select 1
           from youtube_preproduced_cues current
           join youtube_preproduced_cues sibling
             on sibling.script_id=current.script_id and sibling.at_ms=current.at_ms
           where current.id=$1
             and not exists(
               select 1 from youtube_preproduced_cue_runs run
               where run.cue_id=sibling.id and run.run_key=$2
             )
         ) pending`,
        [cueId, runKey],
      )
    ).rows[0]?.pending,
  );
}

export async function hasIncompleteYoutubePreproducedCues(scriptId: string, runKey: string) {
  return Boolean(
    (
      await query<{ pending: boolean }>(
        `select exists(
           select 1
           from youtube_preproduced_cues cue
           where cue.script_id=$1
             and not exists(
               select 1
               from youtube_preproduced_cue_runs run
               where run.cue_id=cue.id and run.run_key=$2 and run.status='completed'
             )
         ) pending`,
        [scriptId, runKey],
      )
    ).rows[0]?.pending,
  );
}

export async function completeYoutubePreproducedCue(
  cueId: string,
  runKey: string,
  status: 'completed' | 'failed' = 'completed',
) {
  await query(
    `update youtube_preproduced_cue_runs
     set status=$3,completed_at=now()
     where cue_id=$1 and run_key=$2`,
    [cueId, runKey, status],
  );
}

export async function releaseYoutubePreproducedCue(cueId: string, runKey: string) {
  await query(
    `delete from youtube_preproduced_cue_runs
     where cue_id=$1 and run_key=$2 and status='claimed'`,
    [cueId, runKey],
  );
}

export async function youtubePreproductionSummary() {
  return (
    await query<{
      total: number;
      ready: number;
      pending: number;
      unavailable: number;
      error: number;
      cues: number;
    }>(
      `select
         count(*)::int total,
         count(*) filter(where status='ready')::int ready,
         count(*) filter(where status in ('pending','processing','partial'))::int pending,
         count(*) filter(where status='unavailable')::int unavailable,
         count(*) filter(where status='error')::int error,
         coalesce(sum(cue_count),0)::int cues
       from youtube_preproduced_scripts`,
    )
  ).rows[0]!;
}
