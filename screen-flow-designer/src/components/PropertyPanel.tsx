import type {
  ScreenFlowNode,
  ScreenNodeData,
  TransitionEdgeData,
  TransitionFlowEdge,
  TriggerType,
} from "../types";

const TRIGGER_TYPES: { value: TriggerType; label: string }[] = [
  { value: "click", label: "クリック" },
  { value: "submit", label: "フォーム送信" },
  { value: "navigation", label: "画面遷移 (URL 変更)" },
  { value: "auto", label: "自動遷移 (リダイレクト等)" },
  { value: "other", label: "その他" },
];

interface Props {
  node: ScreenFlowNode | null;
  edge: TransitionFlowEdge | null;
  screenNameOf: (id: string) => string;
  onUpdateNode: (id: string, patch: Partial<ScreenNodeData>) => void;
  onUpdateEdge: (id: string, patch: Partial<TransitionEdgeData>) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
}

export function PropertyPanel({
  node,
  edge,
  screenNameOf,
  onUpdateNode,
  onUpdateEdge,
  onDeleteNode,
  onDeleteEdge,
}: Props) {
  if (node) {
    return (
      <aside className="property-panel">
        <h2>画面の編集</h2>
        <label>
          画面名
          <input
            value={node.data.name}
            onChange={(e) => onUpdateNode(node.id, { name: e.target.value })}
            placeholder="例: ログイン画面"
          />
        </label>
        <label>
          URL / パス
          <input
            value={node.data.url}
            onChange={(e) => onUpdateNode(node.id, { url: e.target.value })}
            placeholder="例: /login"
          />
        </label>
        <label>
          説明
          <textarea
            value={node.data.description}
            onChange={(e) =>
              onUpdateNode(node.id, { description: e.target.value })
            }
            rows={4}
          />
        </label>
        {node.data.lastSeenAt && (
          <p className="property-meta">
            最終クロール確認: {new Date(node.data.lastSeenAt).toLocaleString()}
          </p>
        )}
        <button className="danger" onClick={() => onDeleteNode(node.id)}>
          この画面を削除
        </button>
      </aside>
    );
  }

  if (edge) {
    const data = edge.data!;
    return (
      <aside className="property-panel">
        <h2>遷移の編集</h2>
        <p className="property-meta">
          {screenNameOf(edge.source)} → {screenNameOf(edge.target)}
        </p>
        <label>
          ラベル
          <input
            value={data.label}
            onChange={(e) => onUpdateEdge(edge.id, { label: e.target.value })}
            placeholder="例: ログインボタン"
          />
        </label>
        <label>
          トリガー種別
          <select
            value={data.triggerType}
            onChange={(e) =>
              onUpdateEdge(edge.id, {
                triggerType: e.target.value as TriggerType,
              })
            }
          >
            {TRIGGER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          CSS セレクタ
          <input
            value={data.selector}
            onChange={(e) =>
              onUpdateEdge(edge.id, { selector: e.target.value })
            }
            placeholder="例: button#login"
          />
        </label>
        {data.lastSeenAt && (
          <p className="property-meta">
            最終クロール確認: {new Date(data.lastSeenAt).toLocaleString()}
          </p>
        )}
        <button className="danger" onClick={() => onDeleteEdge(edge.id)}>
          この遷移を削除
        </button>
      </aside>
    );
  }

  return (
    <aside className="property-panel">
      <h2>使い方</h2>
      <ul className="help-list">
        <li>「画面を追加」で新しい画面ノードを作成</li>
        <li>ノードの右端 ○ から左端 ○ へドラッグで遷移を作成</li>
        <li>ノード / エッジを選択するとここで編集できます</li>
        <li>Backspace / Delete キーで選択中の要素を削除</li>
        <li>
          「インポート (マージ)」で Playwright クローラーの出力 JSON
          を既存の図に取り込めます
        </li>
      </ul>
    </aside>
  );
}
