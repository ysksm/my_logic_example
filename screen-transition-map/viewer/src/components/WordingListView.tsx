import type { DocumentIndexes } from "../lib/selectors";
import type { ScreenMapDocument } from "../types";

interface Props {
  doc: ScreenMapDocument;
  indexes: DocumentIndexes;
  onSelectScreen: (id: string) => void;
}

export function WordingListView({ doc, indexes, onSelectScreen }: Props) {
  return (
    <div className="list-view">
      <table className="data-table">
        <thead>
          <tr>
            <th>文言 ID</th>
            <th>テキスト</th>
            <th>使用画面</th>
          </tr>
        </thead>
        <tbody>
          {doc.wordings.map((wording) => (
            <tr key={wording.id}>
              <td>
                <code>{wording.id}</code>
              </td>
              <td className="cell-name">{wording.text}</td>
              <td>
                <div className="chip-row">
                  {wording.usages.map((usage, i) => {
                    const screen = indexes.screenById.get(usage.screenId);
                    return (
                      <button
                        key={`${usage.screenId}-${i}`}
                        className="chip"
                        onClick={() => onSelectScreen(usage.screenId)}
                      >
                        {screen?.name ?? usage.screenId}
                      </button>
                    );
                  })}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
