import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { Aggregate, AppSpec, DomainModel, Run, RulesConfig } from "./types";
import { DomainTree } from "./components/DomainTree";
import { AggregateEditor } from "./components/AggregateEditor";
import { RightPane } from "./components/RightPane";
import { RunPanel } from "./components/RunPanel";
import { SampleMenu } from "./components/SampleMenu";

const EMPTY_DOMAIN: DomainModel = {
  id: "new",
  name: "New Domain",
  aggregates: [
    {
      name: "Sample",
      root: { name: "Sample", isRoot: true, fields: [{ name: "title", type: "string" }] },
    },
  ],
};

const DEFAULT_RULES: RulesConfig = { SmallFormFieldLimit: 5, WizardFieldLimit: 20 };

type Mode = "edit" | "view";
const MODE_STORAGE_KEY = "ddd-ui-designer:mode";

function loadInitialMode(): Mode {
  if (typeof window === "undefined") return "edit";
  const v = window.localStorage.getItem(MODE_STORAGE_KEY);
  return v === "view" ? "view" : "edit";
}

export default function App() {
  const [list, setList] = useState<DomainModel[]>([]);
  const [domain, setDomain] = useState<DomainModel>(EMPTY_DOMAIN);
  const [selected, setSelected] = useState<string | null>("Sample");
  const [spec, setSpec] = useState<AppSpec | null>(null);
  const [config, setConfig] = useState<RulesConfig>(DEFAULT_RULES);
  const [filterByAg, setFilterByAg] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [mode, setMode] = useState<Mode>(loadInitialMode);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    api.listDomains().then(setList).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch {
      /* ignore quota errors */
    }
  }, [mode]);

  const selectedAg = useMemo(
    () => domain.aggregates.find((a) => a.name === selected) ?? null,
    [domain, selected],
  );

  async function derive() {
    setError(null);
    try {
      const s = await api.derive(domain, config);
      setSpec(s);
    } catch (e) {
      setError(String(e));
    }
  }

  async function generateReactApp() {
    setError(null);
    try {
      const { blob, filename } = await api.generate(domain, config);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    }
  }

  function stopPolling() {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function launchAndRun() {
    setError(null);
    if (!domain.id) {
      setError("ドメインに id を設定してください");
      return;
    }
    try {
      const initial = await api.launch(domain, config);
      setRun(initial);
      stopPolling();
      pollRef.current = window.setInterval(async () => {
        try {
          const r = await api.getRun(domain.id);
          setRun(r);
          if (r.status === "ready" || r.status === "stopped" || r.status === "error") {
            stopPolling();
          }
        } catch (e) {
          stopPolling();
          setError(String(e));
        }
      }, 1000);
    } catch (e) {
      setError(String(e));
    }
  }

  async function stopRun() {
    if (!run) return;
    try {
      const r = await api.stopRun(run.domainId);
      setRun(r);
    } catch (e) {
      setError(String(e));
    }
  }

  function closeRunPanel() {
    stopPolling();
    setRun(null);
  }

  async function loadSample(id: string, persist: boolean) {
    setError(null);
    try {
      const d = persist ? await api.loadSample(id) : (await api.getSample(id)).domain;
      setDomain(d);
      setSelected(d.aggregates[0]?.name ?? null);
      setSpec(null);
      if (persist) {
        const fresh = await api.listDomains();
        setList(fresh);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => () => stopPolling(), []);

  async function save() {
    setError(null);
    try {
      const saved = await api.saveDomain(domain);
      const fresh = await api.listDomains();
      setList(fresh);
      setDomain(saved);
    } catch (e) {
      setError(String(e));
    }
  }

  async function load(id: string) {
    if (!id) {
      setDomain(EMPTY_DOMAIN);
      setSelected("Sample");
      return;
    }
    try {
      const d = await api.getDomain(id);
      setDomain(d);
      setSelected(d.aggregates[0]?.name ?? null);
      setSpec(null);
    } catch (e) {
      setError(String(e));
    }
  }

  function updateAggregate(updated: Aggregate, originalName: string) {
    setDomain({
      ...domain,
      aggregates: domain.aggregates.map((a) =>
        a.name === originalName ? updated : a,
      ),
    });
    if (selected === originalName) setSelected(updated.name);
  }

  function addAggregate() {
    const base = "Aggregate" + (domain.aggregates.length + 1);
    const ag: Aggregate = {
      name: base,
      root: { name: base, isRoot: true, fields: [{ name: "name", type: "string" }] },
    };
    setDomain({ ...domain, aggregates: [...domain.aggregates, ag] });
    setSelected(base);
  }

  function removeAggregate(name: string) {
    if (!confirm(`Aggregate "${name}" を削除しますか？`)) return;
    const next = domain.aggregates.filter((a) => a.name !== name);
    setDomain({ ...domain, aggregates: next });
    if (selected === name) setSelected(next[0]?.name ?? null);
  }

  return (
    <div className="app">
      <div className="topbar">
        <h1>ddd-ui-designer</h1>
        <div className="mode-switch" data-testid="mode-switch" role="group" aria-label="表示モード切替">
          <button
            type="button"
            className={mode === "edit" ? "mode-active" : ""}
            onClick={() => setMode("edit")}
            data-testid="mode-edit"
            aria-pressed={mode === "edit"}
            title="設定モード: ドメインを編集する 3 ペインレイアウト"
          >
            🛠 設定
          </button>
          <button
            type="button"
            className={mode === "view" ? "mode-active" : ""}
            onClick={() => setMode("view")}
            data-testid="mode-view"
            aria-pressed={mode === "view"}
            title="表示モード: 編集を畳み、ドキュメント / プレゼン用に右ペインを最大化"
          >
            👁 表示
          </button>
        </div>
        <select onChange={(e) => load(e.target.value)} value={domain.id}>
          <option value="">(新規)</option>
          {list.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <SampleMenu onLoad={loadSample} />
        <input
          type="text"
          value={domain.id}
          onChange={(e) => setDomain({ ...domain, id: e.target.value })}
          placeholder="id"
          style={{ width: 100 }}
        />
        <input
          type="text"
          value={domain.name}
          onChange={(e) => setDomain({ ...domain, name: e.target.value })}
          placeholder="name"
        />
        <button onClick={save}>保存</button>
        <span className="spacer" />
        <span style={{ fontSize: 12, opacity: 0.8 }}>
          small≤
          <input
            type="number"
            style={{ width: 40, marginLeft: 4 }}
            value={config.SmallFormFieldLimit}
            onChange={(e) => setConfig({ ...config, SmallFormFieldLimit: Number(e.target.value) })}
          />
          /wizard&gt;
          <input
            type="number"
            style={{ width: 40, marginLeft: 4 }}
            value={config.WizardFieldLimit}
            onChange={(e) => setConfig({ ...config, WizardFieldLimit: Number(e.target.value) })}
          />
        </span>
        <label style={{ fontSize: 12 }}>
          <input
            type="checkbox"
            checked={filterByAg}
            onChange={(e) => setFilterByAg(e.target.checked)}
          />{" "}
          選択中のみ
        </label>
        <button onClick={derive}>▶ 派生</button>
        <button onClick={generateReactApp} title="React + Vite アプリを tar.gz でダウンロード">
          📦 tar.gz
        </button>
        <button
          onClick={launchAndRun}
          title="サーバー側のフォルダにアプリを生成して dev server を起動"
          style={{ background: "#16a34a" }}
        >
          🚀 生成 → 実行
        </button>
      </div>
      {error && (
        <div style={{ background: "#fee2e2", color: "#991b1b", padding: 8, fontSize: 12 }}>
          {error}
        </div>
      )}
      <div className="layout" data-mode={mode}>
        <div className="pane">
          <DomainTree
            domain={domain}
            selected={selected}
            onSelect={setSelected}
            onAdd={addAggregate}
            onRemove={removeAggregate}
          />
        </div>
        <div className="pane">
          {selectedAg ? (
            <AggregateEditor
              aggregate={selectedAg}
              onChange={(updated) => updateAggregate(updated, selectedAg.name)}
            />
          ) : (
            <p>左から Aggregate を選択してください。</p>
          )}
        </div>
        <RightPane
          spec={spec}
          domain={domain}
          filterAggregate={filterByAg ? selected : null}
        />
      </div>
      <RunPanel run={run} onStop={stopRun} onClose={closeRunPanel} />
    </div>
  );
}
