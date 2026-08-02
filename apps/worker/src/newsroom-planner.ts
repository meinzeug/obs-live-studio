import { createHash } from 'node:crypto';
import {
  planAutonomousNewsroom,
  type NewsroomPlanAiOutput,
  type NewsroomReadyPlanAiOutput,
  type NewsroomSlotAiOutput,
} from '@ans/ai-provider';
import {
  addBroadcastYoutubeContextItem,
  createAutopilotBroadcastPlaylist,
  getSetting,
  listBroadcastCandidateArticles,
  pool,
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
type NewsroomSlot = NewsroomSlotAiOutput;

const GERMAN_BROADCAST_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function isCurrentGermanBroadcastDay(value: unknown, now = new Date()) {
  if (!value) return false;
  const candidate = value instanceof Date ? value : new Date(String(value));
  return (
    Number.isFinite(candidate.getTime()) && GERMAN_BROADCAST_DAY.format(candidate) === GERMAN_BROADCAST_DAY.format(now)
  );
}

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

export function newsroomDiscussionSettings(formatSystemKey: NewsroomSlot['formatSystemKey']) {
  const roundtablePreset =
    formatSystemKey === 'ai-roundtable-publikumsforum'
      ? ('publikumsforum' as const)
      : formatSystemKey === 'ai-roundtable-fakten-duell'
        ? ('fakten-duell' as const)
        : ('studio-rundtisch' as const);
  return {
    contentMode: 'ai-roundtable' as const,
    aiRoundtable: true as const,
    roundtablePreset,
    roundtableParticipantIds: [...SIX_AGENT_ROSTER],
  };
}

function compactError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 1800);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback;
}

/**
 * Die Chefredaktion entscheidet Themen und Formate. Diese Senderleitplanken
 * stellen zusätzlich sicher, dass Publikumsforen und echte Rundtische nicht
 * wieder aus einem formal gültigen Plan herausoptimiert werden.
 */
