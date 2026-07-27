import { createHash } from 'node:crypto';
import { query, transaction, type YoutubeVideoRecord } from './index.js';

export type YoutubePreproducedCueKind =
  | 'intro'
  | 'context'
  | 'reaction'
  | 'fact-check'
  | 'question'
  | 'closing';

export type YoutubePreproducedCueDraft = {
  atMs: number;
  endMs?: number | null;
  presenterId: string;
  kind: YoutubePreproducedCueKind;
  displayMode: 'inline' | 'takeover';
  headline: string;
  speakerText: string;
  audiencePrompt?: string | null;
  sourceExcerpt?: string | null;
  sourceStartMs?: number | null;
  sourceEndMs?: number | null;
  wit?: boolean;
};

export type YoutubePreproducedCue = {
  id: string;
  script_id: string;
  position: number;
  at_ms: number | string;
  end_ms: number | string | null;
  presenter_id: string;
  kind: YoutubePreproducedCueKind;
  display_mode: 'inline' | 'takeover';
  headline: string;
  speaker_text: string;
  audience_prompt: string | null;
  source_excerpt: string | null;
  source_start_ms: number | string | null;
  source_end_ms: number | string | null;
  wit: boolean;
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
  generated_at: string | null;
  cues: YoutubePreproducedCue[];
};

export type YoutubePreproductionCandidate = YoutubeVideoRecord & {
  preproduction_status: YoutubePreproducedScript['status'] | null;
  preproduction_hash: string | null;
  preproduction_generator_version: string | null;
};

export function youtubeTranscriptHash(video: Pick<YoutubeVideoRecord, 'transcript_text' | 'transcript_segments'>) {
  return createHash('sha256')
    .update(video.transcript_text ?? '')
    .update('\n')
    .update(JSON.stringify(video.transcript_segments ?? []))
    .digest('hex');
}

export async function listYoutubePreproductionCandidates(input: {
  limit?: number;
  includeReady?: boolean;
  missingTranscriptOnly?: boolean;
} = {}) {
  const limit = Math.max(1, Math.min(10_000, Math.floor(input.limit ?? 10_000)));
  return (
    await query<YoutubePreproductionCandidate>(
      `select yv.*,script.status preproduction_status,script.transcript_hash preproduction_hash,
              script.generator_version preproduction_generator_version
       from youtube_videos yv
       left join youtube_preproduced_scripts script on script.youtube_video_id=yv.id
       where yv.deleted_at is null and yv.enabled=true
         and ($1::boolean=false or yv.transcript_status<>'ready')
         and (
           $2::boolean=true
           or script.id is null
           or script.status<>'ready'
           or script.updated_at<coalesce(yv.transcript_fetched_at,yv.updated_at)
         )
       order by
         case yv.transcript_status when 'ready' then 0 when 'pending' then 1 else 2 end,
         yv.updated_at desc
       limit $3`,
      [input.missingTranscriptOnly === true, input.includeReady === true, limit],
    )
  ).rows;
}

export async function markYoutubePreproductionStatus(
  youtubeVideoId: string,
  status: YoutubePreproducedScript['status'],
  error?: string | null,
) {
  return (
    await query<YoutubePreproducedScript>(
      `insert into youtube_preproduced_scripts(youtube_video_id,status,error,updated_at)
       values($1,$2,$3,now())
       on conflict(youtube_video_id) do update
       set status=excluded.status,error=excluded.error,updated_at=now()
       returning *`,
      [youtubeVideoId, status, error?.slice(0, 1_500) ?? null],
    )
  ).rows[0];
}

