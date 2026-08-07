import type { DocumentIndexes } from "../lib/selectors";
import type { ScreenMapDocument } from "../types";

interface Props {
  doc: ScreenMapDocument;
  indexes: DocumentIndexes;
  onSelectScreen: (id: string) => void;
}

export function ScreenListView({ doc, indexes, onSelectScreen }: Props) {
  return (
    <div className="list-view">
      <table className="data-table">
        <thead>
          <tr>
            <th>キャプチャ</th>
            <th>画面名</th>
            <th>パス</th>
            <th>呼び出し元</th>
            <th>呼び出し先</th>
            <th>文言数</th>
            <th>説明</th>
          </tr>
        </thead>
        <tbody>
          {doc.screens.map((screen) => (
            <tr key={screen.id} onClick={() => onSelectScreen(screen.id)}>
              <td>
                {screen.screenshot ? (
                  <img
                    className="table-thumb"
                    src={screen.screenshot}
                    alt={screen.name}
                  />
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="cell-name">{screen.name}</td>
              <td>
                <code>{screen.path}</code>
              </td>
              <td className="cell-num">
                {indexes.incomingByScreen.get(screen.id)?.length ?? 0}
              </td>
              <td className="cell-num">
                {indexes.outgoingByScreen.get(screen.id)?.length ?? 0}
              </td>
              <td className="cell-num">
                {indexes.wordingsByScreen.get(screen.id)?.length ?? 0}
              </td>
              <td className="cell-desc">{screen.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
