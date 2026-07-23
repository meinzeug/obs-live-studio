import {
  activeBroadcastRun,
  createBroadcastCommand,
  getAutopilotConfig,
  getPlaybackSnapshot,
  getRunnerLease,
  query,
  requestBroadcastRecoveryOperation,
  setAutopilotConfig,
  type AutopilotConfig,
} from '@ans/database';
import {
  claimAutonomousOperationsCycle,
  completeAutonomousOperationsCycle,
  createAutonomousStudioDecision,
  failAutonomousOperationsCycle,
  getAutonomousStudioSettings,
  recordAutonomousCouncilMessage,
} from '@ans/database/autonomous-studio';
import { listBroadcastFormats } from '@ans/database/broadcast-formats';
import { resolveOperationalNotification, upsertOperationalNotification } from '@ans/database/notifications';
import { scheduleSourceFetchJobsWithBackoff } from '@ans/database/source-health';
import { ObsController } from '@ans/obs-controller';
import { autopilotOnce } from './autopilot.js';

type Log = (event: string, extra?: Record<string, unknown>) => void;
type Finding = {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  automaticallyRepairable: boolean;
};
type Action = {
  type: string;
  status: 'completed' | 'queued' | 'failed' | 'skipped';
  summary: string;
  resourceId?: string | null;
  error?: string;
};

type OperationsMetrics = {
  upcoming_shows: number;
  schedule_minutes: number;
  upcoming_items: number;
  distinct_upcoming_content: number;
  upcoming_format_count: number;
  active_formats: number;
  unhealthy_sources: number;
  unresolved_incidents: number;
  failed_runs_24h: number;
  autonomous_productions_today: number;
  autonomous_formats_this_week: number;
  open_format_decisions: number;
  open_production_decisions: number;
  approved_articles: number;
  youtube_videos: number;
  active_show_switches: number;
};

type OperationsSnapshot = {
  generatedAt: string;
  autopilot: AutopilotConfig;
  playback: Awaited<ReturnType<typeof getPlaybackSnapshot>>;
  activeRun: Awaited<ReturnType<typeof activeBroadcastRun>>;
  runnerLease: { lease_expires_at: string } | null;
  stream: { reachable: boolean; active: boolean; reconnecting: boolean; error?: string };
  metrics: OperationsMetrics;
  activeFormatNames: string[];
};

type PlayoutProbe = {
  healthy: boolean;
  code: string | null;
  reason: string;
  fingerprint: string;
  runId: string | null;
  playlistId: string | null;
  itemId: string | null;
  itemKind: string | null;
  controlPaused: boolean;
  playerState: number | null;
  mediaPositionMs: number | null;
  playbackStatus: string;
  details: Record<string, unknown>;
};

const FORMAT_BLUEPRINTS = [
  {
    name: 'AVA Lagezentrum',
    systemKey: 'ava-context-lagezentrum',
    contentMode: 'youtube-context',
    description: 'AVA sortiert neue YouTube-Videos nach Relevanz, Quellenlage und offenen Fragen.',
    durationMinutes: 60,
    itemCount: 3,
    preferredStartTimes: ['06:00', '11:00', '16:00'],
    overlayBrief: 'Großes Video links, AVA rechts, klare Lagekarten und Chat-CTA.',
  },
  {
    name: 'AVA Faktenradar',
    systemKey: 'ava-context-faktenradar',
    contentMode: 'youtube-context',
    description: 'Prüfbare Aussagen werden in Claim, Beleglage und offene Punkte zerlegt.',
    durationMinutes: 60,
    itemCount: 3,
    preferredStartTimes: ['07:00', '12:00', '17:00'],
    overlayBrief: 'Grüne Faktencheck-Optik mit Beleg- und Quellenfokus.',
  },
  {
    name: 'AVA Streitpunkt',
    systemKey: 'ava-context-streitpunkt',
    contentMode: 'youtube-context',
    description: 'Kontroverse Videos werden mit Gegenargumenten und echten Chatpositionen moderiert.',
    durationMinutes: 60,
    itemCount: 3,
    preferredStartTimes: ['08:00', '13:00', '18:00'],
    overlayBrief: 'Debatten-Look mit roter Akzentführung, Mia und Sam als Chat-Achse.',
  },
  {
    name: 'AVA Quellencheck',
    systemKey: 'ava-context-quellencheck',
    contentMode: 'youtube-context',
    description: 'Kanal, Upload-Datum, Primärquellen und belastbare Gegenchecks stehen im Mittelpunkt.',
    durationMinutes: 60,
    itemCount: 3,
    preferredStartTimes: ['09:00', '14:00', '19:00'],
    overlayBrief: 'Dokumenten- und Quellenoptik mit Upload-Datum und Herkunftshinweisen.',
  },
  {
    name: 'AVA Nachtstudio',
    systemKey: 'ava-context-nachtstudio',
    contentMode: 'youtube-context',
    description: 'Ruhiger Dauerbetrieb für längere Videos, Zusammenfassungen und Chatantworten.',
    durationMinutes: 60,
    itemCount: 2,
    preferredStartTimes: ['22:00', '23:00', '00:00'],
    overlayBrief: 'Violette Nachtstudio-Optik mit längeren, gut verständlichen Blöcken.',
  },
  {
    name: 'Newsroom Direkt',
    systemKey: 'newsroom-direkt',
    contentMode: 'youtube-news-sidebar',
    description: 'Aktuelle Meldungen rotieren neben abwechslungsreichen Videos und bleiben während der Sendung frisch.',
    durationMinutes: 60,
    itemCount: 8,
    preferredStartTimes: ['08:00', '18:00'],
    overlayBrief: 'Große Videofläche mit einzelner, gut lesbarer News-Karte und klaren Quellenangaben.',
  },
  {
    name: 'Zeitkante Tagesüberblick',
    systemKey: 'zeitkante-tagesueberblick',
    contentMode: 'youtube-context',
    description:
      'Tägliches zweistündiges 18-Uhr-Abendformat mit AVA, Mia, Chatfenstern, Quellencheck und Zuschauereinwänden.',
    durationMinutes: 120,
    itemCount: 6,
    preferredStartTimes: ['18:00'],
    overlayBrief: 'Großes Video links, AVA/Mia rechts, Chatlage und klare Segmentdramaturgie.',
  },
  {
    name: 'Publikumslage mit Mia',
    systemKey: 'publikumslage-mit-mia',
    contentMode: 'youtube-context',
    description: 'Mia fasst echte Chatfragen zusammen und beantwortet neue Zuschauerimpulse in kurzen Blöcken.',
    durationMinutes: 45,
    itemCount: 3,
    preferredStartTimes: ['20:30'],
    overlayBrief: 'Chatfokus mit Mia, Sam-Analyse und kurzer AVA-Rückbindung.',
  },
  {
    name: 'Einordnung mit AVA',
    systemKey: 'youtube-context',
    contentMode: 'youtube-context',
    description: 'AVA ordnet ein Video anhand von Transkript, Quellenrecherche und echten Chatfragen fortlaufend ein.',
    durationMinutes: 60,
    itemCount: 4,
    preferredStartTimes: ['20:15'],
    overlayBrief: 'Video, Moderatorin, Quellenkarten und Livechat als sendefähige Studiokomposition.',
  },
  {
    name: 'Faktencheck am Abend',
    contentMode: 'mixed',
    description: 'Die Redaktion prüft Aussagen des Tages und trennt Belegtes, offene Punkte und Widersprüche.',
    durationMinutes: 30,
    itemCount: 6,
    preferredStartTimes: ['21:15'],
    overlayBrief: 'Dokumenten- und Quellenkarten mit ruhiger, nachvollziehbarer Faktencheck-Gestaltung.',
  },
  {
    name: 'Nachrichten kompakt',
    contentMode: 'news',
    description:
      'Die wichtigsten neuen Meldungen werden quellennah, vollständig und ohne unnötige Wertung ausgespielt.',
    durationMinutes: 30,
    itemCount: 8,
    preferredStartTimes: ['07:00', '12:00', '17:00'],
    overlayBrief: 'Große Headline, vollständiger Nachrichtentext, Quelle und passendes Bild oder Video.',
  },
] as const;

