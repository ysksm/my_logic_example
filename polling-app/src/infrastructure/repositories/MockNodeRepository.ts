import { Node } from '../../domain/entities/Node';
import { NodeData } from '../../domain/valueObjects/NodeData';
import { INodeRepository } from '../../domain/repositories/INodeRepository';

/**
 * モックノードリポジトリ - デモ用のフェイクデータを生成
 * INodeRepositoryインターフェースを実装 (DIP)
 */
export class MockNodeRepository implements INodeRepository {
  private nodes: Node[] = [
    Node.create({ id: 'node-1', name: 'Server Alpha', endpoint: '/api/node/1', intervalMs: 2000 }),
    Node.create({ id: 'node-2', name: 'Server Beta', endpoint: '/api/node/2', intervalMs: 3000 }),
    Node.create({ id: 'node-3', name: 'Server Gamma', endpoint: '/api/node/3', intervalMs: 2500 }),
    Node.create({ id: 'node-4', name: 'Server Delta', endpoint: '/api/node/4', intervalMs: 4000 }),
    Node.create({ id: 'node-5', name: 'Server Epsilon', endpoint: '/api/node/5', intervalMs: 1500 }),
  ];

  async getNodes(): Promise<Node[]> {
    // ネットワーク遅延をシミュレート
    await this.simulateDelay(100);
    return [...this.nodes];
  }

  async fetchNodeData(nodeId: string): Promise<NodeData> {
    await this.simulateDelay(50 + Math.random() * 200);

    // ランダムにエラーを発生させる (5%の確率)
    if (Math.random() < 0.05) {
      throw new Error(`Failed to fetch data from ${nodeId}`);
    }

    return NodeData.create({
      nodeId,
      value: Math.round(Math.random() * 100 * 10) / 10,
      status: this.randomStatus(),
      timestamp: new Date(),
      metadata: {
        cpu: Math.round(Math.random() * 100),
        memory: Math.round(Math.random() * 100),
        latency: Math.round(Math.random() * 500),
      },
    });
  }

  async fetchAllNodeData(nodeIds: string[]): Promise<NodeData[]> {
    const results = await Promise.allSettled(
      nodeIds.map((id) => this.fetchNodeData(id))
    );

    return results
      .filter((r): r is PromiseFulfilledResult<NodeData> => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  private randomStatus(): 'online' | 'offline' | 'error' {
    const rand = Math.random();
    if (rand < 0.8) return 'online';
    if (rand < 0.95) return 'offline';
    return 'error';
  }

  private simulateDelay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
