/**
 * ポーリング設定値オブジェクト
 */
export class PollingConfig {
  constructor(
    public readonly intervalMs: number,
    public readonly maxRetries: number = 3,
    public readonly retryDelayMs: number = 1000,
    public readonly enabled: boolean = true
  ) {
    if (intervalMs < 100) {
      throw new Error('Polling interval must be at least 100ms');
    }
  }

  static default(): PollingConfig {
    return new PollingConfig(3000, 3, 1000, true);
  }

  withInterval(intervalMs: number): PollingConfig {
    return new PollingConfig(
      intervalMs,
      this.maxRetries,
      this.retryDelayMs,
      this.enabled
    );
  }

  withEnabled(enabled: boolean): PollingConfig {
    return new PollingConfig(
      this.intervalMs,
      this.maxRetries,
      this.retryDelayMs,
      enabled
    );
  }
}
