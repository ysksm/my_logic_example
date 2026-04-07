import { INodeRepository } from '../../domain/repositories/INodeRepository';
import { IPollingService } from '../../domain/services/IPollingService';
import { MockNodeRepository } from '../../infrastructure/repositories/MockNodeRepository';
import { SetIntervalPollingService } from '../../infrastructure/polling/SetIntervalPollingService';
import { SetTimeoutPollingService } from '../../infrastructure/polling/SetTimeoutPollingService';
import { WebWorkerIntervalPollingService } from '../../infrastructure/polling/WebWorkerIntervalPollingService';
import { WebWorkerTimeoutPollingService } from '../../infrastructure/polling/WebWorkerTimeoutPollingService';
import { PollingUseCase } from '../usecases/PollingUseCase';

/**
 * ポーリング戦略の種類
 */
export type PollingStrategy =
  | 'setInterval'
  | 'setTimeout'
  | 'workerInterval'
  | 'workerTimeout';

/**
 * DIコンテナ
 * 依存性の注入を管理し、各レイヤー間の結合度を下げる
 *
 * DI (Dependency Injection): 依存オブジェクトを外部から注入
 * DIP (Dependency Inversion Principle): 上位モジュールが下位モジュールに依存せず、
 *   両方が抽象（インターフェース）に依存する
 */
export class Container {
  private static nodeRepository: INodeRepository | null = null;

  /** ノードリポジトリを取得（シングルトン） */
  static getNodeRepository(): INodeRepository {
    if (!this.nodeRepository) {
      this.nodeRepository = new MockNodeRepository();
    }
    return this.nodeRepository;
  }

  /** ポーリングサービスを作成（戦略パターンで切り替え） */
  static createPollingService(strategy: PollingStrategy): IPollingService {
    const repository = this.getNodeRepository();

    switch (strategy) {
      case 'setInterval':
        return new SetIntervalPollingService(repository);
      case 'setTimeout':
        return new SetTimeoutPollingService(repository);
      case 'workerInterval':
        return new WebWorkerIntervalPollingService();
      case 'workerTimeout':
        return new WebWorkerTimeoutPollingService();
      default:
        throw new Error(`Unknown polling strategy: ${strategy}`);
    }
  }

  /** ポーリングユースケースを作成 */
  static createPollingUseCase(strategy: PollingStrategy): PollingUseCase {
    const repository = this.getNodeRepository();
    const pollingService = this.createPollingService(strategy);
    return new PollingUseCase(repository, pollingService);
  }
}

/**
 * 各戦略の説明
 */
export const STRATEGY_DESCRIPTIONS: Record<PollingStrategy, { name: string; description: string }> = {
  setInterval: {
    name: 'setInterval (メインスレッド)',
    description:
      '最もシンプル。一定間隔で実行されるが、前回の処理完了を待たないため、重い処理ではリクエストが重複する可能性がある。',
  },
  setTimeout: {
    name: 'setTimeout再帰 (メインスレッド)',
    description:
      'データ取得完了後に次のタイマーを設定。リクエストの重複がなく、安定したポーリングが可能。',
  },
  workerInterval: {
    name: 'Web Worker + setInterval',
    description:
      'setIntervalのロジックをWeb Workerに移動。メインスレッドをブロックしないため、UIの応答性が向上。',
  },
  workerTimeout: {
    name: 'Web Worker + setTimeout再帰',
    description:
      'setTimeout再帰パターンをWeb Workerで実行。最も堅牢で、メインスレッド非ブロック + リクエスト重複なし。',
  },
};
