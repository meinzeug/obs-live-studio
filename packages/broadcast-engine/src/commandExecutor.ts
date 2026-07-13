import {
  applyCommandResult,
  failBroadcastCommand,
  getPlaybackSnapshot,
  markBroadcastCommandReconciliationRequired,
  rejectBroadcastCommand,
  updateBroadcastCommandPhase,
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
    if (
      snapshot.stateRevision !== env.expectedRevision ||
      (env.expectedStatus && snapshot.status !== env.expectedStatus)
    ) {
      await rejectBroadcastCommand(env.id, 'stale-command-snapshot');
      throw new Error('command-stale-before-obs');
    }
    const executing = await markBroadcastCommandExecuting(env.id, this.runnerId, env.leaseGeneration, {
      phase: 'before_obs',
      targetStatus: env.command,
      initialSnapshot: snapshot,
    });
    if (!executing) throw new Error('command-execute-fencing-conflict');
    try {
      await updateBroadcastCommandPhase(env.id, this.runnerId, env.leaseGeneration, 'obs_requested');
      const media = await this.performObsAction(env, ctx);
      await updateBroadcastCommandPhase(env.id, this.runnerId, env.leaseGeneration, 'obs_confirmed', media);
      try {
        await updateBroadcastCommandPhase(env.id, this.runnerId, env.leaseGeneration, 'persisting', media);
        const result = await applyCommandResult({
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
        await updateBroadcastCommandPhase(env.id, this.runnerId, env.leaseGeneration, 'completed', media);
        return result;
      } catch (error) {
        if (String(error instanceof Error ? error.message : error).includes('playback-revision-conflict')) {
          await markBroadcastCommandReconciliationRequired({
            id: env.id,
            runnerId: this.runnerId,
            leaseGeneration: env.leaseGeneration,
            error,
            obsState: media,
          });
          throw error;
        }
        throw error;
      }
    } catch (error) {
      if (String(error instanceof Error ? error.message : error).includes('playback-revision-conflict')) throw error;
      await updateBroadcastCommandPhase(env.id, this.runnerId, env.leaseGeneration, 'failed', {
        message: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
      await failBroadcastCommand(env.id, this.runnerId, env.leaseGeneration, 'obs_or_apply_failed', {
        message: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
      throw error;
    }
  }

  private async performObsAction(env: CommandEnvelope, ctx: CommandExecutionContext): Promise<Record<string, unknown>> {
    const command = env.command;
    const before = await this.readObs();
    await recordObsSnapshot({
      broadcastRunId: ctx.runId,
      runnerId: this.runnerId,
      itemId: ctx.itemId,
      articleId: ctx.articleId,
      audioPath: before.audioPath ?? null,
      leaseGeneration: env.leaseGeneration,
      expectedRevision: env.expectedRevision,
      phase: `before_${command}`,
      snapshot: before,
    });
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
      await abortableSleep(this.pollMs, this.signal);
    }
    throw new Error(`obs-confirmation-timeout:${command}:${last.status ?? 'unknown'}`);
  }

  private async readObs(): Promise<MediaSnapshot> {
    const controller = this.obs as unknown as {
      getMediaSnapshot?: () => Promise<MediaSnapshot> | MediaSnapshot;
    };
    if (!controller.getMediaSnapshot) throw new Error('obs-media-snapshot-not-supported');
    return await controller.getMediaSnapshot();
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

function abortableSleep(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new Error('runner-aborted'));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('runner-aborted'));
      },
      { once: true },
    );
  });
}
