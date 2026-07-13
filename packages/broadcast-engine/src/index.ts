import { randomBytes } from 'node:crypto';
import {
  activeBroadcastRun,
  getBroadcastPlaylist,
  listBroadcastItems,
  tryStartBroadcastRun,
  getPlaybackSnapshot,
  applyRuntimeTransition,
  acquireRunnerLease,
  renewRunnerLease,
  releaseRunnerLease,
  claimNextBroadcastCommand,
  getRunnerLease,
  initializePlaybackRun,
  finalizePlaybackRun,
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
export { PlaybackCommandProcessor, PlaybackConflictError };
export { transitionTable, validateTransition } from './playback/transitions.js';
export { PlaybackConsistencyError } from './playback/state.js';
export type { PlaybackSnapshot, AcceptedCommand, TransitionResult } from './playback/state.js';
export interface BroadcastRunnerOptions {
  obs: ObsController;
  playlistId: string;
  overlayUrl: string;
  maintenanceDelayMs?: number;
  pollMs?: number;
  recoverRunId?: string;
  runnerId?: string;
}
class ControlledStop extends Error {
  constructor(public finalStatus: 'ended' | 'interrupted' = 'ended') {
    super('Sendelauf kontrolliert beendet');
  }
}
export class BroadcastRunner {
  public readonly id: string;
  private running = false;
  private leaseTimer: NodeJS.Timeout | null = null;
  private runId: string | null = null;
  private leaseGeneration: number | null = null;
  private abortController = new AbortController();
  private lastArticleId: string | null = null;
  private commandExecutor: BroadcastCommandExecutor;
  private currentSnapshot: CanonicalPlaybackSnapshot | null = null;
  private readonly inProcessTestControls: Control[] = [];
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
    this.running = false;
    this.abortController.abort();
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    await this.opts.obs.pauseMedia().catch(() => undefined);
    if (this.runId)
      if (this.leaseGeneration != null)
        await releaseRunnerLease(this.runId, this.id, this.leaseGeneration).catch(() => undefined);
  }

  control(c: Control) {
    if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
      throw new Error('Direkte Runner-Steuerung ist im persistenten Produktionspfad deaktiviert');
    }
    this.inProcessTestControls.push(c);
    const processor = new PlaybackCommandProcessor({ status: 'playing' });
    return processor.transition(c).acceptedSequence[0].seq;
  }
  async start() {
    if (this.running) throw new Error('Sendelauf läuft bereits in diesem Prozess');
    let run = this.opts.recoverRunId ? await activeBroadcastRun() : null;
    if (run && run.id !== this.opts.recoverRunId) run = null;
    if (!run) {
      const existing = await activeBroadcastRun();
      if (existing) throw new Error('Es läuft bereits ein aktiver Sendelauf');
      run = await tryStartBroadcastRun(this.opts.playlistId);
    }
    if (!run) throw new Error('Aktiver Sendelauf konnte nicht gestartet werden');
    const lease = await acquireRunnerLease(run.id, this.id);
    if (!lease) throw new Error('Sendelauf ist durch einen anderen Runner gesperrt');
    this.runId = run.id;
    this.leaseGeneration = Number(lease.lease_generation ?? 1);
    this.leaseTimer = setInterval(() => void this.renewLeaseOrStop(), 5000);
    this.running = true;
    this.currentSnapshot = (await initializePlaybackRun({
      broadcastRunId: run.id,
      playlistId: this.opts.playlistId,
      status: 'starting',
    })) as CanonicalPlaybackSnapshot;
    try {
      await this.loop(run.id);

      this.currentSnapshot = (
        await finalizePlaybackRun({
          broadcastRunId: run.id,
          playlistId: this.opts.playlistId,
          runnerId: this.id,
          leaseGeneration: this.leaseGeneration ?? 0,
          expectedRevision: this.currentSnapshot?.stateRevision ?? 0,
          status: 'ended',
        })
      ).snapshot as CanonicalPlaybackSnapshot;
    } catch (e) {
      if (e instanceof ControlledStop) {
        this.currentSnapshot = (
          await finalizePlaybackRun({
            broadcastRunId: run.id,
            playlistId: this.opts.playlistId,
            runnerId: this.id,
            leaseGeneration: this.leaseGeneration ?? 0,
            expectedRevision: this.currentSnapshot?.stateRevision ?? 0,
            status: e.finalStatus,
          })
        ).snapshot as CanonicalPlaybackSnapshot;
        return;
      }
      const error = e instanceof Error ? e.message : String(e);

      this.currentSnapshot = (
        await finalizePlaybackRun({
          broadcastRunId: run.id,
          playlistId: this.opts.playlistId,
          runnerId: this.id,
          leaseGeneration: this.leaseGeneration ?? 0,
          expectedRevision: this.currentSnapshot?.stateRevision ?? 0,
          status: 'error',
          reason: error,
        })
      ).snapshot as CanonicalPlaybackSnapshot;
      throw e;
    } finally {
      if (this.leaseTimer) clearInterval(this.leaseTimer);
      if (this.leaseGeneration != null)
        await releaseRunnerLease(run.id, this.id, this.leaseGeneration).catch(() => undefined);
      this.runId = null;
      this.running = false;
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
    const lease = await getRunnerLease(runId);
    if (
      !lease ||
      lease.runner_id !== this.id ||
      (lease.lease_generation != null &&
        this.leaseGeneration &&
        Number(lease.lease_generation) !== this.leaseGeneration)
    )
      throw new ControlledStop('interrupted');
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
    const inProcessControl = this.inProcessTestControls.shift();
    if (inProcessControl) return inProcessControl;
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
        itemId: String(base.itemId),
        articleId: String(base.articleId),
        position: Number(base.position),
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
  private async loop(runId: string) {
    const playlist = await getBroadcastPlaylist(this.opts.playlistId);
    if (!playlist) throw new Error('Sendeliste nicht gefunden');
    const items = await listBroadcastItems(playlist.id);
    for (let i = playlist.current_position; i < items.length; i++) {
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
        if (!item.audio_path) throw new Error('Kein Sprecher-Audio für Beitrag vorhanden');
        this.lastArticleId = item.article_id;

        this.currentSnapshot = (
          await applyRuntimeTransition({
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
            media: { audioPath: item.audio_path },
          })
        ).snapshot as CanonicalPlaybackSnapshot;
        await new Promise((r) => setTimeout(r, this.opts.maintenanceDelayMs ?? 250));
        await this.opts.obs.playTestContribution({
          articleId: item.article_id,
          audioPath: item.audio_path,
          overlayUrl: this.opts.overlayUrl,
          onState: async (s) => {
            const status = (
              s.status === 'playing' ? 'playing' : s.status === 'ended' ? 'ended' : 'preparing'
            ) as PlaybackStatus;

            if (status === 'playing' && this.currentSnapshot?.status !== 'playing')
              this.currentSnapshot = (
                await applyRuntimeTransition({
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
          await applyRuntimeTransition({
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
        if (e instanceof Error && e.message === 'skip') {
          this.currentSnapshot = (
            await applyRuntimeTransition({
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
        continue;
      }
    }
  }
}
export function startInBackground(runner: BroadcastRunner) {
  void runner.start().catch(() => undefined);
  return runner;
}
