import { IPollingService, PollingStatus } from '../../domain/services/IPollingService';
import { INodeRepository } from '../../domain/repositories/INodeRepository';
import { NodeData } from '../../domain/valueObjects/NodeData';

/**
 * パターン1: setInterval ベースのポーリング
 *
 * 特徴:
 * - 最もシンプルなパターン
 * - 一定間隔で実行される（前回の実行完了を待たない）
 * - データ取得に時間がかかると、リクエストが重複する可能性がある
 */
export class SetIntervalPollingService implements IPollingService {
  private timerId: ReturnType<typeof setInterval> | null = null;
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
    this.poll(); // 初回即時実行

    this.timerId = setInterval(() => {
      this.poll();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.status = 'stopped';
  }

  pause(): void {
    if (this.status === 'running' && this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
      this.status = 'paused';
    }
  }

  resume(): void {
    if (this.status === 'paused' && this.onData) {
      this.status = 'running';
      this.poll();
      this.timerId = setInterval(() => {
        this.poll();
      }, this.intervalMs);
    }
  }

  getStatus(): PollingStatus {
    return this.status;
  }

  setInterval(intervalMs: number): void {
    this.intervalMs = intervalMs;
    if (this.status === 'running' && this.onData) {
      // 再起動して新しいインターバルを適用
      this.pause();
      this.resume();
    }
  }

  dispose(): void {
    this.stop();
    this.onData = null;
    this.onError = null;
  }

  private async poll(): Promise<void> {
    if (this.status !== 'running') return;
    try {
      const data = await this.nodeRepository.fetchAllNodeData(this.nodeIds);
      if (this.status === 'running') {
        this.onData?.(data);
      }
    } catch (error) {
      this.onError?.(error as Error);
    }
  }
}
