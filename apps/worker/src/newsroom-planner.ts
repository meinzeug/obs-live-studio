import { createHash } from 'node:crypto';
import { planAutonomousNewsroom, type NewsroomPlanAiOutput } from '@ans/ai-provider';
import {
  addBroadcastYoutubeContextItem,
  createAutopilotBroadcastPlaylist,
  getSetting,
  listBroadcastCandidateArticles,
  query,
  transaction,
  type AutopilotDailyFormat,
  type YoutubeVideoRecord,
} from '@ans/database';
import { recordAiStaffActivity } from '@ans/database/ai-staff';
import { resolveOperationalNotification, upsertOperationalNotification } from '@ans/database/notifications';
import { listYoutubeVideosWithReadyPreproduction } from '@ans/database/youtube-preproduction';
import { contextRuntimeForFormat, currentChannelIdentity, sidebarNewsFromArticleIds } from './autopilot.js';

type Log = (event: string, extra?: Record<string, unknown>) => void;
type NewsroomSlot = NewsroomPlanAiOutput['slots'][number];

const SIX_AGENT_ROSTER = [
  'moderator',
  'chat-moderator',
  'presenter-lea',
  'presenter-leon',
  'presenter-jonas',
  'presenter-karim',
] as const;
const ENSEMBLE_CO_HOSTS = ['presenter-lea', 'presenter-leon', 'presenter-jonas', 'presenter-karim'] as const;
const ROUNDTABLE_FORMATS = new Set([
  'ai-roundtable-publikumsforum',
  'ai-roundtable-studio',
  'ai-roundtable-fakten-duell',
]);

function compactError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 1800);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback;
}

function uniqueKnownIds(ids: string[], known: Set<string>, maximum: number) {
  return [...new Set(ids.filter((id) => known.has(id)))].slice(0, maximum);
}

/**
 * Die Chefredaktion entscheidet Themen und Formate. Diese Senderleitplanken
 * stellen zusätzlich sicher, dass Publikumsforen und echte Rundtische nicht
 * wieder aus einem formal gültigen Plan herausoptimiert werden.
 */
export function enforceNewsroomFormatQuotas(slots: NewsroomSlot[]) {
  const normalized = slots.map((slot) => ({ ...slot }));
  let forumCount = normalized.filter((slot) => slot.formatSystemKey === 'ai-roundtable-publikumsforum').length;
  for (const index of [0, 3, 6, 9, 1, 4, 7, 10]) {
    if (forumCount >= 4 || !normalized[index]) break;
    if (normalized[index]!.formatSystemKey === 'ai-roundtable-publikumsforum') continue;
    normalized[index] = { ...normalized[index]!, formatSystemKey: 'ai-roundtable-publikumsforum' };
    forumCount += 1;
  }
  let roundtableCount = normalized.filter((slot) => ROUNDTABLE_FORMATS.has(slot.formatSystemKey)).length;
  const rotation = ['ai-roundtable-studio', 'ai-roundtable-fakten-duell'] as const;
  for (const [position, index] of [1, 4, 7, 10, 2, 5, 8, 11].entries()) {
    if (roundtableCount >= 8 || !normalized[index]) break;
    if (ROUNDTABLE_FORMATS.has(normalized[index]!.formatSystemKey)) continue;
    normalized[index] = { ...normalized[index]!, formatSystemKey: rotation[position % rotation.length]! };
    roundtableCount += 1;
  }
  return normalized;
}

