import { randomBytes } from 'node:crypto';
import {
  activeBroadcastRun,
  getBroadcastPlaylist,
  listBroadcastItems,
  markBroadcastItem,
  setArticleStatus,
  setBroadcastPlaylistState,
  setPlaybackState,
  tryStartBroadcastRun,
  updateBroadcastRun,
  appendLiveEvent,
  acquireRunnerLease,
  renewRunnerLease,
  releaseRunnerLease,
  claimNextBroadcastCommand,
  markBroadcastCommandExecuting,
  failBroadcastCommand,
  getRunnerLease,
  applyBroadcastCommandTransaction,
} from '@ans/database';
import type { ObsController } from '@ans/obs-controller';
import { PlaybackCommandProcessor, PlaybackConflictError } from './playback/processor.js';
import type { BroadcastCommand } from './playback/state.js';

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
export type { PlaybackSnapshot, AcceptedCommand, TransitionResult } from './playback/state.js';
export interface BroadcastRunnerOptions {
  obs: ObsController;
  playlistId: string;
  overlayUrl: string;
  maintenanceDelayMs?: number;
  pollMs?: number;
  recoverRunId?: string;
}
async function emitLiveEvent(input: any) {
  await appendLiveEvent(input);
}
class ControlledStop extends Error {
  constructor(public finalStatus: 'ended' | 'interrupted' = 'ended') {
    super('Sendelauf kontrolliert beendet');
  }
}
class PlaybackController {
  private processor = new PlaybackCommandProcessor({ status: 'idle' });

  constructor(private persist: (status: PlaybackStatus, payload?: Record<string, unknown>) => Promise<void>) {}

  state() {
    return this.processor.state().status;
  }

  processorState() {
    return this.processor.state();
  }

  command(c: Control) {
    const accepted = this.processor.enqueue(c);
    return accepted.seq;
  }

  async transition(status: PlaybackStatus, payload: Record<string, unknown> = {}) {
    const current = this.processor.state();
    this.processor = new PlaybackCommandProcessor({
      ...current,
      status,
      stateRevision: current.stateRevision + 1,
    });
    await this.persist(status, {
      ...payload,
      commandSeq: this.processor.state().commandSeq,
      stateRevision: this.processor.state().stateRevision,
    });
  }

  consume(): Control | undefined {
    const processed = this.processor.process();
    const next = processed.acceptedSequence.find((entry) => entry.accepted && entry.status === 'completed');
    return next?.command;
  }