export function enforceNewsroomFormatQuotas(slots: NewsroomSlot[]) {
  const normalized = slots.map((slot) => ({ ...slot }));
  const forumTarget = Math.ceil(normalized.length / 3);
  const roundtableTarget = Math.ceil((normalized.length * 2) / 3);
  let forumCount = normalized.filter((slot) => slot.formatSystemKey === 'ai-roundtable-publikumsforum').length;
  const forumOrder = [0, 1, 2].flatMap((offset) =>
    normalized.map((_, index) => index).filter((index) => index % 3 === offset),
  );
  for (const index of forumOrder) {
    if (forumCount >= forumTarget || !normalized[index]) break;
    if (normalized[index]!.formatSystemKey === 'ai-roundtable-publikumsforum') continue;
    normalized[index] = { ...normalized[index]!, formatSystemKey: 'ai-roundtable-publikumsforum' };
    forumCount += 1;
  }
  let roundtableCount = normalized.filter((slot) => ROUNDTABLE_FORMATS.has(slot.formatSystemKey)).length;
  const rotation = ['ai-roundtable-studio', 'ai-roundtable-fakten-duell'] as const;
  const roundtableOrder = [1, 2, 0].flatMap((offset) =>
    normalized.map((_, index) => index).filter((index) => index % 3 === offset),
  );
  for (const [position, index] of roundtableOrder.entries()) {
    if (roundtableCount >= roundtableTarget || !normalized[index]) break;
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

const NON_BROADCAST_LANGUAGE =
  /\b(?:disposition\s+ausgesetzt|nicht\s+zur\s+ausstrahlung\s+freigegeben|nicht\s+sendefähig\w*|kein\w*\s+sendefähig\w*|kein\w*\s+regelkonform\w*\s+(?:slot|block|sendeplan)|ohne\s+passend\w*\s+(?:artikel|video|quelle|nachrichtenbeitrag)|darf\s+nicht\s+ausgestrahlt\s+werden|nicht\s+(?:durch\s+.{1,100}\s+)?belegbar)\b/i;

function assertBroadcastLanguage(value: string, label: string) {
  if (NON_BROADCAST_LANGUAGE.test(value))
    throw new Error(`${label} enthält ausdrücklich nicht sendefähige Dispositionssprache.`);
}

export function admitNewsroomPlan(
  plan: NewsroomPlanAiOutput,
  videoIds: Set<string>,
  articleIds: Set<string>,
): NewsroomReadyPlanAiOutput {
  if (plan.decision !== 'ready' || !plan.slots)
    throw new Error('Ein Plan mit unzureichender Evidenz darf nicht zur Ausstrahlung zugelassen werden.');
  if (plan.slots.length !== 24) throw new Error('Codex CLI muss genau 24 aufeinanderfolgende Stundenblöcke planen.');
  if (plan.blockers.length)
    throw new Error('Ein sendefähiger Codex-Sendeplan darf keine ungelösten Blocker enthalten.');
  assertBroadcastLanguage(plan.title, 'Codex-Sendeplan');
  const minimumVideosPerSlot = Math.min(4, videoIds.size);
  const slots = enforceNewsroomFormatQuotas(plan.slots).map((slot, index) => {
    assertBroadcastLanguage(slot.title, `Codex-Sendeplatz ${index + 1}`);
    assertBroadcastLanguage(slot.editorialAngle, `Redaktioneller Winkel von Sendeplatz ${index + 1}`);
    assertBroadcastLanguage(slot.whyNow, `Warum-jetzt von Sendeplatz ${index + 1}`);
    const knownVideos = [...new Set(slot.videoIds)];
    const knownArticles = [...new Set(slot.articleIds)];
    if (knownVideos.length !== slot.videoIds.length || knownVideos.some((id) => !videoIds.has(id)))
      throw new Error(`Codex-Sendeplatz ${index + 1} enthält kein bekanntes vollständig vorproduziertes Video.`);
    if (knownArticles.length !== slot.articleIds.length || knownArticles.some((id) => !articleIds.has(id)))
      throw new Error(`Codex-Sendeplatz ${index + 1} enthält keinen bekannten freigegebenen Nachrichtenbeitrag.`);
    if (knownVideos.length < minimumVideosPerSlot)
      throw new Error(
        `Codex-Sendeplatz ${index + 1} rotiert nur ${knownVideos.length} statt mindestens ${minimumVideosPerSlot} verfügbare Videos.`,
      );
    const pairKeys = new Set<string>();
    const pairedVideos = new Set<string>();
    const pairedArticles = new Set<string>();
    for (const pair of slot.evidencePairs) {
      if (!videoIds.has(pair.videoId) || !knownVideos.includes(pair.videoId))
        throw new Error(`Evidenzpaar in Codex-Sendeplatz ${index + 1} verweist auf ein fremdes Video.`);
      if (!articleIds.has(pair.articleId) || !knownArticles.includes(pair.articleId))
        throw new Error(`Evidenzpaar in Codex-Sendeplatz ${index + 1} verweist auf einen fremden Artikel.`);
      assertBroadcastLanguage(pair.rationale, `Evidenzpaar in Codex-Sendeplatz ${index + 1}`);
      const pairKey = `${pair.videoId}:${pair.articleId}`;
      if (pairKeys.has(pairKey))
        throw new Error(`Codex-Sendeplatz ${index + 1} enthält ein doppeltes Video-Artikel-Evidenzpaar.`);
      pairKeys.add(pairKey);
      pairedVideos.add(pair.videoId);
      pairedArticles.add(pair.articleId);
    }
    if (knownVideos.some((id) => !pairedVideos.has(id)))
      throw new Error(`Nicht jedes Video in Codex-Sendeplatz ${index + 1} besitzt ein explizites Evidenzpaar.`);
    if (knownArticles.some((id) => !pairedArticles.has(id)))
      throw new Error(`Nicht jeder Artikel in Codex-Sendeplatz ${index + 1} besitzt ein explizites Evidenzpaar.`);
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

export type NewsroomRuntimeEvidence = {
  durationSeconds: number | null;
  cueCount: number;
  moderationAudioSeconds: number;
};

export function calculateNewsroomRuntimeMinutes(entries: NewsroomRuntimeEvidence[]) {
  const runtimeSeconds = entries.reduce(
    (sum, entry) =>
      sum +
      Math.max(0, Number(entry.durationSeconds ?? 0)) +
      Math.max(0, Number(entry.moderationAudioSeconds)) +
      Math.max(0, Number(entry.cueCount)) * 4,
    0,
  );
  return Math.max(1, Math.ceil(runtimeSeconds / 60));
}

function slotRuntimeMinutes(
  slot: NewsroomSlot,
  videos: Map<string, YoutubeVideoRecord>,
  productionByVideo: Map<string, VideoProductionEvidence>,
) {
  return calculateNewsroomRuntimeMinutes(
    slot.videoIds.map((id) => {
      const production = productionByVideo.get(id);
      return {
        durationSeconds: videos.get(id)?.duration_seconds ?? null,
        cueCount: production?.cue_count ?? 0,
        moderationAudioSeconds: production?.audio_duration_seconds ?? 0,
      };
    }),
  );
}

function assertFullDayRuntime(
  plan: NewsroomReadyPlanAiOutput,
  videos: Map<string, YoutubeVideoRecord>,
  productionByVideo: Map<string, VideoProductionEvidence>,
) {
  const runtimes = plan.slots.map((slot) => slotRuntimeMinutes(slot, videos, productionByVideo));
  const shortSlot = runtimes.findIndex((minutes) => minutes < 60);
  if (shortSlot >= 0)
    throw new Error(
      `Codex-Sendeplatz ${shortSlot + 1} deckt mit realen Video-, Moderations- und Übergangszeiten nur ${runtimes[shortSlot]} Minuten ab.`,
    );
  const totalMinutes = runtimes.reduce((sum, minutes) => sum + minutes, 0);
  if (totalMinutes < 24 * 60)
    throw new Error(`Codex-Sendeplan deckt mit realen Laufzeiten nur ${totalMinutes} statt 1440 Minuten ab.`);
  return runtimes;
}

async function newsroomEvidence() {
  const [videos, articles, audienceSignals, currentProgram, previousPlan, videoProduction] = await Promise.all([
    listYoutubeVideosWithReadyPreproduction(),
    listBroadcastCandidateArticles(160, { currentGermanDayOnly: true }),
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
  const currentVideos = videos.filter((video) => isCurrentGermanBroadcastDay(video.published_at));
  const currentArticles = articles.filter((article) =>
    isCurrentGermanBroadcastDay(article.published_at ?? article.fetched_at),
  );
  return {
    videos: currentVideos.slice(0, 40),
    articles: currentArticles.slice(0, 80),
    audienceSignals,
    currentProgram,
    previousPlan,
    productionByVideo,
  };
}

export type NewsroomPlanningState = {
  active_plan_id: string | null;
  evaluated_at: string;
  latest_decision: string | null;
  upcoming: number;
  has_new_ready_package: boolean;
};

export function shouldTriggerNewsroomPlanning(
  state: NewsroomPlanningState | undefined,
  intervalMinutes: number,
  now = Date.now(),
) {
  if (!state) return true;
  const evaluationExpired = now - Date.parse(state.evaluated_at) >= intervalMinutes * 60_000;
  if (state.latest_decision === 'insufficient-evidence')
    return state.has_new_ready_package === true || evaluationExpired;
  return (
    state.has_new_ready_package === true ||
    state.active_plan_id === null ||
    Number(state.upcoming) < 5 ||
    evaluationExpired
  );
}

async function shouldPlan(force: boolean) {
  if (force) return true;
  const intervalMinutes = boundedInteger(process.env.CODEX_NEWSROOM_INTERVAL_MINUTES, 90, 15, 360);
  const state = (
    await query<NewsroomPlanningState>(
      `select active.id active_plan_id,evaluated.generated_at evaluated_at,
              evaluated.decision latest_decision,
              coalesce((select count(*)::int from broadcast_playlists playlist
               where playlist.status='draft' and playlist.scheduled_at>now()
                 and active.id is not null
                 and playlist.settings->>'codexNewsroomPlanId'=active.id::text
                 and not exists(
                   select 1
                   from broadcast_items item
                   left join youtube_videos video on video.id::text=item.rules->>'youtubeLibraryId'
                   where item.playlist_id=playlist.id
                     and item.rules->>'kind'='youtube-context'
                     and (
                       video.id is null
                       or video.published_at<date_trunc('day',now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin'
                       or video.published_at>=now()+interval '15 minutes'
                     )
                 )),0)::int upcoming,
              exists(
                select 1
                from youtube_videos video
                join youtube_preproduced_scripts script on script.youtube_video_id=video.id
                where video.deleted_at is null and video.enabled=true
                  and video.published_at>=date_trunc('day',now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin'
                  and video.published_at<now()+interval '15 minutes'
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
                  and not exists(
                    select 1
                    from jsonb_array_elements_text(
                      coalesce(evaluated.news_snapshot->'videos','[]'::jsonb)
                    ) snapshot(video_id)
                    where snapshot.video_id=video.id::text
                  )
              ) has_new_ready_package
       from lateral (
         select recent.generated_at,recent.news_snapshot,recent.plan->>'decision' decision
         from codex_newsroom_plans recent
         where recent.status in ('active','blocked')
           and recent.plan->>'decision' in ('ready','insufficient-evidence')
         order by recent.generated_at desc
         limit 1
       ) evaluated
       left join lateral (
         select current.id
         from codex_newsroom_plans current
         where current.status='active'
         order by current.generated_at desc
         limit 1
       ) active on true`,
    )
  ).rows[0];
  return shouldTriggerNewsroomPlanning(state, intervalMinutes);
}

async function materializePlan(
  planId: string,
  plan: NewsroomReadyPlanAiOutput,
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
      const discussion = newsroomDiscussionSettings(slot.formatSystemKey);
      const format: AutopilotDailyFormat = {
        id: `codex-newsroom-${planId.slice(0, 8)}-${index + 1}`,
        name: slot.title,
        startTime: `${String(scheduledAt.getUTCHours()).padStart(2, '0')}:${String(scheduledAt.getUTCMinutes()).padStart(2, '0')}`,
        durationMinutes: runtimeMinutes,
        contentMode: discussion.contentMode,
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
          aiRoundtable: discussion.aiRoundtable,
          roundtablePreset: discussion.roundtablePreset,
          roundtableParticipantIds: discussion.roundtableParticipantIds,
          roundtableProductionSettings: {
            ...context.roundtableProductionSettings,
            fallbackMode: 'codex-retry',
            minimumParticipants: 6,
            showAllParticipants: true,
          },
          pauseSeconds: 0,
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
            aiRoundtable: discussion.aiRoundtable,
            roundtablePreset: discussion.roundtablePreset,
            roundtableParticipantIds: discussion.roundtableParticipantIds,
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
      const lockClient = await pool.connect();
      try {
        const locked = (
          await lockClient.query<{ locked: boolean }>(
            `select pg_try_advisory_lock(hashtext('codex-newsroom-chief-editor')) locked`,
          )
        ).rows[0]?.locked;
        if (!locked) return null;
        try {
          await query(
            `update codex_newsroom_plans
             set status='error',error='Planerprozess wurde vor der Fertigstellung beendet.',updated_at=now()
             where status='planning'`,
          );
          if (!(await shouldPlan(force))) return null;
          const evidence = await newsroomEvidence();
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
                  cueCount: production?.cue_count ?? 0,
                  moderationAudioSeconds: production?.audio_duration_seconds ?? 0,
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
          if (result.output.decision === 'insufficient-evidence') {
            const blockedReason = result.output.blockers.join(' · ').slice(0, 1_800);
            await query(
              `update codex_newsroom_plans
               set status='blocked',plan=$2,model=$3,usage=$4,generated_at=now(),error=$5,updated_at=now()
               where id=$1`,
              [planId, result.output, result.model, result.usage, blockedReason],
            );
            await upsertOperationalNotification({
              level: 'warning',
              component: 'codex-newsroom',
              dedupeKey: 'codex-newsroom:planning',
              message: 'Die Codex-CLI-Chefredaktion wartet auf genügend sachlich verbundene Tagespakete.',
              details: {
                planId,
                decision: result.output.decision,
                blockers: result.output.blockers,
                automaticRetry: true,
                localFallback: false,
              },
            }).catch(() => null);
            this.log('codex_newsroom_plan_blocked', {
              planId,
              model: result.model,
              blockers: result.output.blockers,
              automaticRetry: true,
            });
            return { planId, playlistIds: [], model: result.model, status: result.output.decision };
          }
          const plan = admitNewsroomPlan(
            result.output,
            new Set(evidence.videos.map((video) => video.id)),
            new Set(evidence.articles.map((article) => article.id)),
          );
          assertFullDayRuntime(
            plan,
            new Map(evidence.videos.map((video) => [video.id, video])),
            evidence.productionByVideo,
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
                title: `${plan.title} · 24 Stundenblöcke`,
                detail: plan.newsAssessment,
                status: 'planned',
                metadata: {
                  planId,
                  model: result.model,
                  playlistIds,
                  forumSlots: plan.slots.filter((slot) => slot.formatSystemKey === 'ai-roundtable-publikumsforum')
                    .length,
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
          await lockClient
            .query(`select pg_advisory_unlock(hashtext('codex-newsroom-chief-editor'))`)
            .catch(() => null);
        }
      } finally {
        lockClient.release();
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
