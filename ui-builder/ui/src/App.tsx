import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { AppComponent, AppDoc, ComponentType, DataModel, Transition } from "./types";
import { Palette } from "./components/Palette";
import { Canvas } from "./components/Canvas";
import { Properties } from "./components/Properties";
import { ScreensPanel } from "./components/ScreensPanel";
import { ModelEditor } from "./components/ModelEditor";
import { Preview } from "./components/Preview";

export function App() {
  const [models, setModels] = useState<DataModel[]>([]);
  const [apps, setApps] = useState<AppDoc[]>([]);
  const [currentApp, setCurrentApp] = useState<AppDoc | null>(null);
  const [currentScreenId, setCurrentScreenId] = useState<string>("");
  const [selectedCompId, setSelectedCompId] = useState<string | null>(null);
  const [showModels, setShowModels] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Initial load.
  useEffect(() => { void refresh(); }, []);
  const refresh = async () => {
    const [m, a] = await Promise.all([api.listModels(), api.listApps()]);
    setModels(m);
    setApps(a);
    if (!currentApp && a.length > 0) selectApp(a[0]);
  };

  const selectApp = (a: AppDoc) => {
    setCurrentApp(a);
    setCurrentScreenId(a.initialScreen || a.screens[0]?.id || "");
    setSelectedCompId(null);
    setDirty(false);
  };

  const updateApp = useCallback((patch: (a: AppDoc) => AppDoc) => {
    setCurrentApp((a) => (a ? patch(a) : a));
    setDirty(true);
  }, []);

  const currentScreen = currentApp?.screens.find((s) => s.id === currentScreenId) ?? null;
  const selectedComp = currentScreen?.components.find((c) => c.id === selectedCompId) ?? null;

  const addComponent = (type: ComponentType, defaults: Record<string, unknown>) => {
    if (!currentApp || !currentScreen) return;
    const id = `${type.toLowerCase()}_${Date.now().toString(36)}`;
    const comp: AppComponent = {
      id, type,
      props: { x: 40, y: 40, w: 120, h: 32, ...defaults },
    };
    updateApp((a) => ({
      ...a,
      screens: a.screens.map((s) => s.id === currentScreen.id ? { ...s, components: [...s.components, comp] } : s),
    }));
    setSelectedCompId(id);
  };

  const updateCompProps = (id: string, patch: Partial<AppComponent["props"]>) => {
    if (!currentScreen) return;
    updateApp((a) => ({
      ...a,
      screens: a.screens.map((s) => s.id !== currentScreen.id ? s : ({
        ...s,
        components: s.components.map((c) => c.id === id ? { ...c, props: { ...c.props, ...patch } } : c),
      })),
    }));
  };

  const updateComp = (patch: Partial<AppComponent>) => {
    if (!currentScreen || !selectedComp) return;
    updateApp((a) => ({
      ...a,
      screens: a.screens.map((s) => s.id !== currentScreen.id ? s : ({
        ...s,
        components: s.components.map((c) => c.id === selectedComp.id ? { ...c, ...patch } : c),
      })),
    }));
    if (patch.id) setSelectedCompId(patch.id);
  };

  const deleteComp = () => {
    if (!currentScreen || !selectedComp) return;
    updateApp((a) => ({
      ...a,
      screens: a.screens.map((s) => s.id !== currentScreen.id ? s : ({
        ...s,
        components: s.components.filter((c) => c.id !== selectedComp.id),
      })),
    }));
    setSelectedCompId(null);
  };

  const addScreen = () => {
    if (!currentApp) return;
    const id = `screen_${Date.now().toString(36)}`;
    updateApp((a) => ({
      ...a,
      screens: [...a.screens, { id, name: "New screen", components: [] }],
    }));
    setCurrentScreenId(id);
  };

  const deleteScreen = (id: string) => {
    if (!currentApp || currentApp.screens.length <= 1) return;
    updateApp((a) => ({
      ...a,
      screens: a.screens.filter((s) => s.id !== id),
      transitions: a.transitions.filter((t) => t.from !== id && t.to !== id),
      initialScreen: a.initialScreen === id ? a.screens.find((s) => s.id !== id)!.id : a.initialScreen,
    }));
    if (currentScreenId === id) setCurrentScreenId(currentApp.screens.find((s) => s.id !== id)!.id);
  };

  const addTransition = (t: Transition) =>
    updateApp((a) => ({ ...a, transitions: [...a.transitions, t] }));
  const deleteTransition = (i: number) =>
    updateApp((a) => ({ ...a, transitions: a.transitions.filter((_, j) => j !== i) }));
  const setInitial = (id: string) => updateApp((a) => ({ ...a, initialScreen: id }));

  const newApp = async () => {
    const id = prompt("App id?");
    if (!id) return;
    const draft: AppDoc = {
      id, name: id,
      initialScreen: "home",
      screens: [{ id: "home", name: "Home", components: [] }],
      transitions: [],
      stateVariables: {},
    };
    const saved = await api.saveApp(draft);
    await refresh();
    selectApp(saved);
  };

  const save = async () => {
    if (!currentApp) return;
    const saved = await api.saveApp(currentApp);
    setCurrentApp(saved);
    setDirty(false);
    await refresh();
  };

  const onScaffold = async (name: string) => {
    const a = await api.scaffold(name);
    await refresh();
    selectApp(a);
    setShowModels(false);
  };

  if (previewing && currentApp) {
    return <Preview app={currentApp} onExit={() => setPreviewing(false)} />;
  }

  return (
    <div className="app">
      <div className="topbar">
        <h1>UI Builder</h1>
        <select value={currentApp?.id ?? ""} onChange={(e) => {
          const a = apps.find((x) => x.id === e.target.value);
          if (a) selectApp(a);
        }}>
          <option value="">(no app)</option>
          {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button onClick={newApp}>+ New app</button>
        <button onClick={() => setShowModels(true)}>Models</button>
        <button onClick={save} disabled={!currentApp || !dirty}>{dirty ? "Save*" : "Save"}</button>
        <button className="primary" onClick={() => setPreviewing(true)} disabled={!currentApp}>▶ Preview</button>
      </div>

      <div className="workspace">
        <div className="panel">
          <Palette onAdd={addComponent} />
          {currentApp && (
            <ScreensPanel
              screens={currentApp.screens}
              transitions={currentApp.transitions}
              initialScreen={currentApp.initialScreen}
              currentScreenId={currentScreenId}
              onSelect={(id) => { setCurrentScreenId(id); setSelectedCompId(null); }}
              onAddScreen={addScreen}
              onDeleteScreen={deleteScreen}
              onSetInitial={setInitial}
              onAddTransition={addTransition}
              onDeleteTransition={deleteTransition}
            />
          )}
        </div>

        {currentScreen ? (
          <Canvas
            screen={currentScreen}
            selectedId={selectedCompId}
            onSelect={setSelectedCompId}
            onUpdate={updateCompProps}
          />
        ) : (
          <div className="canvas-wrap"><div className="empty">Create or select an app to begin.</div></div>
        )}

        <div className="panel right">
          {currentApp && currentScreen && (
            <>
              <h3>Screen</h3>
              <label>name</label>
              <input value={currentScreen.name} onChange={(e) =>
                updateApp((a) => ({
                  ...a,
                  screens: a.screens.map((s) => s.id === currentScreen.id ? { ...s, name: e.target.value } : s),
                }))} />
              <label>id</label>
              <input value={currentScreen.id} onChange={(e) => {
                const newId = e.target.value;
                const oldId = currentScreen.id;
                updateApp((a) => ({
                  ...a,
                  screens: a.screens.map((s) => s.id === oldId ? { ...s, id: newId } : s),
                  transitions: a.transitions.map((t) => ({
                    ...t,
                    from: t.from === oldId ? newId : t.from,
                    to: t.to === oldId ? newId : t.to,
                  })),
                  initialScreen: a.initialScreen === oldId ? newId : a.initialScreen,
                }));
                setCurrentScreenId(newId);
              }} />
              <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #e5e7eb" }} />
            </>
          )}
          <Properties
            comp={selectedComp}
            screens={currentApp?.screens ?? []}
            models={models.map((m) => m.name)}
            onChange={updateComp}
            onDelete={deleteComp}
          />
        </div>
      </div>

      {showModels && (
        <ModelEditor
          models={models}
          onSave={async (m) => { await api.saveModel(m); await refresh(); }}
          onDelete={async (n) => { await api.deleteModel(n); await refresh(); }}
          onScaffold={onScaffold}
          onClose={() => setShowModels(false)}
        />
      )}
    </div>
  );
}