  clearStaleAfterRestart() {
    this.processor.clear();
  }
}
export class BroadcastRunner {
  public readonly id = `runner-${randomBytes(16).toString('hex')}`;
  private running = false;
  private leaseTimer: NodeJS.Timeout | null = null;
  private runId: string | null = null;
  private lastArticleId: string | null = null;
  private controller: PlaybackController;
  constructor(private opts: BroadcastRunnerOptions) {
    this.controller = new PlaybackController(async (status, payload = {}) => {
      await setPlaybackState({ status, playlistId: opts.playlistId, ...payload });
    });
    if (opts.recoverRunId) this.controller.clearStaleAfterRestart();
  }
  isRunning() {
    return this.running;
  }
  control(c: Control) {
    if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
      throw new Error('Direkte Runner-Steuerung ist im persistenten Produktionspfad deaktiviert');
    }
    return this.controller.command(c);
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
    this.leaseTimer = setInterval(() => void this.renewLeaseOrStop(), 5000);
    this.running = true;
    await setBroadcastPlaylistState(this.opts.playlistId, 'running');
    try {
      await this.loop(run.id);
      await updateBroadcastRun(run.id, 'ended', { status: 'ended' });
      await setBroadcastPlaylistState(this.opts.playlistId, 'ended');
      await this.controller.transition('ended', { runId: run.id, articleId: this.lastArticleId });
    } catch (e) {
      if (e instanceof ControlledStop) {
        await updateBroadcastRun(run.id, e.finalStatus, { status: e.finalStatus, reason: e.message });
        await setBroadcastPlaylistState(this.opts.playlistId, e.finalStatus === 'ended' ? 'ended' : 'error');
        await emitLiveEvent({
          type: 'broadcast-stopped',
          broadcastRunId: run.id,
          payload: { status: e.finalStatus },
        });
        await this.controller.transition(e.finalStatus, { runId: run.id });
        return;
      }
      const error = e instanceof Error ? e.message : String(e);
      await updateBroadcastRun(run.id, 'error', { status: 'error', error });
      await setBroadcastPlaylistState(this.opts.playlistId, 'error');
      await this.controller.transition('error', { runId: run.id, error });
      throw e;
    } finally {
      if (this.leaseTimer) clearInterval(this.leaseTimer);
      await releaseRunnerLease(run.id, this.id).catch(() => undefined);
      this.runId = null;
      this.running = false;
    }
  }

  private async renewLeaseOrStop() {
    if (!this.runId || !this.running) return;
    const lease = await renewRunnerLease(this.runId, this.id);
    if (!lease) {
      await this.opts.obs.stopMedia().catch(() => undefined);
      await appendLiveEvent({
        type: 'broadcast-control',
        broadcastRunId: this.runId,
        payload: { status: 'lease_lost', runnerId: this.id },
        dedupeKey: `${this.runId}:${this.id}:lease-lost`,
      }).catch(() => undefined);
      await this.controller.transition('interrupted', { recoveryMode: 'lease_lost' }).catch(() => undefined);
      this.running = false;
    }
  }
  private async pollPersistentCommand(runId: string): Promise<CommandEnvelope | undefined> {
    const lease = await getRunnerLease(runId);
    if (!lease || lease.runner_id !== this.id) throw new ControlledStop('interrupted');
    const leaseGeneration = Number(lease.lease_generation ?? 1);
    const cmd = await claimNextBroadcastCommand(runId, this.id, 15, leaseGeneration).catch(() => null);
    if (!cmd) return undefined;
    return {
      id: cmd.id,
      sequence: Number(cmd.sequence),
      command: cmd.command as Control,
      expectedRevision: Number(cmd.expected_revision ?? this.controller.processorState().stateRevision),
      expectedStatus: cmd.expected_status ?? null,
      idempotencyKey: cmd.idempotency_key,
      runnerId: this.id,
      leaseGeneration,
    };
  }
  private async executeEnvelope(
    env: CommandEnvelope,
    ctx: {
      runId: string;
      playlistId: string;
      itemId?: string | null;
      articleId?: string | null;
      position?: number | null;
      media?: Record<string, unknown>;
    },
  ) {
    const executing = await markBroadcastCommandExecuting(env.id, this.id, env.leaseGeneration);
    if (!executing) throw new Error('command-execute-fencing-conflict');
    this.controller.command(env.command);
    const nextStatus: Record<Control, PlaybackStatus> = {
      pause: 'paused',
      resume: 'playing',
      skip: 'skipping',
      stop: 'stopping',
    };
    const eventType: Record<Control, string> = {
      pause: 'item-paused',
      resume: 'item-resumed',
      skip: 'item-skipped',
      stop: 'broadcast-stopped',
    };
    try {
      await applyBroadcastCommandTransaction({
        commandId: env.id,
        runnerId: this.id,
        leaseGeneration: env.leaseGeneration,
        expectedRevision: env.expectedRevision,
        status: nextStatus[env.command],
        playlistStatus: env.command === 'pause' ? 'paused' : env.command === 'stop' ? 'interrupted' : 'running',
        runStatus: env.command === 'stop' ? 'interrupted' : 'running',
        playlistId: ctx.playlistId,
        broadcastRunId: ctx.runId,
        itemId: ctx.itemId,
        articleId: ctx.articleId,
        position: ctx.position,
        eventType: eventType[env.command],
        payload: {
          command: env.command,
          commandId: env.id,
          sequence: env.sequence,
          runnerId: this.id,
          leaseGeneration: env.leaseGeneration,
        },
        media: ctx.media,
      });
    } catch (e) {
      await failBroadcastCommand(env.id, this.id, 'apply_failed', {
        message: e instanceof Error ? e.message : String(e),
      }).catch(() => undefined);
      throw e;
    }
    return env.command;
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
    return env ? this.executeEnvelope(env, { ...ctx, runId }) : this.controller.consume();
  }
  private async pause(runId: string, base: Record<string, unknown>): Promise<PauseResult> {
    await this.controller.transition('pausing', base);
    await updateBroadcastRun(runId, 'paused', { status: 'pausing', ...base });
    await this.controller.transition('paused', base);
    await setBroadcastPlaylistState(this.opts.playlistId, 'paused');
    await emitLiveEvent({
      type: 'item-paused',
      broadcastRunId: runId,
      articleId: String(base.articleId),
      payload: base,
    });
    while (true) {
      const c = await this.nextCommand(runId, {
        playlistId: this.opts.playlistId,
        itemId: String(base.itemId),
        articleId: String(base.articleId),
        position: Number(base.position),
      });
      if (c === 'skip') {
        await emitLiveEvent({
          type: 'item-skipped',
          broadcastRunId: runId,
          articleId: String(base.articleId),
          payload: base,
        });
        await this.opts.obs.stopMedia().catch(() => undefined);
        return 'skip';
      }
      if (c === 'stop') {
        await this.opts.obs.stopMedia().catch(() => undefined);
        return 'stop';
      }
      if (c === 'resume') break;
      await new Promise((r) => setTimeout(r, this.opts.pollMs ?? 100));
    }
    await this.controller.transition('resuming', base);
    await emitLiveEvent({
      type: 'item-resumed',
      broadcastRunId: runId,
      articleId: String(base.articleId),
      payload: base,
    });
    await setBroadcastPlaylistState(this.opts.playlistId, 'running');
    await this.controller.transition('playing', base);
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
      const skipCurrent = pending === 'skip';
      await setBroadcastPlaylistState(playlist.id, 'running', i);
      try {
        if (!item.audio_path) throw new Error('Kein Sprecher-Audio für Beitrag vorhanden');
        this.lastArticleId = item.article_id;
        await markBroadcastItem(item.id, 'playing');
        await setArticleStatus(item.article_id, 'published');
        await updateBroadcastRun(runId, 'running', { status: 'preparing', ...base });
        await this.controller.transition('preparing', base);
        if (skipCurrent) this.controller.command('skip');
        await emitLiveEvent({
          type: 'article-prepared',
          broadcastRunId: runId,
          articleId: item.article_id,
          payload: base,
          dedupeKey: `${runId}:${item.id}:prepared`,
        });
        await new Promise((r) => setTimeout(r, this.opts.maintenanceDelayMs ?? 250));
        await this.opts.obs.playTestContribution({
          articleId: item.article_id,
          audioPath: item.audio_path,
          overlayUrl: this.opts.overlayUrl,
          onState: async (s) => {
            const status = (
              s.status === 'playing' ? 'playing' : s.status === 'ended' ? 'ended' : 'preparing'
            ) as PlaybackStatus;
            await updateBroadcastRun(runId, status === 'ended' ? 'running' : 'running', { ...s, ...base });
            await this.controller.transition(status, base);
            if (status === 'playing')
              await emitLiveEvent({
                type: 'item-started',
                broadcastRunId: runId,
                articleId: item.article_id,
                payload: base,
                dedupeKey: `${runId}:${item.id}:started`,
              });
          },
          control: async () => {
            const c = await this.nextCommand(runId, {
              playlistId: playlist.id,
              itemId: item.id,
              articleId: item.article_id,
              position: i,
            });
            if (c === 'stop') {
              await this.controller.transition('stopping', base);
              return 'stop';
            }
            if (c === 'skip') {
              await this.controller.transition('skipping', base);
              return 'skip';
            }
            if (c === 'pause') return 'pause';
            return undefined;
          },
          onPaused: () => this.pause(runId, base),
        });
        await markBroadcastItem(item.id, 'played');
        await emitLiveEvent({ type: 'item-ended', broadcastRunId: runId, articleId: item.article_id, payload: base });
      } catch (e) {
        if (e instanceof Error && e.message === 'skip') {
          await markBroadcastItem(item.id, 'skipped', 'Manuell übersprungen');
          await emitLiveEvent({
            type: 'item-skipped',
            broadcastRunId: runId,
            articleId: item.article_id,
            payload: base,
          });
          continue;
        }
        if (e instanceof Error && e.message === 'stop') throw new ControlledStop('interrupted');
        const error = e instanceof Error ? e.message : String(e);
        await markBroadcastItem(item.id, 'error', error);
        await this.controller.transition('error', { ...base, error });
        continue;
      }
    }
  }
}
export function startInBackground(runner: BroadcastRunner) {
  void runner.start().catch(() => undefined);
  return runner;
}
