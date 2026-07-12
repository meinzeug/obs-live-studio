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
export type Control = 'pause' | 'resume' | 'skip' | 'stop';
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
  private status: PlaybackStatus = 'idle';
  private pending = new Set<Control>();
  private seq = 0;
  constructor(private persist: (status: PlaybackStatus, payload?: Record<string, unknown>) => Promise<void>) {}
  state() {
    return this.status;
  }
  command(c: Control) {
    this.seq += 1;
    if (c === 'stop') this.pending = new Set(['stop']);
    else if (!this.pending.has('stop')) this.pending.add(c);
    return this.seq;
  }
  async transition(status: PlaybackStatus, payload: Record<string, unknown> = {}) {
    this.status = status;
    await this.persist(status, { ...payload, commandSeq: this.seq });
  }
  consume(): Control | undefined {
    if (this.pending.delete('stop')) return 'stop';
    if (this.pending.delete('skip')) return 'skip';
    if (this.status === 'playing' && this.pending.delete('pause')) return 'pause';
    if (this.status === 'paused' && this.pending.delete('resume')) return 'resume';
    return undefined;
  }
  clearStaleAfterRestart() {
    this.pending.clear();
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
    this.controller.command(c);
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
      if (pending === 'skip') this.controller.command('skip');
      await setBroadcastPlaylistState(playlist.id, 'running', i);
      try {
        if (!item.audio_path) throw new Error('Kein Sprecher-Audio für Beitrag vorhanden');
        await markBroadcastItem(item.id, 'playing');
        await setArticleStatus(item.article_id, 'published');
        await updateBroadcastRun(runId, 'running', { status: 'preparing', ...base });
        await this.controller.transition('preparing', base);
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
          break;
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
