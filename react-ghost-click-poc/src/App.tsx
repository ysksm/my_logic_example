import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PartsCanvas, type ActivateInfo } from "./components/PartsCanvas";
import { PartDialog } from "./components/PartDialog";
import { EventLogView } from "./components/EventLogView";
import { INITIAL_PARTS, type Part, type Point } from "./types";
import { STRATEGIES, findStrategy, type Strategy } from "./strategies";
import {
  clearLog,
  getGhostCount,
  installEventLogger,
  pushNote,
  subscribe,
} from "./lib/eventLog";
import { installGhostClickFilter } from "./lib/ghostClickFilter";
import { openAfterCompatClick, openAfterTimeout } from "./lib/deferOpen";

interface DialogState {
  part: Part;
  anchor: Point;
}

function initialStrategy(): Strategy {
  const id = new URLSearchParams(window.location.search).get("strategy");
  return findStrategy(id);
}

export function App() {
  const [strategy, setStrategy] = useState<Strategy>(initialStrategy);
  const [parts, setParts] = useState<Part[]>(INITIAL_PARTS);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [deleteClicks, setDeleteClicks] = useState(0);
  const ghostCount = useSyncExternalStore(subscribe, getGhostCount);
  const cancelDeferred = useRef<(() => void) | null>(null);

  // 生イベントログ (常時)
  useEffect(() => installEventLogger(), []);

  // 対策 7: アプリ全体のフィルタ
  useEffect(() => {
    if (!strategy.globalFilter) return;
    return installGhostClickFilter({
      onBlocked: (e) => {
        const t = e.target;
        const name =
          t instanceof Element ? (t.getAttribute("data-log") ?? t.tagName.toLowerCase()) : "?";
        pushNote(`🛡 global-filter が click をブロック (→ ${name})`);
      },
    });
  }, [strategy]);

  // 戦略を変えたら URL にも反映 (リロード / E2E で便利)
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("strategy", strategy.id);
    window.history.replaceState(null, "", url);
  }, [strategy]);

  const handleActivate = useCallback(
    (info: ActivateInfo) => {
      cancelDeferred.current?.();
      const open = () => {
        cancelDeferred.current = null;
        pushNote(`ダイアログを開く (パーツ ${info.part.name}, ${info.pointerType})`);
        setDialog({ part: info.part, anchor: info.client });
      };
      switch (strategy.defer) {
        case "none":
          open();
          break;
        case "timeout":
          pushNote("開くのを遅延 (timeout)");
          cancelDeferred.current = openAfterTimeout(open);
          break;
        case "afterClick":
          pushNote("開くのを遅延 (互換 click 待ち)");
          cancelDeferred.current = openAfterCompatClick(open);
          break;
      }
    },
    [strategy],
  );

  const handleDelete = (part: Part) => {
    setDeleteClicks((n) => n + 1);
    setParts((ps) => ps.filter((p) => p.id !== part.id));
    pushNote(`「削除」ハンドラ実行: パーツ ${part.name} を削除`);
    setDialog(null);
  };

  const reset = () => {
    cancelDeferred.current?.();
    setParts(INITIAL_PARTS);
    setDialog(null);
    setDeleteClicks(0);
    clearLog();
  };

  const strategyOptions = useMemo(
    () => STRATEGIES.map((s) => ({ value: s.id, label: s.label })),
    [],
  );

  return (
    <div className="app">
      <header>
        <h1>Ghost click 再現 &amp; 対策 POC</h1>
        <p className="lead">
          タッチ端末で canvas 上のパーツをタップ → 指の真下にダイアログが開く →
          タップ由来の互換 click がダイアログの「削除」ボタンに命中する現象を再現し、対策を切り替えて比較します。
        </p>
        <label className="strategy-select">
          対策:
          <select
            data-testid="strategy"
            value={strategy.id}
            onChange={(e) => {
              reset();
              setStrategy(findStrategy(e.target.value));
            }}
          >
            {strategyOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="strategy-info">
          <p>
            <strong>仕組み:</strong> {strategy.summary}
          </p>
          <p>
            <strong>注意点:</strong> {strategy.caveat}
          </p>
        </div>
      </header>

      <main>
        <section className="canvas-pane">
          <h2>canvas（パーツをタップ）</h2>
          <PartsCanvas parts={parts} strategy={strategy} onActivate={handleActivate} />
          <dl className="stats">
            <dt>「削除」ハンドラ実行回数</dt>
            <dd data-testid="delete-count">{deleteClicks}</dd>
            <dt>ghost click 検出数（ブロック済み含む）</dt>
            <dd data-testid="ghost-count">{ghostCount}</dd>
            <dt>残りパーツ</dt>
            <dd data-testid="parts-count">{parts.length}</dd>
          </dl>
          <button type="button" data-testid="reset" onClick={reset}>
            リセット
          </button>
        </section>

        <section className="log-pane">
          <h2>イベントログ（window capture で観測）</h2>
          <EventLogView />
        </section>
      </main>

      {dialog && (
        <PartDialog
          key={`${dialog.part.id}-${dialog.anchor.x}-${dialog.anchor.y}`}
          part={dialog.part}
          anchor={dialog.anchor}
          guard={strategy.guard}
          onDelete={handleDelete}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