function compactError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 1200);
}

function ageSeconds(value: string | null | undefined, nowMs = Date.now()) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, (nowMs - parsed) / 1000) : Number.POSITIVE_INFINITY;
}

export function evaluatePlayoutProbe(input: {
  nowMs?: number;
  runId: string | null;
  playlistId: string | null;
  runStartedAt: string | null;
  playbackStatus: string;
  playbackUpdatedAt: string | null;
  itemId: string | null;
  itemKind: string | null;
  itemStartedAt: string | null;
  controlPaused: boolean;
  playerState: number | null;
  lastProgressAt: string | null;
  mediaPositionMs: number | null;
  mediaDurationMs: number | null;
  obsMediaStatus: string | null;
}): PlayoutProbe {
  const nowMs = input.nowMs ?? Date.now();
  const base = {
    runId: input.runId,
    playlistId: input.playlistId,
    itemId: input.itemId,
    itemKind: input.itemKind,
    controlPaused: input.controlPaused,
    playerState: input.playerState,
    mediaPositionMs: input.mediaPositionMs,
    playbackStatus: input.playbackStatus,
  };
  const healthy = (reason: string, details: Record<string, unknown> = {}): PlayoutProbe => ({
    healthy: true,
    code: null,
    reason,
    fingerprint: 'healthy',
    ...base,
    details,
  });
  const failed = (code: string, reason: string, details: Record<string, unknown> = {}): PlayoutProbe => ({
    healthy: false,
    code,
    reason,
    fingerprint: `${code}:${input.runId ?? 'none'}:${input.itemId ?? 'none'}`,
    ...base,
    details,
  });
  if (!input.runId && ['stopping', 'skipping'].includes(input.playbackStatus))
    return healthy('Der vorherige Sendelauf wird für einen kontrollierten Wechsel beendet.');
  if (!input.runId)
    return failed('off-air', 'Es existiert kein aktiver Sendelauf.', {
      playbackStatus: input.playbackStatus,
    });
  if (['paused', 'pausing'].includes(input.playbackStatus)) return healthy('Die Sendung ist absichtlich pausiert.');
  if (['stopping', 'skipping'].includes(input.playbackStatus)) return healthy('Ein kontrollierter Regiewechsel läuft.');
  const runAge = ageSeconds(input.runStartedAt, nowMs);
  const playbackAge = ageSeconds(input.playbackUpdatedAt, nowMs);
  if (!input.itemId) {
    if (runAge <= 45 || ['starting', 'preparing'].includes(input.playbackStatus))
      return runAge <= 45
        ? healthy('Der Broadcast-Runner bereitet den ersten Beitrag vor.', { runAgeSeconds: Math.round(runAge) })
        : failed('playout-start-stalled', 'Der aktive Sendelauf hat nach 45 Sekunden noch keinen Beitrag übernommen.', {
            runAgeSeconds: Math.round(runAge),
            playbackAgeSeconds: Math.round(playbackAge),
          });
    return failed('playout-item-missing', 'Der aktive Sendelauf besitzt keinen aktuellen Beitrag.', {
      runAgeSeconds: Math.round(runAge),
    });
  }
  const itemAge = ageSeconds(input.itemStartedAt, nowMs);
  const youtube = ['youtube-video', 'youtube-news-sidebar', 'youtube-context'].includes(input.itemKind ?? '');
  if (youtube) {
    if (input.controlPaused) return healthy('Das YouTube-Video ist für eine Moderation kontrolliert pausiert.');
    const progressAge = ageSeconds(input.lastProgressAt, nowMs);
    if (input.playerState === -1 && itemAge > 20)
      return failed('youtube-player-error', 'Der YouTube-Player meldet einen Wiedergabefehler.', {
        itemAgeSeconds: Math.round(itemAge),
        progressAgeSeconds: Math.round(progressAge),
      });
    if (input.playerState === 2 && itemAge > 20)
      return failed('youtube-unexpected-pause', 'Das YouTube-Video ist außerhalb einer Moderation pausiert.', {
        itemAgeSeconds: Math.round(itemAge),
        mediaPositionMs: input.mediaPositionMs,
      });
    if (input.playerState === 0 && progressAge > 12)
      return failed(
        'youtube-ended-stuck',
        'Das YouTube-Video ist beendet, der Runner hat aber nicht weitergeschaltet.',
        {
          mediaPositionMs: input.mediaPositionMs,
          mediaDurationMs: input.mediaDurationMs,
        },
      );
    if (!input.lastProgressAt && itemAge > 45)
      return failed('youtube-no-progress', 'Für das laufende YouTube-Video wurde kein Player-Fortschritt empfangen.', {
        itemAgeSeconds: Math.round(itemAge),
      });
    if (input.lastProgressAt && progressAge > 35)
      return failed('youtube-progress-stalled', 'Der Fortschritt des YouTube-Players ist stehen geblieben.', {
        progressAgeSeconds: Math.round(progressAge),
        mediaPositionMs: input.mediaPositionMs,
        mediaDurationMs: input.mediaDurationMs,
      });
    return healthy('YouTube-Player und Fortschritt sind aktiv.', {
      playerState: input.playerState,
      progressAgeSeconds: Number.isFinite(progressAge) ? Math.round(progressAge) : null,
    });
  }
  if (input.obsMediaStatus && /error|stopped|ended/i.test(input.obsMediaStatus) && itemAge > 15)
    return failed('obs-media-stopped', 'OBS meldet für den aktuellen Beitrag keine laufende Medienwiedergabe.', {
      obsMediaStatus: input.obsMediaStatus,
      itemAgeSeconds: Math.round(itemAge),
    });
  if (playbackAge > 90)
    return failed(
      'playout-heartbeat-stalled',
      'Der aktuelle Beitrag aktualisiert seinen Wiedergabestatus nicht mehr.',
      {
        playbackAgeSeconds: Math.round(playbackAge),
        obsMediaStatus: input.obsMediaStatus,
      },
    );
  return healthy('Der aktuelle Beitrag wird vom Broadcast-Runner fortgeschrieben.');
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function minutesBetween(left: string, right: string) {
  const parse = (value: string) => {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  };
  const difference = Math.abs(parse(left) - parse(right));
  return Math.min(difference, 24 * 60 - difference);
}

const AVA_CONTEXT_CONTINUITY_FORMATS = [
  ['ava-context-lagezentrum', 'AVA Lagezentrum'],
  ['ava-context-faktenradar', 'AVA Faktenradar'],
  ['ava-context-streitpunkt', 'AVA Streitpunkt'],
  ['ava-context-quellencheck', 'AVA Quellencheck'],
  ['ava-context-nachtstudio', 'AVA Nachtstudio'],
] as const;

function withContinuitySchedule(config: AutopilotConfig, minimumMinutes: number) {
  const targetMinutes = Math.max(60, Math.min(24 * 60, minimumMinutes));
  const slotMinutes = 60;
  const requiredSlots = Math.ceil(targetMinutes / slotMinutes);
  const regular = config.dailyFormats.filter((entry) => !entry.id.startsWith('master-control-continuity-'));
  const existing = regular.filter((entry) => entry.enabled);
  const continuity: AutopilotConfig['dailyFormats'] = [];
  for (let minute = 0; minute < 24 * 60 && continuity.length < requiredSlots; minute += slotMinutes) {
    const startTime = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    if (existing.some((entry) => minutesBetween(entry.startTime, startTime) < 20)) continue;
    const contextFormat =
      config.contentMode === 'youtube-context'
        ? AVA_CONTEXT_CONTINUITY_FORMATS[continuity.length % AVA_CONTEXT_CONTINUITY_FORMATS.length]
        : null;
    continuity.push({
      id: `master-control-continuity-${startTime.replace(':', '')}`,
      name: contextFormat
        ? contextFormat[1]
        : config.contentMode === 'youtube-news-sidebar'
          ? 'Newsroom Direkt'
          : config.contentMode === 'youtube'
            ? 'Mediathek'
            : config.contentMode === 'mixed'
              ? 'Open TV Programm'
              : 'Nachrichten kompakt',
      startTime,
      durationMinutes: slotMinutes,
      contentMode: config.contentMode,
      formatSystemKey: contextFormat?.[0] ?? null,
      youtubeCategoryIds: config.youtubeCategoryIds,
      sourceIds: config.sourceIds,
      enabled: true,
    });
  }
  return { ...config, dailyFormats: [...regular, ...continuity] };
}

async function operationsMetrics(horizonHours: number): Promise<OperationsMetrics> {
  const row = (
    await query<Record<keyof OperationsMetrics, number>>(
      `select
       (select count(*)::int from broadcast_playlists
        where scheduled_at between now() and now()+($1||' hours')::interval
          and status in ('draft','starting','running','paused')) upcoming_shows,
       (select coalesce(sum(greatest(1,coalesce(
          nullif(case when playlist.settings->>'targetRuntimeMinutes' ~ '^[0-9]+([.][0-9]+)?$'
            then (playlist.settings->>'targetRuntimeMinutes')::numeric end,0),runtime.runtime_minutes,30
        ))),0)::int
        from broadcast_playlists playlist
        left join lateral(
          select coalesce(sum(greatest(1,coalesce(
            item.duration_seconds,
            case when item.rules->>'durationMs' ~ '^[0-9]+([.][0-9]+)?$'
              then (item.rules->>'durationMs')::numeric/1000 end,
            60
          )))/60,0) runtime_minutes
          from broadcast_items item where item.playlist_id=playlist.id
        ) runtime on true
        where playlist.scheduled_at between now() and now()+($1||' hours')::interval
          and playlist.status in ('draft','starting','running','paused')) schedule_minutes,
       (select count(*)::int from broadcast_items item join broadcast_playlists playlist on playlist.id=item.playlist_id
        where playlist.scheduled_at between now() and now()+($1||' hours')::interval
          and playlist.status in ('draft','starting','running','paused')) upcoming_items,
       (select count(distinct coalesce(item.article_id::text,item.rules->>'youtubeVideoId',item.id::text))::int
        from broadcast_items item join broadcast_playlists playlist on playlist.id=item.playlist_id
        where playlist.scheduled_at between now() and now()+($1||' hours')::interval
          and playlist.status in ('draft','starting','running','paused')) distinct_upcoming_content,
       (select count(distinct coalesce(playlist.format_id::text,playlist.settings->>'autopilotFormatId'))::int
        from broadcast_playlists playlist
        where playlist.scheduled_at between now() and now()+($1||' hours')::interval
          and playlist.status in ('draft','starting','running','paused')) upcoming_format_count,
       (select count(*)::int from broadcast_templates where active=true and deleted_at is null) active_formats,
       (select count(*)::int from sources where active=true and deleted_at is null and consecutive_errors>0) unhealthy_sources,
       (select count(*)::int from notifications where resolved_at is null and level in ('warning','error','critical')) unresolved_incidents,
       (select count(*)::int from broadcast_runs where status='error' and started_at>now()-interval '24 hours') failed_runs_24h,
       (select count(*)::int from autonomous_studio_decisions
        where kind='production' and status='applied' and applied_at>=date_trunc('day',now())) autonomous_productions_today,
       (select count(*)::int from autonomous_studio_decisions
        where kind='format' and status='applied' and applied_at>now()-interval '7 days') autonomous_formats_this_week,
       (select count(*)::int from autonomous_studio_decisions
        where kind='format' and status in ('queued','planning','awaiting_council','awaiting_reviews','awaiting_ceo','approved','applying','revise')) open_format_decisions,
       (select count(*)::int from autonomous_studio_decisions
        where kind='production' and status in ('queued','planning','awaiting_council','awaiting_reviews','awaiting_ceo','approved','applying','revise')) open_production_decisions,
       (select count(*)::int from articles where deleted_at is null and status in ('approved','published')) approved_articles,
       (select count(*)::int from youtube_videos where deleted_at is null and enabled=true) youtube_videos,
       (select count(*)::int from broadcast_show_switches
        where status in ('pending','stopping','starting')) active_show_switches`,
      [horizonHours],
    )
  ).rows[0];
  return Object.fromEntries(
    Object.entries(row ?? {}).map(([key, value]) => [key, number(value)]),
  ) as unknown as OperationsMetrics;
}

function inspect(snapshot: OperationsSnapshot, settings: Awaited<ReturnType<typeof getAutonomousStudioSettings>>) {
  const findings: Finding[] = [];
  if (!snapshot.autopilot.enabled)
    findings.push({
      code: 'autopilot-disabled',
      severity: 'critical',
      title: 'Der autonome Programmbetrieb ist deaktiviert',
      detail: 'Ohne Autopilot werden weder Sendelücken geschlossen noch fällige Sendungen gestartet.',
      automaticallyRepairable: true,
    });
  if (snapshot.autopilot.enabled && snapshot.stream.reachable && !snapshot.stream.active)
    findings.push({
      code: 'stream-inactive',
      severity: 'critical',
      title: 'Der Stream ist nicht aktiv',
      detail: 'Der Autopilot wartet auf einen aktiven OBS-Ausgang.',
      automaticallyRepairable: true,
    });
  if (!snapshot.stream.reachable)
    findings.push({
      code: 'obs-unreachable',
      severity: 'critical',
      title: 'OBS ist für Master Control nicht erreichbar',
      detail: snapshot.stream.error ?? 'OBS-WebSocket hat nicht geantwortet.',
      automaticallyRepairable: false,
    });
  if (
    snapshot.activeRun &&
    (!snapshot.runnerLease || new Date(snapshot.runnerLease.lease_expires_at).getTime() < Date.now())
  )
    findings.push({
      code: 'runner-stale',
      severity: 'critical',
      title: 'Ein Sendelauf hat keinen gültigen Runner',
      detail: `Der aktive Lauf ${snapshot.activeRun.id} muss neustartfest übernommen werden.`,
      automaticallyRepairable: true,
    });
  if (!snapshot.activeRun && snapshot.metrics.active_show_switches === 0)
    findings.push({
      code: 'off-air',
      severity: 'critical',
      title: 'Momentan läuft keine Sendung',
      detail: 'Master Control fordert unmittelbar eine sendefähige Autopilot-Sendung an.',
      automaticallyRepairable: true,
    });
  if (snapshot.metrics.upcoming_shows < settings.minimum_upcoming_shows)
    findings.push({
      code: 'schedule-count-gap',
      severity: 'warning',
      title: 'Zu wenige Sendungen im Planungshorizont',
      detail: `${snapshot.metrics.upcoming_shows} von mindestens ${settings.minimum_upcoming_shows} Sendungen sind geplant.`,
      automaticallyRepairable: true,
    });
  if (snapshot.metrics.schedule_minutes < settings.minimum_schedule_minutes)
    findings.push({
      code: 'schedule-runtime-gap',
      severity: 'warning',
      title: 'Der Sendeplan deckt noch nicht genug Laufzeit ab',
      detail: `${snapshot.metrics.schedule_minutes} von mindestens ${settings.minimum_schedule_minutes} Minuten sind befüllt.`,
      automaticallyRepairable: true,
    });
  if (snapshot.metrics.active_formats < settings.minimum_active_formats)
    findings.push({
      code: 'format-deficit',
      severity: 'warning',
      title: 'Dem Sender fehlen aktive Sendeformate',
      detail: `${snapshot.metrics.active_formats} von mindestens ${settings.minimum_active_formats} Formaten sind aktiv.`,
      automaticallyRepairable: true,
    });
  if (
    snapshot.metrics.upcoming_items >= 6 &&
    snapshot.metrics.distinct_upcoming_content / Math.max(1, snapshot.metrics.upcoming_items) < 0.55
  )
    findings.push({
      code: 'content-repetition',
      severity: 'warning',
      title: 'Der kommende Sendeplan wiederholt zu viele Inhalte',
      detail: `${snapshot.metrics.distinct_upcoming_content} unterschiedliche Inhalte stehen ${snapshot.metrics.upcoming_items} Platzierungen gegenüber.`,
      automaticallyRepairable: true,
    });
  if (snapshot.metrics.unhealthy_sources > 0)
    findings.push({
      code: 'source-health',
      severity: 'warning',
      title: 'Quellenabrufe benötigen automatische Wiederholung',
      detail: `${snapshot.metrics.unhealthy_sources} aktive Quellen melden Fehler; der Ingest-Worker wendet Backoff und erneute Abrufe an.`,
      automaticallyRepairable: true,
    });
  const needsYoutube = ['youtube', 'youtube-news-sidebar', 'youtube-context'].includes(snapshot.autopilot.contentMode);
  if (needsYoutube && snapshot.metrics.youtube_videos < 1)
    findings.push({
      code: 'content-mode-unavailable',
      severity: snapshot.metrics.approved_articles > 0 ? 'warning' : 'critical',
      title: 'Für den gewählten Programmmodus fehlen YouTube-Videos',
      detail:
        snapshot.metrics.approved_articles > 0
          ? 'Master Control kann bis zum nächsten erfolgreichen Import auf aktuelle Nachrichten ausweichen.'
          : 'Weder sendefähige YouTube-Videos noch freigegebene Nachrichten stehen als Ersatz bereit.',
      automaticallyRepairable: snapshot.metrics.approved_articles > 0,
    });
  return findings;
}

async function createMissingFormatDecisions(
  snapshot: OperationsSnapshot,
  settings: Awaited<ReturnType<typeof getAutonomousStudioSettings>>,
) {
  const availableThisWeek = Math.max(0, settings.max_formats_per_week - snapshot.metrics.autonomous_formats_this_week);
  const required = Math.max(
    0,
    settings.minimum_active_formats - snapshot.metrics.active_formats - snapshot.metrics.open_format_decisions,
  );
  const count = Math.min(required, availableThisWeek);
  if (!count) return [];
  const existingNames = new Set(snapshot.activeFormatNames.map((name) => name.toLocaleLowerCase('de-DE')));
  const created: string[] = [];
  for (const blueprint of FORMAT_BLUEPRINTS) {
    if (created.length >= count) break;
    if (existingNames.has(blueprint.name.toLocaleLowerCase('de-DE'))) continue;
    const decision = await createAutonomousStudioDecision({
      kind: 'format',
      source: 'automatic',
      title: `Sendeformat aufbauen: ${blueprint.name}`,
      instruction: `Master Control hat eine konkrete Formatlücke erkannt. Das Format „${blueprint.name}“ muss nach Gremiumsquorum und zwei unabhängigen Prüfungen real in Formatbibliothek, Overlay und Autopilot angelegt werden.`,
      proposal: {
        ...blueprint,
        cadence: 'daily',
        formatSystemKey: 'systemKey' in blueprint ? blueprint.systemKey : null,
        hosts: blueprint.contentMode === 'youtube-context' ? ['ava', 'mia'] : ['ava'],
        audiencePromise: blueprint.description,
        audienceInteraction:
          'Sam wertet echte Chatimpulse aus; AVA oder Mia reagieren nur auf neue, belegbare Beiträge.',
      },
      requestedBySystem: 'autonomous-master-control',
      importance: 'normal',
    });
    if (decision) created.push(decision.id);
  }
  return created;
}

async function createDailyProductionDecision(
  snapshot: OperationsSnapshot,
  settings: Awaited<ReturnType<typeof getAutonomousStudioSettings>>,
) {
  if (
    settings.max_productions_per_day < 1 ||
    snapshot.metrics.autonomous_productions_today + snapshot.metrics.open_production_decisions >=
      settings.max_productions_per_day
  )
    return null;
  const productionIndex = snapshot.metrics.autonomous_productions_today + snapshot.metrics.open_production_decisions;
  const titles =
    snapshot.autopilot.contentMode === 'youtube-context'
      ? ['Aktuelle Einordnung mit AVA', 'Faktencheck im Dialog', 'Publikumslage mit Mia']
      : snapshot.autopilot.contentMode === 'youtube-news-sidebar'
        ? ['Newsroom Direkt – aktuelle Ausgabe', 'Video & Nachrichtenlage', 'Der autonome Abendüberblick']
        : ['Autonome Tagesausgabe', 'Zeitkante – Themen des Tages', 'Redaktioneller Abendüberblick'];
  const title = titles[productionIndex % titles.length]!;
  return createAutonomousStudioDecision({
    kind: 'production',
    source: 'automatic',
    title,
    instruction:
      'Entwickle aus den aktuell sendefähigen, möglichst neuen und noch nicht übernutzten Inhalten eine reale Ausgabe. Nach Gremiumsprüfung muss sie als befüllte Playlist im nächsten 24-Stunden-Sendeplan stehen.',
    proposal: {
      kind: 'broadcast-show',
      title,
      brief:
        'Aktuelle Quellen und Medien nutzen, Wiederholungen vermeiden, Quellen sichtbar machen und die Ausgabe im Autopilot einplanen.',
      contentMode: snapshot.autopilot.contentMode,
      durationMinutes: 45,
      presenter: snapshot.autopilot.contentMode === 'youtube-context' ? 'ava-and-mia' : 'ava',
      sourceRule: 'Nur freigegebene, sendefähige und nachvollziehbar gekennzeichnete Quellen verwenden.',
      platforms: ['broadcast'],
    },
    requestedBySystem: 'autonomous-master-control',
    importance: 'normal',
  });
}

export class AutonomousOperationsSupervisor {
  private timer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private watchdogBusy = false;
  private busy = false;
  private stopped = false;
  private firstTick = true;
  private readonly obs = new ObsController({
    host: process.env.OBS_HOST ?? '127.0.0.1',
    port: Number(process.env.OBS_PORT ?? 4455),
    password: process.env.OBS_PASSWORD,
  });

  constructor(
    private readonly workerId: string,
    private readonly log: Log,
  ) {}

  async start(intervalMs = 10_000) {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), Math.max(5_000, intervalMs));
    this.timer.unref?.();
    this.watchdogTimer = setInterval(() => void this.watchPlayout(), 10_000);
    this.watchdogTimer.unref?.();
    setTimeout(() => void this.tick(true), 5_000).unref?.();
    setTimeout(() => void this.watchPlayout(), 2_500).unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.timer = null;
    this.watchdogTimer = null;
    void this.obs.disconnect().catch(() => undefined);
  }

  private async playoutProbe() {
    const [run, playback] = await Promise.all([activeBroadcastRun(), getPlaybackSnapshot()]);
    const item = playback.itemId
      ? ((
          await query<{
            id: string;
            kind: string | null;
            started_at: string | null;
            control_paused: boolean | null;
            player_state: number | null;
            last_progress_at: string | null;
            media_position_ms: string | null;
            media_duration_ms: string | null;
          }>(
            `select item.id,item.rules->>'kind' kind,item.started_at,
                    control.paused control_paused,control.player_state,
                    control.last_progress_at,control.media_position_ms::text,
                    control.media_duration_ms::text
             from broadcast_items item
             left join youtube_context_playback_controls control on control.broadcast_item_id=item.id
             where item.id=$1`,
            [playback.itemId],
          )
        ).rows[0] ?? null)
      : null;
    return evaluatePlayoutProbe({
      runId: run?.id ?? null,
      playlistId: run?.playlist_id ?? playback.playlistId,
      runStartedAt: run?.started_at ?? null,
      playbackStatus: playback.status,
      playbackUpdatedAt: playback.updatedAt,
      itemId: playback.itemId,
      itemKind: item?.kind ?? null,
      itemStartedAt: item?.started_at ?? null,
      controlPaused: item?.control_paused === true,
      playerState: item?.player_state == null ? null : Number(item.player_state),
      lastProgressAt: item?.last_progress_at ?? null,
      mediaPositionMs: item?.media_position_ms == null ? playback.mediaPositionMs : Number(item.media_position_ms),
      mediaDurationMs: item?.media_duration_ms == null ? playback.mediaDurationMs : Number(item.media_duration_ms),
      obsMediaStatus: playback.obsMediaStatus,
    });
  }

  private async observeWatchdog(probe: PlayoutProbe) {
    return (
      await query<{
        consecutive_detections: number;
        cooldown_until: string | null;
      }>(
        `update master_control_watchdog
         set finding_code=$1,
             fingerprint=$2,
             first_detected_at=case when fingerprint is distinct from $2 then now() else first_detected_at end,
             last_detected_at=case when $1::text is null then null else now() end,
             consecutive_detections=case
               when $1::text is null then 0
               when fingerprint is not distinct from $2 then consecutive_detections+1
               else 1
             end,
             details=$3,
             updated_at=now()
         where id=true
         returning consecutive_detections,cooldown_until`,
        [probe.code, probe.fingerprint, probe.details],
      )
    ).rows[0]!;
  }

  private async applyProgressTracker(probe: PlayoutProbe) {
    const youtube = ['youtube-video', 'youtube-news-sidebar', 'youtube-context'].includes(probe.itemKind ?? '');
    if (
      !probe.healthy ||
      !youtube ||
      !probe.itemId ||
      probe.controlPaused ||
      probe.playerState !== 1 ||
      probe.mediaPositionMs === null
    )
      return probe;
    const tracker = (
      await query<{
        position_changed_at: string;
        stagnant_seconds: number;
      }>(
        `update master_control_watchdog
         set position_changed_at=case
               when observed_item_id is distinct from $1
                 or observed_position_ms is null
                 or abs(observed_position_ms-$2::bigint)>750
               then now()
               else coalesce(position_changed_at,now())
             end,
             observed_item_id=$1,
             observed_position_ms=$2,
             updated_at=now()
         where id=true
         returning position_changed_at,
           extract(epoch from (now()-coalesce(position_changed_at,now())))::double precision stagnant_seconds`,
        [probe.itemId, Math.max(0, Math.round(probe.mediaPositionMs))],
      )
    ).rows[0];
    if (Number(tracker?.stagnant_seconds ?? 0) <= 35) return probe;
    return {
      ...probe,
      healthy: false,
      code: 'youtube-position-stalled',
      reason: 'Der YouTube-Player meldet Wiedergabe, aber die Videoposition bewegt sich nicht.',
      fingerprint: `youtube-position-stalled:${probe.runId}:${probe.itemId}`,
      details: {
        ...probe.details,
        stagnantSeconds: Math.round(Number(tracker.stagnant_seconds)),
        mediaPositionMs: probe.mediaPositionMs,
      },
    };
  }

  private async markWatchdogAction(action: string, probe: PlayoutProbe, cooldownSeconds: number) {
    await query(
      `update master_control_watchdog
       set last_action=$1,last_action_at=now(),
           cooldown_until=now()+($2::double precision*interval '1 second'),
           details=details || jsonb_build_object('action',$1::text,'actionAt',now()),
           updated_at=now()
       where id=true`,
      [action, cooldownSeconds],
    );
    this.log('master_control_playout_action', {
      action,
      code: probe.code,
      reason: probe.reason,
      runId: probe.runId,
      playlistId: probe.playlistId,
      itemId: probe.itemId,
    });
  }

  private async watchPlayout() {
    if (this.watchdogBusy || this.stopped) return;
    this.watchdogBusy = true;
    try {
      const config = await getAutopilotConfig();
      if (!config.enabled) return;
      const probe = await this.applyProgressTracker(await this.playoutProbe());
      const state = await this.observeWatchdog(probe);
      if (probe.healthy) {
        await resolveOperationalNotification('master-control:playout-stalled').catch(() => null);
        return;
      }
      await upsertOperationalNotification({
        level: probe.code === 'off-air' ? 'error' : 'critical',
        component: 'master-control',
        dedupeKey: 'master-control:playout-stalled',
        message: probe.reason,
        details: {
          code: probe.code,
          runId: probe.runId,
          playlistId: probe.playlistId,
          itemId: probe.itemId,
          detections: state.consecutive_detections,
          ...probe.details,
        },
      }).catch(() => null);
      const inCooldown = Boolean(state.cooldown_until && Date.parse(state.cooldown_until) > Date.now());
      const requiredDetections = probe.code === 'off-air' ? 1 : 2;
      if (inCooldown || state.consecutive_detections < requiredDetections) {
        this.log('master_control_playout_observed', {
          code: probe.code,
          detections: state.consecutive_detections,
          requiredDetections,
          inCooldown,
          itemId: probe.itemId,
        });
        return;
      }
      if (probe.code === 'off-air') {
        const result = await autopilotOnce(this.log);
        await this.markWatchdogAction(result ? 'start-autopilot-show' : 'request-autopilot-show', probe, 30);
        return;
      }
      if (
        probe.runId &&
        probe.playlistId &&
        probe.itemId &&
        ['playing', 'preparing', 'starting'].includes(probe.playbackStatus)
      ) {
        const command = await createBroadcastCommand({
          broadcastRunId: probe.runId,
          playlistId: probe.playlistId,
          command: 'skip',
          idempotencyKey: `master-control:skip:${probe.runId}:${probe.itemId}:${Math.floor(Date.now() / 60_000)}`,
          targetStatus: 'skipping',
        });
        await this.markWatchdogAction(`skip-stalled-item:${command.id}`, probe, 45);
        return;
      }
      if (probe.runId) {
        const recovery = await requestBroadcastRecoveryOperation({
          broadcastRunId: probe.runId,
          requestedBy: 'master-control-playout-watchdog',
          reason: probe.code ?? 'playout-stalled',
          operationType: 'recover',
        });
        await this.markWatchdogAction(`recover-runner:${recovery.id}`, probe, 45);
      }
    } catch (error) {
      this.log('master_control_playout_watchdog_failed', { error: compactError(error) });
    } finally {
      this.watchdogBusy = false;
    }
  }

  private async snapshot(): Promise<OperationsSnapshot> {
    const settings = await getAutonomousStudioSettings();
    const [autopilot, playback, activeRun, metrics, formats] = await Promise.all([
      getAutopilotConfig(),
      getPlaybackSnapshot(),
      activeBroadcastRun(),
      operationsMetrics(settings.schedule_horizon_hours),
      listBroadcastFormats({ includeInactive: false }),
    ]);
    const runnerLease = activeRun ? await getRunnerLease(activeRun.id) : null;
    const stream = await this.obs
      .getStreamStatus()
      .then((status) => ({
        reachable: true,
        active: Boolean(status.outputActive),
        reconnecting: Boolean(status.outputReconnecting),
      }))
      .catch((error) => ({ reachable: false, active: false, reconnecting: false, error: compactError(error) }));
    return {
      generatedAt: new Date().toISOString(),
      autopilot,
      playback,
      activeRun,
      runnerLease,
      stream,
      metrics,
      activeFormatNames: formats.map((format) => format.name),
    };
  }

  private async repair(
    snapshot: OperationsSnapshot,
    findings: Finding[],
    settings: Awaited<ReturnType<typeof getAutonomousStudioSettings>>,
  ) {
    const actions: Action[] = [];
    if (!settings.automatic_operational_actions) return actions;
    let autopilot = snapshot.autopilot;
    if (findings.some((finding) => finding.code === 'autopilot-disabled')) {
      autopilot = await setAutopilotConfig({ ...autopilot, enabled: true });
      actions.push({ type: 'enable-autopilot', status: 'completed', summary: 'Autopilot wieder aktiviert.' });
    }
    if (
      findings.some((finding) => finding.code === 'content-mode-unavailable') &&
      snapshot.metrics.approved_articles > 0
    ) {
      autopilot = await setAutopilotConfig({ ...autopilot, contentMode: 'news' });
      actions.push({
        type: 'activate-content-fallback',
        status: 'completed',
        summary: 'Mangels verfügbarer YouTube-Medien vorübergehend auf Nachrichtenbetrieb umgeschaltet.',
      });
    }
    if (findings.some((finding) => finding.code === 'stream-inactive')) {
      try {
        await this.obs.startStream();
        actions.push({ type: 'start-stream', status: 'completed', summary: 'OBS-Streaming automatisch gestartet.' });
      } catch (error) {
        actions.push({
          type: 'start-stream',
          status: 'failed',
          summary: 'OBS-Streaming konnte nicht automatisch gestartet werden.',
          error: compactError(error),
        });
      }
    }
    if (findings.some((finding) => finding.code === 'runner-stale') && snapshot.activeRun) {
      try {
        const existing = (
          await query<{ id: string }>(
            `select id from broadcast_recovery_operations
             where broadcast_run_id=$1 and status in ('pending','claimed')
             order by created_at desc limit 1`,
            [snapshot.activeRun.id],
          )
        ).rows[0];
        const recovery =
          existing ??
          (await requestBroadcastRecoveryOperation({
            broadcastRunId: snapshot.activeRun.id,
            requestedBy: 'autonomous-master-control',
            reason: 'stale-runner-lease',
            operationType: 'recover',
          }));
        actions.push({
          type: 'recover-runner',
          status: existing ? 'skipped' : 'queued',
          summary: existing ? 'Runner-Wiederherstellung läuft bereits.' : 'Runner-Wiederherstellung beauftragt.',
          resourceId: recovery.id,
        });
      } catch (error) {
        actions.push({
          type: 'recover-runner',
          status: 'failed',
          summary: 'Runner-Wiederherstellung konnte nicht beauftragt werden.',
          error: compactError(error),
        });
      }
    }
    if (
      findings.some((finding) =>
        ['off-air', 'schedule-count-gap', 'schedule-runtime-gap', 'content-repetition'].includes(finding.code),
      )
    ) {
      try {
        if (findings.some((finding) => ['schedule-count-gap', 'schedule-runtime-gap'].includes(finding.code))) {
          const continuity = withContinuitySchedule(autopilot, settings.minimum_schedule_minutes);
          if (JSON.stringify(continuity.dailyFormats) !== JSON.stringify(autopilot.dailyFormats)) {
            autopilot = await setAutopilotConfig(continuity);
            actions.push({
              type: 'secure-continuity-schedule',
              status: 'completed',
              summary: 'Fehlende Sendeflächen mit einem wiederkehrenden 24-Stunden-Kontinuitätsraster geschlossen.',
            });
          }
        }
        const result = await autopilotOnce(this.log);
        actions.push({
          type: 'repair-schedule-and-playout',
          status: 'completed',
          summary: result ? 'Autopilot hat Sendeplan beziehungsweise Playout ergänzt.' : 'Autopilot-Planung geprüft.',
          resourceId: result && typeof result === 'object' && 'playlistId' in result ? String(result.playlistId) : null,
        });
      } catch (error) {
        actions.push({
          type: 'repair-schedule-and-playout',
          status: 'failed',
          summary: 'Autopilot-Reparaturlauf ist fehlgeschlagen.',
          error: compactError(error),
        });
      }
    }
    if (findings.some((finding) => finding.code === 'source-health')) {
      try {
        const queued = await scheduleSourceFetchJobsWithBackoff();
        actions.push({
          type: 'retry-sources',
          status: queued > 0 ? 'queued' : 'skipped',
          summary:
            queued > 0
              ? `${queued} fällige Quellenabrufe mit sicherem Backoff neu beauftragt.`
              : 'Quellenwiederholungen sind bereits eingeplant oder warten auf ihr Backoff-Fenster.',
        });
      } catch (error) {
        actions.push({
          type: 'retry-sources',
          status: 'failed',
          summary: 'Quellenwiederholungen konnten nicht eingeplant werden.',
          error: compactError(error),
        });
      }
    }
    const formatDecisionIds = await createMissingFormatDecisions(snapshot, settings);
    for (const decisionId of formatDecisionIds)
      actions.push({
        type: 'develop-format',
        status: 'queued',
        summary: 'Konkretes Sendeformat an Gremium und Doppelprüfung übergeben.',
        resourceId: decisionId,
      });
    const production = await createDailyProductionDecision(snapshot, settings);
    if (production)
      actions.push({
        type: 'develop-production',
        status: 'queued',
        summary: 'Neue reale Eigenproduktion wird geprüft und anschließend in den Sendeplan materialisiert.',
        resourceId: production.id,
      });
    return actions;
  }

  async tick(force = false) {
    if (this.busy || this.stopped) return;
    this.busy = true;
    const trigger = this.firstTick ? 'startup' : force ? 'recovery' : 'timer';
    this.firstTick = false;
    const cycle = await claimAutonomousOperationsCycle(this.workerId, { force, trigger }).catch((error) => {
      this.log('autonomous_master_control_claim_failed', { error: compactError(error) });
      return null;
    });
    if (!cycle) {
      this.busy = false;
      return;
    }
    try {
      const settings = await getAutonomousStudioSettings();
      const before = await this.snapshot();
      const findings = inspect(before, settings);
      const actions = await this.repair(before, findings, settings);
      const after = await this.snapshot();
      const remaining = inspect(after, settings);
      const failedActions = actions.filter((action) => action.status === 'failed');
      const unresolvedCritical = remaining.some((finding) => finding.severity === 'critical');
      const status =
        findings.length === 0
          ? 'healthy'
          : failedActions.length === 0 && (!unresolvedCritical || actions.some((action) => action.status === 'queued'))
            ? 'repaired'
            : 'degraded';
      const verification = {
        generatedAt: after.generatedAt,
        remainingFindings: remaining,
        schedule: {
          beforeShows: before.metrics.upcoming_shows,
          afterShows: after.metrics.upcoming_shows,
          beforeMinutes: before.metrics.schedule_minutes,
          afterMinutes: after.metrics.schedule_minutes,
        },
        onAir: Boolean(after.activeRun),
        streamActive: after.stream.active,
        queuedCreativeWork: actions.filter((action) => action.status === 'queued').length,
      };
      await completeAutonomousOperationsCycle({
        id: cycle.id,
        status,
        snapshotBefore: before as unknown as Record<string, unknown>,
        findings,
        actions,
        verification,
      });
      if (actions.length) {
        await recordAutonomousCouncilMessage({
          authorKind: 'system',
          authorName: 'Master Control',
          message: `Autonomer Betriebszyklus: ${actions.map((action) => action.summary).join(' ')}`.slice(0, 4000),
          metadata: { cycleId: cycle.id, status, findings: findings.map((finding) => finding.code) },
        });
      }
      if (status === 'degraded')
        await upsertOperationalNotification({
          level: remaining.some((finding) => finding.severity === 'critical') ? 'error' : 'warning',
          component: 'autonomous-master-control',
          dedupeKey: 'autonomous-master-control:degraded',
          message: 'Das autonome Master Control konnte nicht alle Betriebsprobleme selbst beheben.',
          details: { cycleId: cycle.id, findings: remaining, actions },
        });
      else await resolveOperationalNotification('autonomous-master-control:degraded').catch(() => null);
      await resolveOperationalNotification('autonomous-master-control:failed').catch(() => null);
      this.log('autonomous_master_control_completed', {
        cycleId: cycle.id,
        status,
        findings: findings.length,
        actions: actions.length,
        remaining: remaining.length,
      });
    } catch (error) {
      await failAutonomousOperationsCycle(cycle.id, error).catch(() => null);
      await upsertOperationalNotification({
        level: 'error',
        component: 'autonomous-master-control',
        dedupeKey: 'autonomous-master-control:failed',
        message: 'Der autonome Master-Control-Zyklus ist fehlgeschlagen.',
        details: { cycleId: cycle.id, error: compactError(error) },
      }).catch(() => null);
      this.log('autonomous_master_control_failed', { cycleId: cycle.id, error: compactError(error) });
    } finally {
      this.busy = false;
    }
  }
}
