import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import {
  activeBroadcastRun,
  getBroadcastPlaylist,
  listBroadcastItems,
  getPlaybackSnapshot,
  applyRuntimeTransition,
  acquireRunnerLease,
  renewRunnerLease,
  releaseRunnerLease,
  claimNextBroadcastCommand,
  getRunnerLease,
  attachRunnerToPlaybackRun,
  finalizePlaybackRun,
  getYoutubeContextPlaybackControl,
  resetYoutubeContextPlaybackControl,
} from '@ans/database';
import type { ObsController } from '@ans/obs-controller';
import { PlaybackCommandProcessor, PlaybackConflictError } from './playback/processor.js';
import { BroadcastCommandExecutor } from './commandExecutor.js';
import type { BroadcastCommand, PlaybackSnapshot as CanonicalPlaybackSnapshot } from './playback/state.js';

export type CommandEnvelope = {
  id: string;
  sequence: number;
  command: Control;
  expectedRevision: number;
  expectedStatus: string | null;
  idempotencyKey: string | null;
  runnerId: string;
  leaseGeneration: number;
};
export type PauseResult = 'resume' | 'skip' | 'stop' | 'lease_lost' | 'error';
export type PlaybackStatus =
  | 'idle'
  | 'starting'
  | 'preparing'
  | 'playing'
  | 'pausing'
  | 'paused'
  | 'resuming'
  | 'skipping'
  | 'stopping'
  | 'ended'
  | 'error'
  | 'interrupted';
export type Control = BroadcastCommand;

export function nullableBroadcastReference(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized !== 'null' && normalized !== 'undefined' ? normalized : null;
}

export { PlaybackCommandProcessor, PlaybackConflictError };
export { transitionTable, validateTransition } from './playback/transitions.js';
export { PlaybackConsistencyError } from './playback/state.js';
export type { PlaybackSnapshot, AcceptedCommand, TransitionResult } from './playback/state.js';
export interface BroadcastRunnerOptions {
  obs: ObsController;
  playlistId: string;
  overlayUrl: string;
  programIntroPath?: string;
  programIntroDurationMs?: number;
  maintenanceDelayMs?: number;
  pollMs?: number;
  recoverRunId?: string;
  runnerId?: string;
}

export function shouldPlayProgramIntro(input: {
  recoveryMode?: string | null;
  currentPosition?: number | null;
  items: Array<{ status?: string | null; started_at?: string | null }>;
}) {
  if ((input.recoveryMode ?? 'fresh') !== 'fresh') return false;
  if (Number(input.currentPosition ?? 0) !== 0) return false;
  return !input.items.some(
    (item) =>
      Boolean(item.started_at) ||
      ['preparing', 'playing', 'played', 'skipped', 'error'].includes(String(item.status ?? 'planned')),
  );
}
class ControlledStop extends Error {
  constructor(
    public finalStatus: 'ended' | 'interrupted' = 'ended',
    public preserveRun = false,
  ) {
    super('Sendelauf kontrolliert beendet');
  }
}

async function requireUsableAudioPath(audioPath: string | null | undefined) {
  if (!audioPath?.trim()) throw new Error('Kein Sprecher-Audio für Beitrag vorhanden');
  try {
    if ((await stat(audioPath)).size > 44) return audioPath;
  } catch {
    // Fall through to the explicit broadcast error below.
  }
  throw new Error(`Sprecher-Audio-Datei fehlt oder ist leer: ${audioPath}`);
}

