import { IPollingService, PollingStatus } from '../../domain/services/IPollingService';
import { NodeData } from '../../domain/valueObjects/NodeData';
import type { PlainNodeData } from '../../domain/valueObjects/NodeData';

/**
 * パターン4: Web Worker + setTimeout 再帰ベースのポーリング
 *
 * 特徴:
 * - Web Worker内でsetTimeout再帰パターンを使用
 * - メインスレッドをブロックせず、リクエスト重複もない
 * - 最も堅牢なパターン
 * - Worker内でデータ取得完了後に次回スケジュール
 */
export class WebWorkerTimeoutPollingService implements IPollingService {
  private worker: Worker | null = null;
  private status: PollingStatus = 'idle';
  private onData: ((data: NodeData[]) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;
  private intervalMs: number = 3000;

  start(
    nodeIds: string[],
    intervalMs: number,
    onData: (data: NodeData[]) => void,
    onError?: (error: Error) => void
  ): void {
    this.dispose();
    this.intervalMs = intervalMs;
    this.onData = onData;
    this.onError = onError ?? null;

    this.worker = new Worker(
      new URL('../workers/timeoutPollingWorker.ts', import.meta.url)
    );

    this.worker.onmessage = (event: MessageEvent) => {
      const { type, data, error } = event.data;

      switch (type) {
        case 'data':
          if (this.status === 'running') {
            const nodeDataList = (data as PlainNodeData[]).map((d) =>
              NodeData.fromPlain(d)
            );
            this.onData?.(nodeDataList);
          }
          break;
        case 'error':
          this.onError?.(new Error(error));
          break;
        case 'status':
          this.status = data as PollingStatus;
          break;
      }
    };

    this.worker.onerror = (error) => {
      this.onError?.(new Error(error.message));
    };

    this.status = 'running';
    this.worker.postMessage({
      command: 'start',
      nodeIds,
      intervalMs,
    });
  }

  stop(): void {
    if (this.worker) {
      this.worker.postMessage({ command: 'stop' });
    }
    this.status = 'stopped';
  }

  pause(): void {
    if (this.status === 'running' && this.worker) {
      this.worker.postMessage({ command: 'pause' });
      this.status = 'paused';
    }
  }

  resume(): void {
    if (this.status === 'paused' && this.worker) {
      this.worker.postMessage({ command: 'resume' });
      this.status = 'running';
    }
  }

  getStatus(): PollingStatus {
    return this.status;
  }

  setInterval(intervalMs: number): void {
    this.intervalMs = intervalMs;
    if (this.worker) {
      this.worker.postMessage({ command: 'setInterval', intervalMs });
    }
  }

  dispose(): void {
    if (this.worker) {
      this.worker.postMessage({ command: 'stop' });
      this.worker.terminate();
      this.worker = null;
    }
    this.status = 'idle';
    this.onData = null;
    this.onError = null;
  }
}
