export type RecoverableObsConnection = {
  getState: () => { status: string };
  ensureConnectedWithRetry: (attempts?: number) => Promise<void>;
};

export type ObsConnectionRecoveryOptions = {
  reconnectIntervalMs: number;
  now?: () => number;
  onConnected: () => Promise<void>;
  onFailure: (error: unknown) => Promise<void>;
};

export class ObsConnectionRecovery {
  private nextAttemptAt = 0;
  private needsResolution = true;
  private readonly now: () => number;

  constructor(
    private readonly obs: RecoverableObsConnection,
    private readonly options: ObsConnectionRecoveryOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  async maintain() {
    if (this.obs.getState().status === 'connected') {
      if (this.needsResolution) {
        await this.options.onConnected();
        this.needsResolution = false;
      }
      this.nextAttemptAt = 0;
      return true;
    }
    if (this.now() < this.nextAttemptAt) return false;

    try {
      await this.obs.ensureConnectedWithRetry(1);
      await this.options.onConnected();
      this.needsResolution = false;
      this.nextAttemptAt = 0;
      return true;
    } catch (error) {
      this.needsResolution = true;
      this.nextAttemptAt = this.now() + this.options.reconnectIntervalMs;
      await this.options.onFailure(error);
      return false;
    }
  }
}