function youtubeItemRules(item: { id: string; duration_seconds?: number | null; rules?: Record<string, unknown> }) {
  const rules = item.rules ?? {};
  if (
    (rules.kind !== 'youtube-video' && rules.kind !== 'youtube-news-sidebar' && rules.kind !== 'youtube-context') ||
    typeof rules.youtubeVideoId !== 'string'
  )
    return null;
  const durationSeconds = Number(rules.durationSeconds ?? item.duration_seconds ?? 900);
  const url =
    typeof rules.url === 'string' && rules.url.trim()
      ? rules.url
      : `https://www.youtube.com/watch?v=${encodeURIComponent(rules.youtubeVideoId)}`;
  return {
    videoId: rules.youtubeVideoId,
    title: typeof rules.title === 'string' && rules.title.trim() ? rules.title : 'YouTube-Video',
    channel: typeof rules.channelTitle === 'string' && rules.channelTitle.trim() ? rules.channelTitle : 'YouTube',
    url,
    layout:
      rules.kind === 'youtube-news-sidebar'
        ? ('news-sidebar' as const)
        : rules.kind === 'youtube-context'
          ? ('youtube-context' as const)
          : ('fullscreen' as const),
    news: Array.isArray(rules.news)
      ? rules.news
          .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const row = item as Record<string, unknown>;
            return {
              articleId: typeof row.articleId === 'string' ? row.articleId : '',
              title: typeof row.title === 'string' ? row.title : '',
              text: typeof row.text === 'string' ? row.text : '',
              source: typeof row.source === 'string' ? row.source : '',
            };
          })
          .filter((item): item is { articleId: string; title: string; text: string; source: string } =>
            Boolean(item?.title || item?.text),
          )
      : [],
    sidebarRotationSeconds: Math.max(3, Math.min(120, Math.floor(Number(rules.sidebarRotationSeconds ?? 12)))),
    durationMs: Math.max(30_000, Math.min(24 * 3600_000, Math.floor(durationSeconds * 1000))),
  };
}

export function youtubePlaybackWindow(
  item: { status?: string; started_at?: string | null; finished_at?: string | null },
  totalDurationMs: number,
  now = Date.now(),
  accumulatedPauseMs = 0,
) {
  const boundedDurationMs = Math.max(0, Math.floor(totalDurationMs));
  const resumable =
    Boolean(item.started_at) && !item.finished_at && !['planned', 'played', 'skipped'].includes(item.status ?? '');
  const startedAt = resumable ? Date.parse(String(item.started_at)) : Number.NaN;
  const elapsedMs = Number.isFinite(startedAt) ? Math.max(0, now - startedAt - Math.max(0, accumulatedPauseMs)) : 0;
  const consumedMs = Math.min(boundedDurationMs, elapsedMs);
  return {
    startSeconds: Math.min(Math.floor(consumedMs / 1000), Math.max(0, Math.ceil(boundedDurationMs / 1000) - 1)),
    remainingDurationMs: Math.max(0, boundedDurationMs - consumedMs),
  };
}

export function youtubeContextPauseDurationMs(
  control:
    | { paused?: boolean; pause_started_at?: string | null; accumulated_pause_ms?: number | string | null }
    | null
    | undefined,
  now = Date.now(),
) {
  const accumulated = Math.max(0, Number(control?.accumulated_pause_ms ?? 0) || 0);
  if (!control?.paused || !control.pause_started_at) return accumulated;
  const startedAt = Date.parse(control.pause_started_at);
  return accumulated + (Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0);
}

export function youtubePlayerReachedEnd(
  control:
    | {
        paused?: boolean;
        media_position_ms?: number | string | null;
        media_duration_ms?: number | string | null;
        player_state?: number | string | null;
        last_progress_at?: string | Date | null;
      }
    | null
    | undefined,
  now = Date.now(),
) {
  if (!control || control.paused || !control.last_progress_at) return false;
  const progressAt = new Date(control.last_progress_at).getTime();
  if (!Number.isFinite(progressAt) || progressAt < now - 8_000) return false;
  const positionMs = Math.max(0, Number(control.media_position_ms ?? 0) || 0);
  const durationMs = Math.max(0, Number(control.media_duration_ms ?? 0) || 0);
  const playerState = Number(control.player_state);
  if (positionMs < 5_000) return false;

  // Der YouTube-Iframe meldet 0 explizit für "ended". Manche Player bleiben
  // am letzten Frame in "paused"/"cued" stehen; dort ist die echte Dauer der
  // sichere Fallback, ohne ein noch laufendes Schlussbild vorzeitig abzuschneiden.
  if (playerState === 0) return true;
  return durationMs > 0 && positionMs >= durationMs - 2_000 && (playerState === 2 || playerState === 5);
}

export function youtubePlayerUnavailable(
  control:
    | {
        paused?: boolean;
        media_position_ms?: number | string | null;
        media_duration_ms?: number | string | null;
        player_state?: number | string | null;
        last_progress_at?: string | Date | null;
      }
    | null
    | undefined,
  playbackStartedAt: number,
  now = Date.now(),
  startupTimeoutMs = 30_000,
) {
  if (!control || control.paused || !control.last_progress_at) return false;
  if (!Number.isFinite(playbackStartedAt) || now - playbackStartedAt < startupTimeoutMs) return false;
  const progressAt = new Date(control.last_progress_at).getTime();
  if (!Number.isFinite(progressAt) || progressAt < now - 8_000) return false;
  const positionMs = Math.max(0, Number(control.media_position_ms ?? 0) || 0);
  const durationMs = Math.max(0, Number(control.media_duration_ms ?? 0) || 0);
  const playerState = Number(control.player_state);
  return positionMs < 1_000 && durationMs === 0 && (playerState === -1 || playerState === 0);
}

