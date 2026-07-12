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
  query,
} from '@ans/database';
import type { ObsController } from '@ans/obs-controller';
import { PlaybackCommandProcessor, PlaybackConflictError } from './playback/processor.js';
import type { BroadcastCommand } from './playback/state.js';

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
async function emitLiveEvent(input: Record<string, unknown>) {
  try {
    await query?.(
      `insert into live_events(type,broadcast_run_id,article_id,overlay_version_id,payload,dedupe_key) values($1,$2,$3,$4,$5,$6) on conflict (dedupe_key) where dedupe_key is not null do nothing`,
      [
        input.type,
        input.broadcastRunId ?? null,
        input.articleId ?? null,
        input.overlayVersionId ?? null,
        input.payload ?? {},
        input.dedupeKey ?? null,
      ],
    );
  } catch {
    // Unit tests may mock a pre-migration database; playback control must continue.
  }
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
  private running = false;
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
    this.running = true;
    await setBroadcastPlaylistState(this.opts.playlistId, 'running');
    try {
      await this.loop(run.id);
      await updateBroadcastRun(run.id, 'ended', { status: 'ended' });
      await setBroadcastPlaylistState(this.opts.playlistId, 'ended');
      await this.controller.transition('ended', { runId: run.id });
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
      this.running = false;
    }
  }
  private async pause(runId: string, base: Record<string, unknown>) {
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
      const c = this.controller.consume();
      if (c === 'stop') throw new ControlledStop('interrupted');
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
  }
  private async loop(runId: string) {
    const playlist = await getBroadcastPlaylist(this.opts.playlistId);
    if (!playlist) throw new Error('Sendeliste nicht gefunden');
    const items = await listBroadcastItems(playlist.id);
    for (let i = playlist.current_position; i < items.length; i++) {
      const item = items[i];
      if (item.status === 'played') continue;
      const base = { playlistId: playlist.id, runId, itemId: item.id, articleId: item.article_id, position: i };
      const pending = this.controller.consume();
      if (pending === 'stop') throw new ControlledStop('interrupted');
      const skipCurrent = pending === 'skip';
      await setBroadcastPlaylistState(playlist.id, 'running', i);
      try {
        if (!item.audio_path) throw new Error('Kein Sprecher-Audio für Beitrag vorhanden');
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
            const c = this.controller.consume();
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
