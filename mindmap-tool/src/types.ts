/** マインドマップの1ノード。children を持つカスケード構造。 */
export interface MindMapNode {
  /** ノードの表示テキスト */
  text: string;
  /** 補足メモ(任意) */
  note?: string;
  /** 子ノード(任意) */
  children?: MindMapNode[];
}

/** マインドマップ全体(YAMLのトップレベル構造) */
export interface MindMap {
  /** マップのタイトル */
  title: string;
  /** ルートノード */
  root: MindMapNode;
}