function youtubeViewerUrl(baseUrl: string, videoId: string, itemId: string, startSeconds = 0) {
  const url = new URL(`/live/youtube/${encodeURIComponent(videoId)}`, baseUrl);
  url.searchParams.set('broadcastItem', itemId);
  if (startSeconds > 0) url.searchParams.set('start', String(startSeconds));
  return url.toString();
}

function youtubeOverlayUrl(baseUrl: string, youtube: { title: string; channel: string; url: string }, itemId: string) {
  const url = new URL('/overlay/youtube-video', baseUrl);
  url.searchParams.set('itemId', itemId);
  url.searchParams.set('title', youtube.title);
  url.searchParams.set('channel', youtubeChannelAttribution(youtube.channel));
  url.searchParams.set('url', youtube.url);
  return url.toString();
}

function youtubeChannelAttribution(channel: string) {
  const trimmed = channel.trim();
  if (!trimmed || trimmed.toLowerCase() === 'youtube') return 'YouTube';
  if (/\s@\s*youtube$/i.test(trimmed)) return trimmed;
  return `${trimmed} @ YouTube`;
}

function youtubeNewsSidebarOverlayUrl(
  baseUrl: string,
  youtube: {
    title: string;
    channel: string;
    url: string;
    sidebarRotationSeconds: number;
  },
  itemId: string,
) {
  const url = new URL('/overlay/youtube-news-sidebar', baseUrl);
  url.searchParams.set('itemId', itemId);
  url.searchParams.set('title', youtube.title);
  url.searchParams.set('channel', youtubeChannelAttribution(youtube.channel));
  url.searchParams.set('url', youtube.url);
  url.searchParams.set('rotationSeconds', String(youtube.sidebarRotationSeconds));
  return url.toString();
}

function youtubeContextOverlayUrl(
  baseUrl: string,
  youtube: {
    title: string;
    channel: string;
    url: string;
    sidebarRotationSeconds: number;
  },
  itemId: string,
) {
  const url = new URL('/overlay/youtube-context', baseUrl);
  url.searchParams.set('itemId', itemId);
  url.searchParams.set('title', youtube.title);
  url.searchParams.set('channel', youtubeChannelAttribution(youtube.channel));
  url.searchParams.set('url', youtube.url);
  url.searchParams.set('rotationSeconds', String(youtube.sidebarRotationSeconds));
  return url.toString();
}

export class BroadcastRunner {
  public readonly id: string;
  private running = false;
  private leaseTimer: NodeJS.Timeout | null = null;
  private runId: string | null = null;
  private leaseGeneration: number | null = null;
  private abortController = new AbortController();
  private shutdownRequested = false;
  private shutdownTask: Promise<void> | null = null;
  private lastArticleId: string | null = null;
  private commandExecutor: BroadcastCommandExecutor;
  private currentSnapshot: CanonicalPlaybackSnapshot | null = null;
  constructor(private opts: BroadcastRunnerOptions) {
    this.id = opts.runnerId ?? `runner-${randomBytes(16).toString('hex')}`;
    this.commandExecutor = new BroadcastCommandExecutor(
      opts.obs,
      this.id,
      this.abortController.signal,
      opts.pollMs ?? 100,
    );
  }
  isRunning() {
    return this.running;
  }

  async shutdown() {
    if (this.shutdownTask) return this.shutdownTask;
    this.shutdownRequested = true;
    this.running = false;
    this.abortController.abort();
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    this.shutdownTask = this.opts.obs.pauseMedia().then(
      () => undefined,
      () => undefined,
    );
    return this.shutdownTask;
  }

  control(...controls: Control[]) {
    void controls;
    throw new Error('Direkte Runner-Steuerung ist deaktiviert; nutze persistente broadcast_commands');
  }