export function enforceNoAdjacentVideoRepetition(slots: NewsroomSlot[]) {
  for (const slot of slots) {
    for (let index = 1; index < slot.videoIds.length; index += 1) {
      if (slot.videoIds[index] === slot.videoIds[index - 1]) {
        throw new Error('Codex-Sendeplan enthält dasselbe Video zweimal unmittelbar innerhalb eines Blocks.');
      }
    }
  }
  const completed = new Map<string, NewsroomSlot[] | null>();
  const search = (
    remaining: Array<{ slot: NewsroomSlot; originalIndex: number }>,
    previousVideoId: string | null,
  ): NewsroomSlot[] | null => {
    if (!remaining.length) return [];
    const signature = `${previousVideoId ?? '-'}:${remaining.map((entry) => entry.originalIndex).join(',')}`;
    if (completed.has(signature)) return completed.get(signature)!;
    for (const [index, entry] of remaining.entries()) {
      const candidate = entry.slot;
      if (previousVideoId && candidate.videoIds[0] === previousVideoId) continue;
      const tail = search(
        remaining.filter((_, remainingIndex) => remainingIndex !== index),
        candidate.videoIds.at(-1) ?? previousVideoId,
      );
      if (tail) {
        const ordered = [candidate, ...tail];
        completed.set(signature, ordered);
        return ordered;
      }
    }
    completed.set(signature, null);
    return null;
  };
  const ordered = search(
    slots.map((slot, originalIndex) => ({ slot, originalIndex })),
    null,
  );
  if (!ordered) throw new Error('Codex-Sendeplan kann dieselben Videos nicht ohne unmittelbare Wiederholung anordnen.');
  return ordered;
}

function normalizedPlan(
  plan: NewsroomPlanAiOutput,
  videoIds: Set<string>,
  articleIds: Set<string>,
): NewsroomPlanAiOutput {
  if (plan.slots.length !== 12)
    throw new Error('Codex CLI muss genau zwölf aufeinanderfolgende Sendungsblöcke planen.');
  const slots = enforceNewsroomFormatQuotas(plan.slots).map((slot, index) => {
    const knownVideos = uniqueKnownIds(slot.videoIds, videoIds, 4);
    const knownArticles = uniqueKnownIds(slot.articleIds, articleIds, 10);
    if (!knownVideos.length)
      throw new Error(`Codex-Sendeplatz ${index + 1} enthält kein bekanntes vollständig vorproduziertes Video.`);
    if (!knownArticles.length)
      throw new Error(`Codex-Sendeplatz ${index + 1} enthält keinen bekannten freigegebenen Nachrichtenbeitrag.`);
    return { ...slot, videoIds: knownVideos, articleIds: knownArticles };
  });
  return { ...plan, slots: enforceNoAdjacentVideoRepetition(slots) };
}

function roundedFirstStart(startImmediately: boolean) {
  if (startImmediately) return new Date();
  const start = new Date(Date.now() + 10 * 60_000);
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(Math.ceil(start.getUTCMinutes() / 5) * 5);
  return start;
}

type VideoProductionEvidence = {
  youtube_video_id: string;
  editorial_summary: string | null;
  production_model: string | null;
  presenter_ids: string[];
  cue_count: number;
  audio_duration_seconds: number;
};

function slotRuntimeMinutes(
  slot: NewsroomSlot,
  videos: Map<string, YoutubeVideoRecord>,
  productionByVideo: Map<string, VideoProductionEvidence>,
) {
  const estimatedSeconds = slot.videoIds.reduce((sum, id) => {
    const production = productionByVideo.get(id);
    const videoSeconds = Math.max(1, Number(videos.get(id)?.duration_seconds ?? 0));
    const speechSeconds = Math.max(0, Number(production?.audio_duration_seconds ?? 0));
    const transitionSeconds = Math.max(0, Number(production?.cue_count ?? 0)) * 4;
    return sum + videoSeconds + speechSeconds + transitionSeconds;
  }, 0);
  return Math.max(5, Math.min(120, Math.ceil((estimatedSeconds * 1.25) / 60) + 1));
}

