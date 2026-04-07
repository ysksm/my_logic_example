import { IPollingService, PollingStatus } from '../../domain/services/IPollingService';
import { INodeRepository } from '../../domain/repositories/INodeRepository';
import { Node } from '../../domain/entities/Node';
import { NodeData } from '../../domain/valueObjects/NodeData';
import { PollingConfig } from '../../domain/valueObjects/PollingConfig';

/**
 * ポーリングユースケース
 * ドメインサービスを組み合わせてポーリングのビジネスロジックを実行する
 */
export class PollingUseCase {
  private nodes: Node[] = [];

  constructor(
    private readonly nodeRepository: INodeRepository,
    private readonly pollingService: IPollingService
  ) {}

  async initialize(): Promise<Node[]> {
    this.nodes = await this.nodeRepository.getNodes();
    return this.nodes;
  }

  startPolling(
    config: PollingConfig,
    onData: (data: NodeData[]) => void,
    onError?: (error: Error) => void
  ): void {
    const nodeIds = this.nodes.map((n) => n.id);
    this.pollingService.start(nodeIds, config.intervalMs, onData, onError);
  }

  stopPolling(): void {
    this.pollingService.stop();
  }

  pausePolling(): void {
    this.pollingService.pause();
  }

  resumePolling(): void {
    this.pollingService.resume();
  }

  getStatus(): PollingStatus {
    return this.pollingService.getStatus();
  }

  setInterval(intervalMs: number): void {
    this.pollingService.setInterval(intervalMs);
  }

  dispose(): void {
    this.pollingService.dispose();
  }

  getNodes(): Node[] {
    return [...this.nodes];
  }
}
