import { IPollingService, PollingStatus } from '../../domain/services/IPollingService';
import { INodeRepository } from '../../domain/repositories/INodeRepository';
import { NodeData } from '../../domain/valueObjects/NodeData';

/**
 * パターン2: setTimeout 再帰ベースのポーリング
 *
 * 特徴:
 * - 前回の取得完了後に次のタイマーを設定する
 * - リクエストが重複しない（setIntervalとの重要な違い）
 * - データ取得時間を考慮した安定したポーリング
 * - 取得時間 + intervalMs の間隔で実行される
 */
export class SetTimeoutPollingService implements IPollingService {
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private status: PollingStatus = 'idle';
  private nodeIds: string[] = [];
  private intervalMs: number = 3000;
  private onData: ((data: NodeData[]) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;

  constructor(private readonly nodeRepository: INodeRepository) {}

  start(
    nodeIds: string[],
    intervalMs: number,
    onData: (data: NodeData[]) => void,
    onError?: (error: Error) => void
  ): void {
    this.stop();
    this.nodeIds = nodeIds;
    this.intervalMs = intervalMs;
    this.onData = onData;
    this.onError = onError ?? null;

    this.status = 'running';
    this.scheduleNext(0); // 初回は即時実行
  }

  stop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.status = 'stopped';
  }

  pause(): void {
    if (this.status === 'running') {
      if (this.timerId !== null) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
      this.status = 'paused';
    }
  }

  resume(): void {
    if (this.status === 'paused' && this.onData) {
      this.status = 'running';
      this.scheduleNext(0);
    }
  }

  getStatus(): PollingStatus {
    return this.status;
  }

  setInterval(intervalMs: number): void {
    this.intervalMs = intervalMs;
    // 次回のスケジューリングから新しいインターバルが適用される
  }

  dispose(): void {
    this.stop();
    this.onData = null;
    this.onError = null;
  }

  private scheduleNext(delayMs: number): void {
    if (this.status !== 'running') return;

    this.timerId = setTimeout(async () => {
      if (this.status !== 'running') return;

      try {
        const data = await this.nodeRepository.fetchAllNodeData(this.nodeIds);
        if (this.status === 'running') {
          this.onData?.(data);
        }
      } catch (error) {
        this.onError?.(error as Error);
      }

      // 完了後に次のポーリングをスケジュール
      this.scheduleNext(this.intervalMs);
    }, delayMs);
  }
}