async function newsroomEvidence() {
  const [videos, articles, audienceSignals, currentProgram, previousPlan, videoProduction] = await Promise.all([
    listYoutubeVideosWithReadyPreproduction(),
    listBroadcastCandidateArticles(160),
    query<{ author_name: string; message: string; published_at: string }>(
      `select author_name,message,published_at
       from ai_host_chat_messages
       where safe=true and received_at>now()-interval '6 hours'
       order by published_at desc limit 30`,
    ).then((result) => result.rows),
    query<{ id: string; name: string; format: string | null; item_title: string | null }>(
      `select playlist.id,playlist.name,playlist.settings->>'formatSystemKey' format,
              item.rules->>'title' item_title
       from broadcast_runs run
       join broadcast_playlists playlist on playlist.id=run.playlist_id
       left join lateral (
         select candidate.rules
         from broadcast_items candidate
         where candidate.playlist_id=playlist.id
         order by
           case candidate.status when 'playing' then 0 when 'preparing' then 1 else 2 end,
           abs(candidate.position-playlist.current_position),candidate.position
         limit 1
       ) item on true
       where run.status in ('starting','running','paused','recovering')
       order by run.started_at desc limit 1`,
    ).then((result) => result.rows[0] ?? null),
    query<{ plan: Record<string, unknown> }>(
      `select plan from codex_newsroom_plans where status='active' order by generated_at desc limit 1`,
    ).then((result) => result.rows[0]?.plan ?? null),
    query<VideoProductionEvidence>(
      `select script.youtube_video_id,script.editorial_summary,script.production_model,
              array_agg(distinct cue.presenter_id order by cue.presenter_id) presenter_ids,
              count(*)::int cue_count,
              coalesce(sum(cue.audio_duration_seconds),0)::float8 audio_duration_seconds
       from youtube_preproduced_scripts script
       join youtube_preproduced_cues cue on cue.script_id=script.id
       where script.status='ready'
         and youtube_preproduced_script_is_broadcast_ready(script.id)
         and script.generator_version='codex-cli-complete-show-discussion-20-40-v2'
         and script.production_model like 'codex-cli%'
       group by script.youtube_video_id,script.editorial_summary,script.production_model`,
    ).then((result) => result.rows),
  ]);
  const productionByVideo = new Map(videoProduction.map((entry) => [entry.youtube_video_id, entry]));
  return {
    videos: videos.slice(0, 40),
    articles: articles.slice(0, 80),
    audienceSignals,
    currentProgram,
    previousPlan,
    productionByVideo,
  };
}

async function shouldPlan(force: boolean) {
  if (force) return true;
  const intervalMinutes = boundedInteger(process.env.CODEX_NEWSROOM_INTERVAL_MINUTES, 90, 15, 360);
  const state = (
    await query<{ generated_at: string; upcoming: number }>(
      `select plan.generated_at,
              (select count(*)::int from broadcast_playlists playlist
               where playlist.status='draft' and playlist.scheduled_at>now()
                 and playlist.settings->>'codexNewsroomPlanId'=plan.id::text) upcoming
       from codex_newsroom_plans plan
       where plan.status='active'
       order by plan.generated_at desc limit 1`,
    )
  ).rows[0];
  if (!state) return true;
  return Number(state.upcoming) < 5 || Date.now() - Date.parse(state.generated_at) >= intervalMinutes * 60_000;
}

