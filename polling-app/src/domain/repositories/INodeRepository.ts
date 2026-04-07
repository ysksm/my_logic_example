import { Node } from '../entities/Node';
import { NodeData } from '../valueObjects/NodeData';

/**
 * ノードリポジトリインターフェース (DIP: 依存性逆転の原則)
 * ドメイン層がインターフェースを定義し、インフラ層が実装する
 */
export interface INodeRepository {
  /** 全ノードを取得 */
  getNodes(): Promise<Node[]>;

  /** 特定ノードのデータを取得（ポーリング対象） */
  fetchNodeData(nodeId: string): Promise<NodeData>;

  /** 複数ノードのデータを一括取得 */
  fetchAllNodeData(nodeIds: string[]): Promise<NodeData[]>;
}