  async initialize() {
    if (this.running) throw new Error('Sendelauf läuft bereits in diesem Prozess');
    let run: any = await activeBroadcastRun();
    if (run && this.opts.recoverRunId && run.id !== this.opts.recoverRunId) run = null;
    if (!run) throw new Error('Aktiver Sendelauf konnte nicht gestartet werden');
    const lease = await acquireRunnerLease(run.id, this.id);
    if (!lease) throw new Error('Sendelauf ist durch einen anderen Runner gesperrt');
    this.runId = run.id;
    this.leaseGeneration = Number(lease.lease_generation ?? 1);
    this.leaseTimer = setInterval(() => void this.renewLeaseOrStop(), 5000);
    this.running = true;
    await this.opts.obs.ensureConnectedWithRetry?.();
    await this.opts.obs.ensureMainNewsScene?.(this.opts.overlayUrl);
    this.currentSnapshot = (
      await attachRunnerToPlaybackRun({
        broadcastRunId: run.id,
        playlistId: this.opts.playlistId,
        runnerId: this.id,
        leaseGeneration: this.leaseGeneration,
      })
    ).snapshot as CanonicalPlaybackSnapshot;
    return {
      id: this.opts.recoverRunId ?? '',
      runnerId: this.id,
      broadcastRunId: run.id,
      leaseGeneration: this.leaseGeneration,
      recoveryMode: this.currentSnapshot.recoveryMode ?? 'fresh',
      result: { status: 'ready', snapshot: this.currentSnapshot },
    };
  }

  async run() {
    if (!this.runId) throw new Error('Runner wurde nicht initialisiert');
    const runId = this.runId;
    try {
      await this.loop(runId);

      if (!['ended', 'interrupted', 'error'].includes(String(this.currentSnapshot?.status))) {
        this.currentSnapshot = (
          await this.finalize({
            broadcastRunId: runId,
            playlistId: this.opts.playlistId,
            runnerId: this.id,
            leaseGeneration: this.leaseGeneration ?? 0,
            expectedRevision: this.currentSnapshot?.stateRevision ?? 0,
            status: 'ended',
          })
        ).snapshot as CanonicalPlaybackSnapshot;
      }
    } catch (e) {
      if (e instanceof ControlledStop) {
        if (!e.preserveRun && !['ended', 'interrupted', 'error'].includes(String(this.currentSnapshot?.status))) {
          this.currentSnapshot = (
            await this.finalize({
              broadcastRunId: runId,
              playlistId: this.opts.playlistId,
              runnerId: this.id,
              leaseGeneration: this.leaseGeneration ?? 0,
              expectedRevision: this.currentSnapshot?.stateRevision ?? 0,
              status: e.finalStatus,
            })
          ).snapshot as CanonicalPlaybackSnapshot;
        }
        return;
      }
      const error = e instanceof Error ? e.message : String(e);
      if (this.shutdownRequested || error === 'runner-aborted' || error === 'lease-fencing-conflict') return;

      if (this.currentSnapshot?.status !== 'error') {
        this.currentSnapshot = (
          await this.finalize({
            broadcastRunId: runId,
            playlistId: this.opts.playlistId,
            runnerId: this.id,
            leaseGeneration: this.leaseGeneration ?? 0,
            expectedRevision: this.currentSnapshot?.stateRevision ?? 0,
            status: 'error',
            reason: error,
          })
        ).snapshot as CanonicalPlaybackSnapshot;
      }
      throw e;
    } finally {
      if (this.leaseTimer) clearInterval(this.leaseTimer);
      if (this.leaseGeneration != null)
        await releaseRunnerLease(runId, this.id, this.leaseGeneration).catch(() => undefined);
      this.runId = null;
      this.running = false;
    }
  }

  async start() {
    await this.initialize();
    await this.run();
  }