async function materializePlan(
  planId: string,
  plan: NewsroomPlanAiOutput,
  videos: YoutubeVideoRecord[],
  channelName: string,
  log: Log,
  startImmediately: boolean,
  productionByVideo: Map<string, VideoProductionEvidence>,
) {
  const byVideoId = new Map(videos.map((video) => [video.id, video]));
  const createdPlaylistIds: string[] = [];
  let scheduledAt = roundedFirstStart(startImmediately);
  try {
    for (const [index, slot] of plan.slots.entries()) {
      const selectedVideos = slot.videoIds.map((id) => byVideoId.get(id)).filter(Boolean) as YoutubeVideoRecord[];
      const runtimeMinutes = slotRuntimeMinutes(slot, byVideoId, productionByVideo);
      const isRoundtable = ROUNDTABLE_FORMATS.has(slot.formatSystemKey);
      const format: AutopilotDailyFormat = {
        id: `codex-newsroom-${planId.slice(0, 8)}-${index + 1}`,
        name: slot.title,
        startTime: `${String(scheduledAt.getUTCHours()).padStart(2, '0')}:${String(scheduledAt.getUTCMinutes()).padStart(2, '0')}`,
        durationMinutes: runtimeMinutes,
        contentMode: isRoundtable ? 'ai-roundtable' : 'youtube-context',
        formatSystemKey: slot.formatSystemKey,
        youtubeCategoryIds: [],
        sourceIds: [],
        enabled: true,
      };
      const context = await contextRuntimeForFormat(format);
      const hostRoster = context.hostRoster.length === 6 ? context.hostRoster : [...SIX_AGENT_ROSTER];
      const coHostIds = context.coHostIds.length ? context.coHostIds : [...ENSEMBLE_CO_HOSTS];
      const news = await sidebarNewsFromArticleIds(slot.articleIds);
      const playlist = await createAutopilotBroadcastPlaylist(`${channelName} · ${slot.title}`, {
        description: `${slot.whyNow}\n\nRedaktioneller Blickwinkel: ${slot.editorialAngle}`.slice(0, 2000),
        scheduledAt: scheduledAt.toISOString(),
        kind: 'show',
        settings: {
          autopilot: true,
          autopilot24h: true,
          autopilotFormatId: format.id,
          codexNewsroom: true,
          codexNewsroomPlanId: planId,
          codexNewsroomSlot: index + 1,
          codexNewsroomModel: 'codex-cli',
          editorialPerspective: 'democratic-constitutional-patriotism-de',
          countryPerspective: 'Germany',
          identityPoliticsStance: 'critical',
          broadcastFormatSystemKey: context.formatSystemKey ?? slot.formatSystemKey,
          formatSystemKey: context.formatSystemKey ?? slot.formatSystemKey,
          contentMode: format.contentMode,
          youtubeContext: true,
          youtubeContextLayoutVariant: context.contextLayoutVariant,
          formatConcept: context.formatConcept,
          moderationIntent: slot.editorialAngle,
          editorialWhyNow: slot.whyNow,
          audienceQuestion: slot.audienceQuestion,
          avaRole: context.avaRole,
          miaRole: context.miaRole,
          samRole: context.samRole,
          coHostRole: context.coHostRole,
          coHostRoles: context.coHostRoles,
          hostChoreography: {
            ...context.hostChoreography,
            avaPrimary: false,
            ensemblePrimary: true,
            sixAgentEnsemble: true,
            coHostIds,
          },
          editorialSafety: context.editorialSafety,
          miaInteractionPrompt: slot.audienceQuestion,
          comedyMode: context.comedyMode,
          satireMode: context.satireMode,
          satireLabel: context.satireLabel,
          coHostId: context.coHostId,
          coHostIds,
          hostRoster,
          sixAgentEnsemble: true,
          liveStreamPriority: context.liveStreamPriority,
          aiRoundtable: isRoundtable,
          roundtablePreset: isRoundtable ? context.roundtablePreset : null,
          roundtableParticipantIds: [...SIX_AGENT_ROSTER],
          roundtableProductionSettings: {
            ...context.roundtableProductionSettings,
            fallbackMode: 'codex-retry',
            minimumParticipants: 6,
            showAllParticipants: true,
          },
          pauseSeconds: 3,
          transition: 'studio-sweep',
          repeatPolicy: 'codex-editorial-plan',
          targetRuntimeMinutes: runtimeMinutes,
        },
      });
      if (!playlist.created) throw new Error(`Sendeplatz ${index + 1} kollidiert mit ${playlist.reason}.`);
      createdPlaylistIds.push(playlist.playlist.id);
      for (const video of selectedVideos) {
        await addBroadcastYoutubeContextItem(
          playlist.playlist.id,
          {
            id: video.id,
            title: video.title,
            url: video.url,
            videoId: video.video_id,
            channelTitle: video.channel_title,
            categoryId: video.category_id,
            categoryName: video.category_name,
            durationSeconds: video.duration_seconds,
            sidebarRotationSeconds: 18,
          },
          {
            analysis: video.editorial_analysis_status === 'ready' ? (video.editorial_analysis as never) : null,
            analysisModel: video.editorial_analysis_model,
            fallbackReason: null,
            newsFallback: news,
            pauseDuringAva: true,
            formatSystemKey: context.formatSystemKey ?? slot.formatSystemKey,
            contextLayoutVariant: context.contextLayoutVariant,
            formatName: context.formatName || slot.title,
            formatConcept: context.formatConcept,
            moderationIntent: slot.editorialAngle,
            accentColor: context.accentColor,
            avaRole: context.avaRole,
            miaRole: context.miaRole,
            samRole: context.samRole,
            coHostRole: context.coHostRole,
            coHostRoles: context.coHostRoles,
            hostChoreography: {
              ...context.hostChoreography,
              avaPrimary: false,
              ensemblePrimary: true,
              sixAgentEnsemble: true,
              coHostIds,
            },
            editorialSafety: context.editorialSafety,
            miaInteractionPrompt: slot.audienceQuestion,
            comedyMode: context.comedyMode,
            satireMode: context.satireMode,
            satireLabel: context.satireLabel,
            coHostId: context.coHostId,
            coHostIds,
            hostRoster,
            liveStreamPriority: context.liveStreamPriority,
            aiRoundtable: isRoundtable,
            roundtablePreset: isRoundtable ? context.roundtablePreset : null,
            roundtableParticipantIds: [...SIX_AGENT_ROSTER],
            roundtableProductionSettings: {
              ...context.roundtableProductionSettings,
              fallbackMode: 'codex-retry',
              minimumParticipants: 6,
              showAllParticipants: true,
            },
          },
        );
      }
      log('codex_newsroom_slot_materialized', {
        planId,
        playlistId: playlist.playlist.id,
        slot: index + 1,
        formatSystemKey: slot.formatSystemKey,
        videoIds: slot.videoIds,
        articleIds: slot.articleIds,
        scheduledAt: scheduledAt.toISOString(),
      });
      scheduledAt = new Date(scheduledAt.getTime() + runtimeMinutes * 60_000);
    }
    return createdPlaylistIds;
  } catch (error) {
    if (createdPlaylistIds.length)
      await query(
        `update broadcast_playlists
         set status='interrupted',ended_at=coalesce(ended_at,now()),
             settings=jsonb_set(settings,'{scheduleReconciliation}','"incomplete-codex-newsroom-plan"'::jsonb,true)
         where id=any($1::uuid[]) and status='draft'`,
        [createdPlaylistIds],
      ).catch(() => null);
    throw error;
  }
}