export async function saveYoutubePreproducedScript(input: {
  youtubeVideoId: string;
  transcriptHash: string;
  generatorVersion: string;
  durationMs: number;
  cues: YoutubePreproducedCueDraft[];
}) {
  return transaction(async (client) => {
    const script = (
      await client.query<YoutubePreproducedScript>(
        `insert into youtube_preproduced_scripts(
           youtube_video_id,status,transcript_hash,generator_version,cue_count,duration_ms,error,generated_at,updated_at
         ) values($1,'processing',$2,$3,0,$4,null,null,now())
         on conflict(youtube_video_id) do update
         set status='processing',transcript_hash=excluded.transcript_hash,
             generator_version=excluded.generator_version,duration_ms=excluded.duration_ms,
             cue_count=0,error=null,updated_at=now()
         returning *`,
        [
          input.youtubeVideoId,
          input.transcriptHash,
          input.generatorVersion.slice(0, 80),
          Math.max(0, Math.floor(input.durationMs)),
        ],
      )
    ).rows[0]!;
    await client.query('delete from youtube_preproduced_cues where script_id=$1', [script.id]);
    const normalized = input.cues
      .filter((cue) => cue.speakerText.trim().length >= 10)
      .sort((left, right) => left.atMs - right.atMs)
      .slice(0, 120);
    for (const [position, cue] of normalized.entries()) {
      await client.query(
        `insert into youtube_preproduced_cues(
           script_id,position,at_ms,end_ms,presenter_id,kind,display_mode,headline,speaker_text,
           audience_prompt,source_excerpt,source_start_ms,source_end_ms,wit
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          script.id,
          position,
          Math.max(0, Math.floor(cue.atMs)),
          cue.endMs == null ? null : Math.max(Math.floor(cue.atMs), Math.floor(cue.endMs)),
          cue.presenterId,
          cue.kind,
          cue.displayMode,
          cue.headline.trim().slice(0, 180),
          cue.speakerText.trim().slice(0, 1_800),
          cue.audiencePrompt?.trim().slice(0, 360) || null,
          cue.sourceExcerpt?.trim().slice(0, 1_200) || null,
          cue.sourceStartMs == null ? null : Math.max(0, Math.floor(cue.sourceStartMs)),
          cue.sourceEndMs == null ? null : Math.max(0, Math.floor(cue.sourceEndMs)),
          cue.wit === true,
        ],
      );
    }
    return (
      await client.query<YoutubePreproducedScript>(
        `update youtube_preproduced_scripts
         set status=case when $2>0 then 'ready' else 'unavailable' end,
             cue_count=$2,error=case when $2>0 then null else 'Kein sendefähiger Cue erzeugt.' end,
             generated_at=now(),updated_at=now()
         where id=$1 returning *`,
        [script.id, normalized.length],
      )
    ).rows[0]!;
  });
}

export async function getYoutubePreproducedScript(youtubeVideoId: string) {
  const script = (
    await query<YoutubePreproducedScript>(
      `select * from youtube_preproduced_scripts
       where youtube_video_id=$1 and status='ready'`,
      [youtubeVideoId],
    )
  ).rows[0];
  if (!script) return null;
  script.cues = (
    await query<YoutubePreproducedCue>(
      `select * from youtube_preproduced_cues where script_id=$1 order by position`,
      [script.id],
    )
  ).rows;
  return script;
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
           select max(cue.at_ms) at_ms
           from youtube_preproduced_cues cue
           join youtube_preproduced_scripts script on script.id=cue.script_id
           where script.youtube_video_id=$1 and script.status='ready'
             and cue.at_ms<=$2
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
       select cue.id,$2,$3,
              case when cue.id=$4 then 'claimed' else 'skipped' end,
              case when cue.id=$4 then null else now() end
       from youtube_preproduced_cues cue
       where cue.script_id=$1 and (cue.id=$4 or cue.at_ms<$5)
         and not exists(
           select 1 from youtube_preproduced_cue_runs run
           where run.cue_id=cue.id and run.run_key=$2
         )
       on conflict(cue_id,run_key) do nothing`,
      [
        due.script_id,
        input.runKey.slice(0, 240),
        input.broadcastItemId ?? null,
        due.id,
        Number(due.at_ms),
      ],
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