  private async finalize(input: Parameters<typeof finalizePlaybackRun>[0]) {
    try {
      return await finalizePlaybackRun(input);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('playback-revision-conflict:')) throw error;
      const latest = await getPlaybackSnapshot();
      return finalizePlaybackRun({ ...input, expectedRevision: latest.stateRevision });
    }
  }

  private async renewLeaseOrStop() {
    if (!this.runId || !this.running) return;
    const lease = await renewRunnerLease(this.runId, this.id, 15, this.leaseGeneration ?? 0);
    if (!lease) {
      this.abortController.abort();
      await this.opts.obs.stopMedia().catch(() => undefined);
      this.running = false;
    }
  }
  private async pollPersistentCommand(runId: string): Promise<CommandEnvelope | undefined> {
    if (this.shutdownRequested) throw new ControlledStop('interrupted', true);
    const lease = await getRunnerLease(runId);
    if (
      !lease ||
      lease.runner_id !== this.id ||
      (lease.lease_generation != null &&
        this.leaseGeneration &&
        Number(lease.lease_generation) !== this.leaseGeneration)
    )
      throw new ControlledStop('interrupted', true);
    const leaseGeneration = Number(lease.lease_generation ?? 1);
    const cmd = await claimNextBroadcastCommand(runId, this.id, 15, leaseGeneration).catch(() => null);
    if (!cmd) return undefined;
    return {
      id: cmd.id,
      sequence: Number(cmd.sequence),
      command: cmd.command as Control,
      expectedRevision: Number(cmd.expected_revision ?? this.currentSnapshot?.stateRevision ?? 0),
      expectedStatus: cmd.expected_status ?? null,
      idempotencyKey: cmd.idempotency_key,
      runnerId: this.id,
      leaseGeneration,
    };
  }
  private async nextCommand(
    runId: string,
    ctx: {
      playlistId: string;
      itemId?: string | null;
      articleId?: string | null;
      position?: number | null;
      media?: Record<string, unknown>;
    },
  ) {
    const env = await this.pollPersistentCommand(runId);
    if (!env) return undefined;
    const result = await this.commandExecutor.execute(env, { ...ctx, runId });
    this.currentSnapshot = ((result as any)?.snapshot ?? (await getPlaybackSnapshot())) as CanonicalPlaybackSnapshot;
    return env.command;
  }
  private async pause(runId: string, base: Record<string, unknown>): Promise<PauseResult> {
    while (true) {
      const c = await this.nextCommand(runId, {
        playlistId: this.opts.playlistId,
        itemId: nullableBroadcastReference(base.itemId),
        articleId: nullableBroadcastReference(base.articleId),
        position: Number.isFinite(Number(base.position)) ? Number(base.position) : null,
      });
      if (c === 'skip') {
        return 'skip';
      }
      if (c === 'stop') {
        return 'stop';
      }
      if (c === 'resume') break;
      await new Promise((r) => setTimeout(r, this.opts.pollMs ?? 100));
    }

    return 'resume';
  }
  private async runtimeTransition(input: Parameters<typeof applyRuntimeTransition>[0]) {
    try {
      return await applyRuntimeTransition(input);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        (!error.message.startsWith('playback-revision-conflict:') &&
          !error.message.startsWith('playback-status-conflict:'))
      )
        throw error;
      const latest = await getPlaybackSnapshot();
      return applyRuntimeTransition({ ...input, expectedRevision: latest.stateRevision, fromStatus: undefined });
    }
  }
  private async loop(runId: string) {
    if (this.shutdownRequested) throw new ControlledStop('interrupted', true);
    const playlist = await getBroadcastPlaylist(this.opts.playlistId);
    if (!playlist) throw new Error('Sendeliste nicht gefunden');
    const playlistSettings = (playlist.settings ?? {}) as { pauseSeconds?: unknown };
    const pauseBetweenItemsMs = Math.max(
      0,
      Math.min(600_000, Math.floor(Number(playlistSettings.pauseSeconds ?? 0) * 1000)),
    );
    const prerollMs = this.opts.maintenanceDelayMs ?? 1200;
    const items = await listBroadcastItems(playlist.id);
    const programIntroPath = this.opts.programIntroPath?.trim();
    const suppressProgramIntro = this.currentSnapshot?.startConfig?.suppressProgramIntro === true;
    if (
      programIntroPath &&
      !suppressProgramIntro &&
      shouldPlayProgramIntro({
        recoveryMode: this.currentSnapshot?.recoveryMode,
        currentPosition: playlist.current_position,
        items,
      })
    ) {
      try {
        await stat(programIntroPath);
        await this.opts.obs.playProgramIntro(programIntroPath, this.opts.programIntroDurationMs ?? 8000);
      } catch {
        // Ein fehlendes oder defektes Intro darf den eigentlichen Broadcast niemals stoppen.
      }
    }
    for (let i = playlist.current_position; i < items.length; i++) {
      if (this.shutdownRequested) throw new ControlledStop('interrupted', true);
      const item = items[i];
      if (item.status === 'played') continue;
      const base = { playlistId: playlist.id, runId, itemId: item.id, articleId: item.article_id, position: i };
      const pending = await this.nextCommand(runId, {
        playlistId: playlist.id,
        itemId: item.id,
        articleId: item.article_id,
        position: i,
      });
      if (pending === 'stop') throw new ControlledStop('interrupted');
      if (pending === 'skip') continue;

      try {
        const youtube = youtubeItemRules(item);
        if (youtube) {
          const resuming =
            Boolean(item.started_at) &&
            !item.finished_at &&
            !['planned', 'played', 'skipped'].includes(item.status ?? '');
          const contextPlaybackControl =
            youtube.layout === 'youtube-context'
              ? await getYoutubeContextPlaybackControl(item.id).catch(() => null)
              : null;
          const playbackWindow = youtubePlaybackWindow(
            item,
            youtube.durationMs,
            Date.now(),
            youtubeContextPauseDurationMs(contextPlaybackControl),
          );
          const viewerUrl = youtubeViewerUrl(
            this.opts.overlayUrl,
            youtube.videoId,
            item.id,
            playbackWindow.startSeconds,
          );
          const overlayUrl =
            youtube.layout === 'news-sidebar'
              ? youtubeNewsSidebarOverlayUrl(this.opts.overlayUrl, youtube, item.id)
              : youtube.layout === 'youtube-context'
                ? youtubeContextOverlayUrl(this.opts.overlayUrl, youtube, item.id)
                : youtubeOverlayUrl(this.opts.overlayUrl, youtube, item.id);
          this.currentSnapshot = (
            await this.runtimeTransition({
              broadcastRunId: runId,
              playlistId: playlist.id,
              runnerId: this.id,
              leaseGeneration: this.leaseGeneration ?? 0,
              expectedRevision: this.currentSnapshot?.stateRevision ?? (await getPlaybackSnapshot()).stateRevision,
              fromStatus: this.currentSnapshot?.status ?? undefined,
              status: 'preparing',
              runStatus: 'running',
              playlistStatus: 'running',
              itemStatus: 'preparing',
              itemId: item.id,
              articleId: item.article_id,
              position: i,
              eventType: 'article-prepared',
              dedupeKey: `${runId}:${item.id}:prepared`,
              payload: { ...base, youtubeVideoId: youtube.videoId, title: youtube.title, channel: youtube.channel },
              media: { viewerUrl, durationMs: youtube.durationMs },
            })
          ).snapshot as CanonicalPlaybackSnapshot;
          await new Promise((r) => setTimeout(r, i > 0 ? pauseBetweenItemsMs : prerollMs));
          if (this.shutdownRequested) throw new ControlledStop('interrupted', true);
          await resetYoutubeContextPlaybackControl(item.id, youtube.layout === 'youtube-context' && resuming);
          const playYoutube =
            youtube.layout === 'news-sidebar'
              ? this.opts.obs.playYoutubeNewsSidebarContribution.bind(this.opts.obs)
              : youtube.layout === 'youtube-context'
                ? this.opts.obs.playYoutubeContextContribution.bind(this.opts.obs)
                : this.opts.obs.playYoutubeVideoContribution.bind(this.opts.obs);
          const playerProbeStartedAt = Date.now();
          await playYoutube({
            itemId: item.id,
            title: youtube.title,
            viewerUrl,
            overlayUrl,
            durationMs: playbackWindow.remainingDurationMs,
            onState: async (s) => {
              const status = (
                s.status === 'playing' ? 'playing' : s.status === 'ended' ? 'ended' : 'preparing'
              ) as PlaybackStatus;
              if (status === 'playing' && this.currentSnapshot?.status !== 'playing')
                this.currentSnapshot = (
                  await this.runtimeTransition({
                    broadcastRunId: runId,
                    playlistId: playlist.id,
                    runnerId: this.id,
                    leaseGeneration: this.leaseGeneration ?? 0,
                    expectedRevision:
                      this.currentSnapshot?.stateRevision ?? (await getPlaybackSnapshot()).stateRevision,
                    fromStatus: 'preparing',
                    status: 'playing',
                    runStatus: 'running',
                    playlistStatus: 'running',
                    itemStatus: 'playing',
                    itemId: item.id,
                    articleId: item.article_id,
                    position: i,
                    eventType: 'item-started',
                    dedupeKey: `${runId}:${item.id}:started`,
                    payload: {
                      ...base,
                      youtubeVideoId: youtube.videoId,
                      title: youtube.title,
                      channel: youtube.channel,
                      resumeOffsetSeconds: playbackWindow.startSeconds,
                      remainingDurationMs: playbackWindow.remainingDurationMs,
                    },
                  })
                ).snapshot as CanonicalPlaybackSnapshot;
            },
            control: async () => {
              const c = await this.nextCommand(runId, {
                playlistId: playlist.id,
                itemId: item.id,
                articleId: item.article_id,
                position: i,
              });
              if (c === 'stop') return 'stop';
              if (c === 'skip') return 'skip';
              if (c === 'pause') return 'pause';
              return undefined;
            },
            onPaused: () => this.pause(runId, base),
            shouldEndPlayback: async () => {
              const control = await getYoutubeContextPlaybackControl(item.id).catch(() => null);
              return youtubePlayerReachedEnd(control) || youtubePlayerUnavailable(control, playerProbeStartedAt);
            },
            ...(youtube.layout === 'youtube-context'
              ? {
                  shouldHoldPlayback: async () =>
                    Boolean((await getYoutubeContextPlaybackControl(item.id).catch(() => null))?.paused),
                }
              : {}),
          });
          await resetYoutubeContextPlaybackControl(item.id).catch(() => null);
          this.currentSnapshot = (
            await this.runtimeTransition({
              broadcastRunId: runId,
              playlistId: playlist.id,
              runnerId: this.id,
              leaseGeneration: this.leaseGeneration ?? 0,
              expectedRevision: this.currentSnapshot?.stateRevision ?? (await getPlaybackSnapshot()).stateRevision,
              fromStatus: this.currentSnapshot?.status ?? undefined,
              status: i + 1 < items.length ? 'preparing' : 'ended',
              runStatus: i + 1 < items.length ? 'running' : 'ended',
              playlistStatus: i + 1 < items.length ? 'running' : 'ended',
              itemStatus: 'played',
              itemId: item.id,
              articleId: item.article_id,
              position: i + 1,
              eventType: i + 1 < items.length ? 'item-ended' : 'broadcast-ended',
              dedupeKey: `${runId}:${item.id}:ended`,
              payload: { ...base, youtubeVideoId: youtube.videoId, title: youtube.title, channel: youtube.channel },
            })
          ).snapshot as CanonicalPlaybackSnapshot;
          continue;
        }
        const audioPath = await requireUsableAudioPath(item.audio_path);
        this.lastArticleId = item.article_id;

        this.currentSnapshot = (
          await this.runtimeTransition({
            broadcastRunId: runId,
            playlistId: playlist.id,
            runnerId: this.id,
            leaseGeneration: this.leaseGeneration ?? 0,
            expectedRevision: this.currentSnapshot?.stateRevision ?? (await getPlaybackSnapshot()).stateRevision,
            fromStatus: this.currentSnapshot?.status ?? undefined,
            status: 'preparing',
            runStatus: 'running',
            playlistStatus: 'running',
            itemStatus: 'preparing',
            itemId: item.id,
            articleId: item.article_id,
            position: i,
            eventType: 'article-prepared',
            dedupeKey: `${runId}:${item.id}:prepared`,
            payload: base,
            media: { audioPath },
          })
        ).snapshot as CanonicalPlaybackSnapshot;
        await new Promise((r) => setTimeout(r, i > 0 ? pauseBetweenItemsMs : prerollMs));
        if (this.shutdownRequested) throw new ControlledStop('interrupted', true);
        if (!item.article_id) throw new Error('Nachrichtenbeitrag ohne Artikel-ID kann nicht abgespielt werden');
        await this.opts.obs.playTestContribution({
          articleId: item.article_id,
          audioPath,
          overlayUrl: this.opts.overlayUrl,
          expectedDurationMs:
            Number.isFinite(Number(item.audio_duration_seconds)) && Number(item.audio_duration_seconds) > 0
              ? Math.ceil(Number(item.audio_duration_seconds) * 1000)
              : undefined,
          timeoutMs:
            Number.isFinite(Number(item.audio_duration_seconds)) && Number(item.audio_duration_seconds) > 0
              ? Math.max(60_000, Math.ceil(Number(item.audio_duration_seconds) * 1000) + 30_000)
              : undefined,
          onState: async (s) => {
            const status = (
              s.status === 'playing' ? 'playing' : s.status === 'ended' ? 'ended' : 'preparing'
            ) as PlaybackStatus;

            if (status === 'playing' && this.currentSnapshot?.status !== 'playing')
              this.currentSnapshot = (
                await this.runtimeTransition({
                  broadcastRunId: runId,
                  playlistId: playlist.id,
                  runnerId: this.id,
                  leaseGeneration: this.leaseGeneration ?? 0,
                  expectedRevision: this.currentSnapshot?.stateRevision ?? (await getPlaybackSnapshot()).stateRevision,
                  fromStatus: 'preparing',
                  status: 'playing',
                  runStatus: 'running',
                  playlistStatus: 'running',
                  itemStatus: 'playing',
                  itemId: item.id,
                  articleId: item.article_id,
                  position: i,
                  eventType: 'item-started',
                  dedupeKey: `${runId}:${item.id}:started`,
                  payload: base,
                })
              ).snapshot as CanonicalPlaybackSnapshot;
          },
          control: async () => {
            const c = await this.nextCommand(runId, {
              playlistId: playlist.id,
              itemId: item.id,
              articleId: item.article_id,
              position: i,
            });
            if (c === 'stop') {
              return 'stop';
            }
            if (c === 'skip') {
              return 'skip';
            }
            if (c === 'pause') return 'pause';
            return undefined;
          },
          onPaused: () => this.pause(runId, base),
        });

        this.currentSnapshot = (
          await this.runtimeTransition({
            broadcastRunId: runId,
            playlistId: playlist.id,
            runnerId: this.id,
            leaseGeneration: this.leaseGeneration ?? 0,
            expectedRevision: this.currentSnapshot?.stateRevision ?? (await getPlaybackSnapshot()).stateRevision,
            fromStatus: this.currentSnapshot?.status ?? undefined,
            status: i + 1 < items.length ? 'preparing' : 'ended',
            runStatus: i + 1 < items.length ? 'running' : 'ended',
            playlistStatus: i + 1 < items.length ? 'running' : 'ended',
            itemStatus: 'played',
            itemId: item.id,
            articleId: item.article_id,
            position: i + 1,
            eventType: i + 1 < items.length ? 'item-ended' : 'broadcast-ended',
            dedupeKey: `${runId}:${item.id}:ended`,
            payload: base,
          })
        ).snapshot as CanonicalPlaybackSnapshot;
      } catch (e) {
        if (e instanceof ControlledStop) throw e;
        if (
          this.shutdownRequested ||
          (e instanceof Error && (e.message === 'runner-aborted' || e.message === 'lease-fencing-conflict'))
        )
          throw new ControlledStop('interrupted', true);
        if (e instanceof Error && e.message === 'skip') {
          this.currentSnapshot = (
            await this.runtimeTransition({
              broadcastRunId: runId,
              playlistId: playlist.id,
              runnerId: this.id,
              leaseGeneration: this.leaseGeneration ?? 0,
              expectedRevision: this.currentSnapshot?.stateRevision ?? (await getPlaybackSnapshot()).stateRevision,
              fromStatus: this.currentSnapshot?.status ?? undefined,
              status: i + 1 < items.length ? 'preparing' : 'ended',
              runStatus: i + 1 < items.length ? 'running' : 'ended',
              playlistStatus: i + 1 < items.length ? 'running' : 'ended',
              itemStatus: 'skipped',
              itemId: item.id,
              articleId: item.article_id,
              position: i + 1,
              eventType: 'item-skipped',
              dedupeKey: `${runId}:${item.id}:skipped`,
              payload: base,
            })
          ).snapshot as CanonicalPlaybackSnapshot;
          continue;
        }
        if (e instanceof Error && e.message === 'stop') throw new ControlledStop('interrupted');
        const message = e instanceof Error ? e.message : String(e);
        this.currentSnapshot = (
          await this.runtimeTransition({
            broadcastRunId: runId,
            playlistId: playlist.id,
            runnerId: this.id,
            leaseGeneration: this.leaseGeneration ?? 0,
            expectedRevision: this.currentSnapshot?.stateRevision ?? (await getPlaybackSnapshot()).stateRevision,
            fromStatus: this.currentSnapshot?.status ?? undefined,
            status: 'error',
            runStatus: 'error',
            playlistStatus: 'error',
            itemStatus: 'error',
            itemId: item.id,
            articleId: item.article_id,
            position: i,
            eventType: 'broadcast-error',
            dedupeKey: `${runId}:${item.id}:error`,
            payload: { ...base, error: { message } },
            errorDetails: { message },
          })
        ).snapshot as CanonicalPlaybackSnapshot;
        throw e;
      }
    }
  }
}
export function startInBackground(runner: BroadcastRunner) {
  void runner.start().catch(() => undefined);
  return runner;
}