export class CodexNewsroomPlanner {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stopped = false;

  constructor(
    private readonly workerId: string,
    private readonly log: Log,
  ) {}

  async start(intervalMs = 60_000) {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), Math.max(30_000, intervalMs));
    this.timer.unref?.();
    setTimeout(() => void this.tick(), 2_000).unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(force = false) {
    if (this.busy || this.stopped) return null;
    if ((await getSetting<boolean>('codex-newsroom.enabled').catch(() => false)) !== true) return null;
    if (!(await shouldPlan(force))) return null;
    this.busy = true;
    let planId: string | null = null;
    try {
      const locked = (
        await query<{ locked: boolean }>(`select pg_try_advisory_lock(hashtext('codex-newsroom-chief-editor')) locked`)
      ).rows[0]?.locked;
      if (!locked) return null;
      try {
        if (!(await shouldPlan(force))) return null;
        const evidence = await newsroomEvidence();
        if (!evidence.videos.length)
          throw new Error('Keine vollständig mit Codex CLI und TTS vorproduzierten Videos verfügbar.');
        if (!evidence.articles.length)
          throw new Error('Keine freigegebenen Nachrichten für die Lagebewertung verfügbar.');
        const fingerprint = createHash('sha256')
          .update(
            JSON.stringify({
              videos: evidence.videos.map((video) => [video.id, video.updated_at]),
              articles: evidence.articles.map((article) => [article.id, article.published_at, article.fetched_at]),
              audience: evidence.audienceSignals.map((signal) => [signal.message, signal.published_at]),
            }),
          )
          .digest('hex');
        planId = (
          await query<{ id: string }>(
            `insert into codex_newsroom_plans(status,input_fingerprint,news_snapshot,requested_by_system)
             values('planning',$1,$2,$3) returning id`,
            [
              fingerprint,
              {
                videos: evidence.videos.map((video) => video.id),
                articles: evidence.articles.map((article) => article.id),
                audienceSignals: evidence.audienceSignals.length,
                currentProgram: evidence.currentProgram,
              },
              this.workerId,
            ],
          )
        ).rows[0]!.id;
        const { channelName } = await currentChannelIdentity();
        const result = await planAutonomousNewsroom(
          {
            channelName,
            previousPlan: evidence.previousPlan,
            currentProgram: evidence.currentProgram,
            audienceSignals: evidence.audienceSignals.map((signal) => ({
              author: signal.author_name,
              message: signal.message,
              publishedAt: signal.published_at,
            })),
            articles: evidence.articles.map((article) => ({
              id: article.id,
              title: article.title,
              excerpt: article.summary ?? article.excerpt ?? article.main_text,
              category: article.category,
              region: article.region,
              source: article.source_name,
              trustScore: article.trust_score,
              publishedAt: article.published_at ?? article.fetched_at,
              warnings: article.warnings,
            })),
            videos: evidence.videos.map((video) => {
              const production = evidence.productionByVideo.get(video.id);
              return {
                id: video.id,
                title: video.title,
                channel: video.channel_title,
                description: video.description,
                category: video.category_name,
                durationSeconds: video.duration_seconds,
                publishedAt: video.published_at,
                editorialSummary: production?.editorial_summary,
                analysisModel: video.editorial_analysis_model,
                productionModel: production?.production_model,
                presenterIds: production?.presenter_ids ?? [],
              };
            }),
          },
          {
            env: {
              ...process.env,
              AI_PROVIDER: 'codex',
              OPENROUTER_FALLBACK: 'false',
              CODEX_CLI_FALLBACK: 'false',
            },
          },
        );
        if (result.tier !== 'codex' || !result.model.startsWith('codex-cli'))
          throw new Error(`Unzulässiges Chefredaktionsmodell: ${result.model}.`);
        const plan = normalizedPlan(
          result.output,
          new Set(evidence.videos.map((video) => video.id)),
          new Set(evidence.articles.map((article) => article.id)),
        );
        await query(
          `update codex_newsroom_plans
           set status='ready',plan=$2,model=$3,usage=$4,generated_at=now(),error=null,updated_at=now()
           where id=$1`,
          [planId, plan, result.model, result.usage],
        );
        const playlistIds = await materializePlan(
          planId,
          plan,
          evidence.videos,
          channelName,
          this.log,
          !evidence.currentProgram,
          evidence.productionByVideo,
        );
        await transaction(async (client) => {
          await client.query(
            `update codex_newsroom_plans
             set status='superseded',superseded_at=now(),updated_at=now()
             where status='active' and id<>$1`,
            [planId],
          );
          await client.query(
            `update codex_newsroom_plans
             set status='active',activated_at=now(),updated_at=now()
             where id=$1`,
            [planId],
          );
          await client.query(
            `update broadcast_playlists
             set status='interrupted',ended_at=coalesce(ended_at,now()),
                 settings=jsonb_set(settings,'{scheduleReconciliation}','"superseded-by-codex-chief-editor"'::jsonb,true)
             where status='draft' and scheduled_at>now()
               and coalesce((settings->>'autopilot24h')::boolean,false)=true
               and settings->>'codexNewsroomPlanId' is distinct from $1`,
            [planId],
          );
        });
        await Promise.all(
          SIX_AGENT_ROSTER.map((staffMemberId) =>
            recordAiStaffActivity({
              staffMemberId,
              eventType: 'codex_newsroom_plan_assigned',
              title: `${plan.title} · zwölf Sendungsblöcke`,
              detail: plan.newsAssessment,
              status: 'planned',
              metadata: {
                planId,
                model: result.model,
                playlistIds,
                forumSlots: plan.slots.filter((slot) => slot.formatSystemKey === 'ai-roundtable-publikumsforum').length,
                roundtableSlots: plan.slots.filter((slot) => ROUNDTABLE_FORMATS.has(slot.formatSystemKey)).length,
              },
            }),
          ),
        );
        await resolveOperationalNotification('codex-newsroom:planning').catch(() => null);
        this.log('codex_newsroom_plan_activated', {
          planId,
          model: result.model,
          playlistIds,
          title: plan.title,
        });
        return { planId, playlistIds, model: result.model };
      } finally {
        await query(`select pg_advisory_unlock(hashtext('codex-newsroom-chief-editor'))`).catch(() => null);
      }
    } catch (error) {
      const message = compactError(error);
      if (planId)
        await query(`update codex_newsroom_plans set status='error',error=$2,updated_at=now() where id=$1`, [
          planId,
          message,
        ]).catch(() => null);
      await upsertOperationalNotification({
        level: 'error',
        component: 'codex-newsroom',
        dedupeKey: 'codex-newsroom:planning',
        message: 'Die Codex-CLI-Chefredaktion konnte noch keinen neuen geprüften Sendeplan aktivieren.',
        details: { error: message, planId, automaticRetry: true, localFallback: false },
      }).catch(() => null);
      this.log('codex_newsroom_plan_failed', { planId, error: message, automaticRetry: true });
      return null;
    } finally {
      this.busy = false;
    }
  }
}
