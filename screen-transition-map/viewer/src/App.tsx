import { useMemo, useState } from "react";
import "./App.css";
import { FlowView } from "./components/FlowView";
import { ImportButton } from "./components/ImportButton";
import { ScreenDetailPanel } from "./components/ScreenDetailPanel";
import { ScreenListView } from "./components/ScreenListView";
import { WordingListView } from "./components/WordingListView";
import sampleData from "./sample-data/sample.json";
import { buildIndexes } from "./lib/selectors";
import { validateDocument } from "./lib/loadDocument";
import type { ScreenMapDocument } from "./types";

type Tab = "flow" | "screens" | "wordings";

const TABS: { id: Tab; label: string }[] = [
  { id: "flow", label: "🧭 遷移図" },
  { id: "screens", label: "🖥️ 画面一覧" },
  { id: "wordings", label: "📝 文言一覧" },
];

const initialDoc = validateDocument(sampleData);

export default function App() {
  const [doc, setDoc] = useState<ScreenMapDocument>(initialDoc);
  const [tab, setTab] = useState<Tab>("flow");
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);

  const indexes = useMemo(() => buildIndexes(doc), [doc]);
  const selectedScreen = selectedScreenId
    ? (indexes.screenById.get(selectedScreenId) ?? null)
    : null;

  const handleImport = (imported: ScreenMapDocument) => {
    setDoc(imported);
    setSelectedScreenId(null);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          画面遷移マップ
          {doc.meta?.title && <span className="doc-title">— {doc.meta.title}</span>}
        </h1>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "tab active" : "tab"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <ImportButton onImport={handleImport} />
      </header>
      <div className="app-body">
        <main className="main-view">
          {tab === "flow" && (
            <FlowView
              doc={doc}
              selectedScreenId={selectedScreenId}
              onSelectScreen={setSelectedScreenId}
            />
          )}
          {tab === "screens" && (
            <ScreenListView
              doc={doc}
              indexes={indexes}
              onSelectScreen={setSelectedScreenId}
            />
          )}
          {tab === "wordings" && (
            <WordingListView
              doc={doc}
              indexes={indexes}
              onSelectScreen={setSelectedScreenId}
            />
          )}
        </main>
        {selectedScreen && (
          <ScreenDetailPanel
            screen={selectedScreen}
            indexes={indexes}
            onSelectScreen={setSelectedScreenId}
            onClose={() => setSelectedScreenId(null)}
          />
        )}
      </div>
    </div>
  );
}
