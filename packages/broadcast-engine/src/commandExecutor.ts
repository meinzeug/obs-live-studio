import {
  applyBroadcastCommandTransaction,
  failBroadcastCommand,
  getPlaybackSnapshot,
  markBroadcastCommandExecuting,
  recordObsSnapshot,
} from '@ans/database';
import type { ObsController } from '@ans/obs-controller';
import type { CommandEnvelope, Control } from './index.js';

type MediaSnapshot = {
  status?: string | null;
  mediaPositionMs?: number | null;
  mediaDurationMs?: number | null;
  obsConfirmedPositionMs?: number | null;
  audioPath?: string | null;
};

export type CommandExecutionContext = {
  runId: string;
  playlistId: string;
  itemId?: string | null;
  articleId?: string | null;
  position?: number | null;
};

export class BroadcastCommandExecutor {
  constructor(
    private readonly obs: ObsController,
    private readonly runnerId: string,
    private readonly signal: AbortSignal,
    private readonly pollMs = 100,
  ) {}

  async execute(env: CommandEnvelope, ctx: CommandExecutionContext) {
    this.throwIfAborted();
    const snapshot = await getPlaybackSnapshot();
    if (snapshot.runId && snapshot.runId !== ctx.runId) throw new Error('command-run-mismatch');
    const executing = await markBroadcastCommandExecuting(env.id, this.runnerId, env.leaseGeneration, {
      phase: 'before_obs',
      targetStatus: env.command,
      initialSnapshot: snapshot,
    });
    if (!executing) throw new Error('command-execute-fencing-conflict');
    try {
      const media = await this.performObsAction(env.command, ctx);
      return await applyBroadcastCommandTransaction({
        commandId: env.id,
        runnerId: this.runnerId,
        leaseGeneration: env.leaseGeneration,
        expectedRevision: env.expectedRevision,
        status: this.statusFor(env.command),
        playlistStatus: env.command === 'pause' ? 'paused' : env.command === 'stop' ? 'interrupted' : 'running',
        runStatus: env.command === 'stop' ? 'interrupted' : 'running',
        playlistId: ctx.playlistId,
        broadcastRunId: ctx.runId,
        itemId: ctx.itemId,
        articleId: ctx.articleId,
        position: ctx.position,
        eventType: this.eventFor(env.command),
        payload: { command: env.command, commandId: env.id, sequence: env.sequence },
        media,
      });
    } catch (error) {
      await failBroadcastCommand(env.id, this.runnerId, env.leaseGeneration, 'obs_or_apply_failed', {
        message: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
      throw error;
    }
  }

  private async performObsAction(command: Control, ctx: CommandExecutionContext): Promise<Record<string, unknown>> {
    const before = await this.readObs();
    await recordObsSnapshot({
      broadcastRunId: ctx.runId,
      runnerId: this.runnerId,
      itemId: ctx.itemId,
      articleId: ctx.articleId,
      leaseGeneration: 0,
      expectedRevision: null,
      phase: `before_${command}`,
      snapshot: before,
    }).catch(() => undefined);
    if (command === 'pause') await this.obs.pauseMedia();
    if (command === 'resume') await this.obs.playMedia();
    if (command === 'skip' || command === 'stop') await this.obs.stopMedia();
    const confirmed = await this.waitFor(command);
    return {
      obsMediaStatus: confirmed.status ?? null,
      mediaPositionMs: confirmed.mediaPositionMs ?? null,
      mediaDurationMs: confirmed.mediaDurationMs ?? null,
      obsConfirmedPositionMs: confirmed.obsConfirmedPositionMs ?? confirmed.mediaPositionMs ?? null,
      audioPath: confirmed.audioPath ?? null,
    };
  }

  private async waitFor(command: Control) {
    const wanted = command === 'pause' ? ['paused'] : command === 'resume' ? ['playing'] : ['stopped', 'ended', 'none'];
    const deadline = Date.now() + 5000;
    let last: MediaSnapshot = {};
    while (Date.now() < deadline) {
      this.throwIfAborted();
      last = await this.readObs();
      if (wanted.includes(String(last.status))) return last;
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }
    throw new Error(`obs-confirmation-timeout:${command}:${last.status ?? 'unknown'}`);
  }

  private async readObs(): Promise<MediaSnapshot> {
    const controller = this.obs as unknown as {
      getMediaSnapshot?: () => Promise<MediaSnapshot> | MediaSnapshot;
      getState?: () => unknown;
    };
    if (controller.getMediaSnapshot) return await controller.getMediaSnapshot();
    const state = controller.getState?.();
    if (state && typeof state === 'object') return state as MediaSnapshot;
    return {};
  }

  private statusFor(command: Control) {
    return command === 'pause'
      ? 'paused'
      : command === 'resume'
        ? 'playing'
        : command === 'skip'
          ? 'skipping'
          : 'stopping';
  }

  private eventFor(command: Control) {
    return command === 'pause'
      ? 'item-paused'
      : command === 'resume'
        ? 'item-resumed'
        : command === 'skip'
          ? 'item-skipped'
          : 'broadcast-stopped';
  }

  private throwIfAborted() {
    if (this.signal.aborted) throw new Error('runner-aborted');
  }
}
