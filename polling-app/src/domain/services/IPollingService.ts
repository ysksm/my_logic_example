import { NodeData } from '../valueObjects/NodeData';

/**
 * ポーリングの状態
 */
export type PollingStatus = 'idle' | 'running' | 'paused' | 'stopped';

/**
 * ポーリングサービスインターフェース (DIP)
 * 各ポーリング戦略はこのインターフェースを実装する
 */
export interface IPollingService {
  /** ポーリングを開始 */
  start(
    nodeIds: string[],
    intervalMs: number,
    onData: (data: NodeData[]) => void,
    onError?: (error: Error) => void
  ): void;

  /** ポーリングを停止 */
  stop(): void;

  /** ポーリングを一時停止 */
  pause(): void;

  /** ポーリングを再開 */
  resume(): void;

  /** 現在のステータスを取得 */
  getStatus(): PollingStatus;

  /** インターバルを変更 */
  setInterval(intervalMs: number): void;

  /** リソースの解放 */
  dispose(): void;
}
