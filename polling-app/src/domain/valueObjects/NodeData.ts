/**
 * ノードデータ値オブジェクト - ノードから取得したデータを表現
 */
export class NodeData {
  constructor(
    public readonly nodeId: string,
    public readonly value: number,
    public readonly status: 'online' | 'offline' | 'error',
    public readonly timestamp: Date,
    public readonly metadata: Record<string, unknown> = {}
  ) {}

  static create(params: {
    nodeId: string;
    value: number;
    status: 'online' | 'offline' | 'error';
    timestamp?: Date;
    metadata?: Record<string, unknown>;
  }): NodeData {
    return new NodeData(
      params.nodeId,
      params.value,
      params.status,
      params.timestamp ?? new Date(),
      params.metadata ?? {}
    );
  }

  toPlain(): PlainNodeData {
    return {
      nodeId: this.nodeId,
      value: this.value,
      status: this.status,
      timestamp: this.timestamp.toISOString(),
      metadata: this.metadata,
    };
  }

  static fromPlain(plain: PlainNodeData): NodeData {
    return new NodeData(
      plain.nodeId,
      plain.value,
      plain.status as 'online' | 'offline' | 'error',
      new Date(plain.timestamp),
      plain.metadata
    );
  }
}

export interface PlainNodeData {
  nodeId: string;
  value: number;
  status: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}
