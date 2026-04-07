import { IPollingService, PollingStatus } from '../../domain/services/IPollingService';
import { NodeData } from '../../domain/valueObjects/NodeData';
import type { PlainNodeData } from '../../domain/valueObjects/NodeData';

/**
 * パターン3: Web Worker + setInterval ベースのポーリング
 *
 * 特徴:
 * - ポーリングロジックをWeb Workerに移動
 * - メインスレッドをブロックしない
 * - UIの応答性が向上する
 * - Worker内でsetIntervalを使用
 */
export class WebWorkerIntervalPollingService implements IPollingService {
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

    // Workerを作成
    this.worker = new Worker(
      new URL('../workers/intervalPollingWorker.ts', import.meta.url)
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

    // Workerにポーリング開始を指示
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
