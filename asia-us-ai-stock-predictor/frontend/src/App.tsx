import { useState } from "react";
import { HeatmapView } from "./components/HeatmapView";
import { PairView } from "./components/PairView";
import { SignalsView } from "./components/SignalsView";

type Tab = "heatmap" | "pair" | "signals";

const TABS: { id: Tab; label: string }[] = [
  { id: "heatmap", label: "ヒートマップ" },
  { id: "pair", label: "ペア分析" },
  { id: "signals", label: "当日シグナル" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("heatmap");

  return (
    <div className="app">
      <header className="app-header">
        <h1>アジア→米国 AI銘柄 予測ダッシュボード</h1>
        <p className="muted">
          アジア・欧州市場の取引結果から米国AI関連銘柄の値動きを統計的に分析します
        </p>
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
      </header>

      <main className="app-main">
        {tab === "heatmap" && <HeatmapView />}
        {tab === "pair" && <PairView />}
        {tab === "signals" && <SignalsView />}
      </main>

      <footer className="app-footer muted">
        本レポートは統計的根拠の提示であり売買推奨ではありません。
      </footer>
    </div>
  );
}
