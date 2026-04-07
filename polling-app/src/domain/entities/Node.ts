/**
 * ノードエンティティ - データソースとなるノードを表現
 */
export class Node {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly endpoint: string,
    public readonly intervalMs: number = 3000
  ) {}

  static create(params: {
    id: string;
    name: string;
    endpoint: string;
    intervalMs?: number;
  }): Node {
    return new Node(
      params.id,
      params.name,
      params.endpoint,
      params.intervalMs ?? 3000
    );
  }
}
