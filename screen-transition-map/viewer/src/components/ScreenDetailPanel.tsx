import { useState } from "react";
import type { DocumentIndexes } from "../lib/selectors";
import { operationLabel, type Screen, type Transition } from "../types";

interface Props {
  screen: Screen;
  indexes: DocumentIndexes;
  onSelectScreen: (id: string) => void;
  onClose: () => void;
}

export function ScreenDetailPanel({
  screen,
  indexes,
  onSelectScreen,
  onClose,
}: Props) {
  const [zoomed, setZoomed] = useState(false);
  const incoming = indexes.incomingByScreen.get(screen.id) ?? [];
  const outgoing = indexes.outgoingByScreen.get(screen.id) ?? [];
  const wordings = indexes.wordingsByScreen.get(screen.id) ?? [];

  return (
    <aside className="detail-panel">
      <div className="detail-header">
        <div>
          <h2 className="detail-title">{screen.name}</h2>
          <code className="detail-path">{screen.path}</code>
        </div>
        <button className="close-button" onClick={onClose} title="閉じる">
          ×
        </button>
      </div>

      <section className="detail-section">
        <h3>キャプチャ</h3>
        {screen.screenshot ? (
          <img
            className={zoomed ? "detail-screenshot zoomed" : "detail-screenshot"}
            src={screen.screenshot}
            alt={screen.name}
            title={zoomed ? "クリックで縮小" : "クリックで拡大"}
            onClick={() => setZoomed(!zoomed)}
            onError={(e) => {
              (e.target as HTMLImageElement).replaceWith(
                Object.assign(document.createElement("div"), {
                  className: "screenshot-placeholder",
                  textContent: "キャプチャなし (画像が見つかりません)",
                }),
              );
            }}
          />
        ) : (
          <div className="screenshot-placeholder">キャプチャなし</div>
        )}
      </section>

      {screen.description && (
        <section className="detail-section">
          <h3>説明</h3>
          <p>{screen.description}</p>
        </section>
      )}

      <TransitionList
        title={`呼び出し元 (${incoming.length})`}
        transitions={incoming}
        direction="incoming"
        indexes={indexes}
        onSelectScreen={onSelectScreen}
      />
      <TransitionList
        title={`呼び出し先 (${outgoing.length})`}
        transitions={outgoing}
        direction="outgoing"
        indexes={indexes}
        onSelectScreen={onSelectScreen}
      />

      <section className="detail-section">
        <h3>この画面の文言 ({wordings.length})</h3>
        {wordings.length === 0 ? (
          <p className="muted">文言の登録はありません</p>
        ) : (
          <table className="data-table compact">
            <thead>
              <tr>
                <th>ID</th>
                <th>テキスト</th>
              </tr>
            </thead>
            <tbody>
              {wordings.map(({ wording }, i) => (
                <tr key={`${wording.id}-${i}`}>
                  <td>
                    <code>{wording.id}</code>
                  </td>
                  <td>{wording.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </aside>
  );
}

function TransitionList({
  title,
  transitions,
  direction,
  indexes,
  onSelectScreen,
}: {
  title: string;
  transitions: Transition[];
  direction: "incoming" | "outgoing";
  indexes: DocumentIndexes;
  onSelectScreen: (id: string) => void;
}) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {transitions.length === 0 ? (
        <p className="muted">なし</p>
      ) : (
        <ul className="transition-list">
          {transitions.map((t) => {
            const otherId = direction === "incoming" ? t.from : t.to;
            const other = indexes.screenById.get(otherId);
            return (
              <li key={t.id} className="transition-item">
                <button className="chip" onClick={() => onSelectScreen(otherId)}>
                  {direction === "incoming" ? "←" : "→"}{" "}
                  {other?.name ?? otherId}
                </button>
                <div className="operation-info">
                  <span className="operation-label">
                    {operationLabel(t.operation)}
                  </span>
                  <span className="operation-meta">
                    <span className="badge">{t.operation.actionType}</span>
                    {t.operation.dataOp && (
                      <code className="data-op">data-op={t.operation.dataOp}</code>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
