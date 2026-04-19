import { useEffect, useState } from "react";
import type {
  Aggregate, Domain, DomainAttribute, DomainEntity, DomainPosition,
  DomainReference, ValueObject,
} from "../types";
import { DOMAIN_PRIMITIVES } from "../types";
import { api } from "../api";
import { ERDiagram, type NodeKind } from "./ERDiagram";

interface Props { onExit: () => void }

// DomainBuilder is a full-screen mode that owns its own selection state and
// persists Domain documents through the /api/domains endpoints. The right
// panel changes shape depending on whether a VO, Entity, or Aggregate is
// selected, mirroring the way the App builder switches between component
// types.
export function DomainBuilder({ onExit }: Props) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [current, setCurrent] = useState<Domain | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<{ kind: NodeKind; name: string } | null>(null);

  useEffect(() => { void refresh(); }, []);
  const refresh = async () => {
    const list = await api.listDomains();
    setDomains(list);
    if (list.length > 0 && !current) setCurrent(list[0]);
  };

  const update = (patch: (d: Domain) => Domain) => {
    if (!current) return;
    setCurrent(patch(current));
    setDirty(true);
  };

  const newDomain = async () => {
    const id = prompt("Domain id?");
    if (!id) return;
    const d: Domain = {
      id, name: id, valueObjects: [], entities: [], aggregates: [], layout: {},
    };
    const saved = await api.saveDomain(d);
    await refresh();
    setCurrent(saved);
    setSelected(null);
    setDirty(false);
  };

  const save = async () => {
    if (!current) return;
    const saved = await api.saveDomain(current);
    setCurrent(saved);
    setDirty(false);
    await refresh();
  };

  const scaffoldModels = async () => {
    if (!current) return;
    if (dirty) await save();
    const created = await api.scaffoldDomain(current.id);
    alert(`Generated ${created.length} DataModel(s):\n` + created.map((m) => "• " + m.name).join("\n"));
  };

  const addVO = (isId: boolean) => update((d) => ({
    ...d,
    valueObjects: [...d.valueObjects, {
      name: uniqueName(d, isId ? "Id" : "NewVO"),
      isIdentifier: isId,
      attributes: isId ? [{ name: "value", type: "string", required: true }] : [],
    }],
  }));

  const addEntity = () => update((d) => {
    const ids = d.valueObjects.filter((v) => v.isIdentifier);
    return {
      ...d,
      entities: [...d.entities, {
        name: uniqueName(d, "Entity"),
        identifierName: "id",
        identifierType: ids[0]?.name ?? "",
        attributes: [],
        references: [],
      }],
    };
  });

  const addAggregate = () => update((d) => ({
    ...d,
    aggregates: [...d.aggregates, {
      name: uniqueName(d, "Aggregate"),
      root: d.entities[0]?.name ?? "",
      members: [],
    }],
  }));

  const moveNode = (name: string, p: DomainPosition) => update((d) => ({
    ...d, layout: { ...(d.layout ?? {}), [name]: p },
  }));

  const selectedVO = current?.valueObjects.find((v) => selected?.kind === "vo" && v.name === selected.name) ?? null;
  const selectedEntity = current?.entities.find((e) => selected?.kind === "entity" && e.name === selected.name) ?? null;
  const selectedAggregate = current?.aggregates.find((a) => selected?.kind === "aggregate" && a.name === selected.name) ?? null;

  return (
    <div className="app">
      <div className="topbar">
        <h1>Domain Builder (DDD)</h1>
        <select value={current?.id ?? ""} onChange={(e) => {
          const d = domains.find((x) => x.id === e.target.value);
          if (d) { setCurrent(d); setSelected(null); setDirty(false); }
        }}>
          <option value="">(no domain)</option>
          {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button onClick={newDomain}>+ New domain</button>
        <button onClick={() => addVO(true)} disabled={!current}>+ Identifier VO</button>
        <button onClick={() => addVO(false)} disabled={!current}>+ Value Object</button>
        <button onClick={addEntity} disabled={!current}>+ Entity</button>
        <button onClick={addAggregate} disabled={!current}>+ Aggregate</button>
        <button onClick={save} disabled={!current || !dirty}>{dirty ? "Save*" : "Save"}</button>
        <button className="primary" onClick={scaffoldModels} disabled={!current}>
          → Generate DataModels
        </button>
        <button onClick={onExit}>Back to UI Builder</button>
      </div>

      <div className="workspace" style={{ gridTemplateColumns: "240px 1fr 320px" }}>
        <div className="panel">
          <h3>Value Objects</h3>
          <ul>
            {current?.valueObjects.map((v) => (
              <li key={v.name}
                className={`list-item ${selected?.kind === "vo" && selected.name === v.name ? "active" : ""}`}
                onClick={() => setSelected({ kind: "vo", name: v.name })}>
                {v.isIdentifier ? "🔑 " : ""}{v.name}
              </li>
            ))}
          </ul>
          <h3>Entities</h3>
          <ul>
            {current?.entities.map((e) => (
              <li key={e.name}
                className={`list-item ${selected?.kind === "entity" && selected.name === e.name ? "active" : ""}`}
                onClick={() => setSelected({ kind: "entity", name: e.name })}>
                {e.name}
              </li>
            ))}
          </ul>
          <h3>Aggregates</h3>
          <ul>
            {current?.aggregates.map((a) => (
              <li key={a.name}
                className={`list-item ${selected?.kind === "aggregate" && selected.name === a.name ? "active" : ""}`}
                onClick={() => setSelected({ kind: "aggregate", name: a.name })}>
                {a.name}
              </li>
            ))}
          </ul>
        </div>

        <div className="canvas-wrap" style={{ background: "#f3f4f6" }}>
          {current
            ? <ERDiagram domain={current} selected={selected} onSelect={setSelected} onMove={moveNode} />
            : <div className="empty">Create or select a domain to begin.</div>}
        </div>

        <div className="panel right props">
          {selectedVO && (
            <VOEditor
              vo={selectedVO}
              voNames={current!.valueObjects.map((v) => v.name)}
              onChange={(patch) => update((d) => ({
                ...d,
                valueObjects: d.valueObjects.map((v) => v.name === selectedVO.name ? { ...v, ...patch } : v),
              }))}
              onRename={(newName) => update((d) => renameNode(d, "vo", selectedVO.name, newName))}
              onDelete={() => {
                update((d) => ({ ...d, valueObjects: d.valueObjects.filter((v) => v.name !== selectedVO.name) }));
                setSelected(null);
              }}
            />
          )}
          {selectedEntity && current && (
            <EntityEditor
              entity={selectedEntity}
              voNames={current.valueObjects.map((v) => v.name)}
              idVOs={current.valueObjects.filter((v) => v.isIdentifier).map((v) => v.name)}
              entityNames={current.entities.map((e) => e.name)}
              onChange={(patch) => update((d) => ({
                ...d,
                entities: d.entities.map((e) => e.name === selectedEntity.name ? { ...e, ...patch } : e),
              }))}
              onRename={(newName) => update((d) => renameNode(d, "entity", selectedEntity.name, newName))}
              onDelete={() => {
                update((d) => ({ ...d, entities: d.entities.filter((e) => e.name !== selectedEntity.name) }));
                setSelected(null);
              }}
            />
          )}
          {selectedAggregate && current && (
            <AggregateEditor
              aggregate={selectedAggregate}
              entityNames={current.entities.map((e) => e.name)}
              onChange={(patch) => update((d) => ({
                ...d,
                aggregates: d.aggregates.map((a) => a.name === selectedAggregate.name ? { ...a, ...patch } : a),
              }))}
              onDelete={() => {
                update((d) => ({ ...d, aggregates: d.aggregates.filter((a) => a.name !== selectedAggregate.name) }));
                setSelected(null);
              }}
            />
          )}
          {!selected && <p style={{ color: "#9ca3af" }}>Select a node on the diagram to edit it.</p>}
        </div>
      </div>
    </div>
  );
}

// ---- helpers ----

function uniqueName(d: Domain, base: string): string {
  const all = new Set([
    ...d.valueObjects.map((v) => v.name),
    ...d.entities.map((e) => e.name),
    ...d.aggregates.map((a) => a.name),
  ]);
  let i = 1;
  let n = base;
  while (all.has(n)) { i++; n = base + i; }
  return n;
}

// renameNode propagates the rename to identifier types, attributes, references,
// aggregate roots/members, and layout keys.
function renameNode(d: Domain, kind: NodeKind, oldName: string, newName: string): Domain {
  if (oldName === newName || !newName) return d;
  const apply = (s: string) => (s === oldName ? newName : s);
  return {
    ...d,
    valueObjects: d.valueObjects.map((v) =>
      kind === "vo" && v.name === oldName ? { ...v, name: newName } : {
        ...v,
        attributes: v.attributes.map((a) => kind === "vo" ? { ...a, type: apply(a.type) } : a),
      }),
    entities: d.entities.map((e) => {
      const ent = kind === "entity" && e.name === oldName ? { ...e, name: newName } : { ...e };
      ent.identifierType = apply(ent.identifierType);
      ent.attributes = ent.attributes.map((a) => ({ ...a, type: apply(a.type) }));
      ent.references = (ent.references ?? []).map((r) => ({ ...r, target: apply(r.target) }));
      return ent;
    }),
    aggregates: d.aggregates.map((a) =>
      kind === "aggregate" && a.name === oldName
        ? { ...a, name: newName }
        : { ...a, root: apply(a.root), members: (a.members ?? []).map(apply) }),
    layout: Object.fromEntries(
      Object.entries(d.layout ?? {}).map(([k, v]) => [k === oldName ? newName : k, v]),
    ),
  };
}

// ---- editors ----

function AttributeRows({ items, voNames, onChange }: {
  items: DomainAttribute[];
  voNames: string[];
  onChange: (next: DomainAttribute[]) => void;
}) {
  const setAt = (i: number, patch: Partial<DomainAttribute>) =>
    onChange(items.map((a, j) => (i === j ? { ...a, ...patch } : a)));
  return (
    <>
      {items.map((a, i) => (
        <div key={i} className="field-row" style={{ gridTemplateColumns: "1fr 1fr 60px 32px" }}>
          <input value={a.name} placeholder="name"
            onChange={(e) => setAt(i, { name: e.target.value })} />
          <select value={a.type} onChange={(e) => setAt(i, { type: e.target.value })}>
            <optgroup label="primitive">
              {DOMAIN_PRIMITIVES.map((p) => <option key={p} value={p}>{p}</option>)}
            </optgroup>
            {voNames.length > 0 && (
              <optgroup label="value objects">
                {voNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </optgroup>
            )}
          </select>
          <label style={{ fontSize: 11 }}>
            <input type="checkbox" checked={!!a.required}
              onChange={(e) => setAt(i, { required: e.target.checked })} /> req
          </label>
          <button onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button onClick={() => onChange([...items, { name: "", type: "string" }])}>+ Add attribute</button>
    </>
  );
}

function VOEditor({ vo, voNames, onChange, onRename, onDelete }: {
  vo: ValueObject;
  voNames: string[];
  onChange: (patch: Partial<ValueObject>) => void;
  onRename: (n: string) => void;
  onDelete: () => void;
}) {
  return (
    <>
      <h3>《Value Object》{vo.isIdentifier && " (Identifier)"}</h3>
      <label>name</label>
      <input value={vo.name} onChange={(e) => onRename(e.target.value)} />
      <label>
        <input type="checkbox" checked={!!vo.isIdentifier}
          onChange={(e) => onChange({ isIdentifier: e.target.checked })} />
        used as identifier
      </label>
      <h3 style={{ marginTop: 12 }}>Attributes</h3>
      <AttributeRows
        items={vo.attributes} voNames={voNames.filter((n) => n !== vo.name)}
        onChange={(next) => onChange({ attributes: next })}
      />
      <button className="danger" onClick={onDelete}>Delete VO</button>
    </>
  );
}

function EntityEditor({ entity, voNames, idVOs, entityNames, onChange, onRename, onDelete }: {
  entity: DomainEntity;
  voNames: string[];
  idVOs: string[];
  entityNames: string[];
  onChange: (patch: Partial<DomainEntity>) => void;
  onRename: (n: string) => void;
  onDelete: () => void;
}) {
  const setRef = (i: number, patch: Partial<DomainReference>) => {
    const refs = [...(entity.references ?? [])];
    refs[i] = { ...refs[i], ...patch };
    onChange({ references: refs });
  };
  return (
    <>
      <h3>《Entity》</h3>
      <label>name</label>
      <input value={entity.name} onChange={(e) => onRename(e.target.value)} />
      <h3 style={{ marginTop: 12 }}>Identifier</h3>
      <div className="row">
        <div>
          <label>name</label>
          <input value={entity.identifierName}
            onChange={(e) => onChange({ identifierName: e.target.value })} />
        </div>
        <div>
          <label>type (Identifier VO)</label>
          <select value={entity.identifierType}
            onChange={(e) => onChange({ identifierType: e.target.value })}>
            <option value="">(none)</option>
            {idVOs.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <h3 style={{ marginTop: 12 }}>Attributes</h3>
      <AttributeRows
        items={entity.attributes} voNames={voNames}
        onChange={(next) => onChange({ attributes: next })}
      />
      <h3 style={{ marginTop: 12 }}>References</h3>
      {(entity.references ?? []).map((r, i) => (
        <div key={i} className="field-row" style={{ gridTemplateColumns: "1fr 1fr 70px 32px" }}>
          <input value={r.name} placeholder="name"
            onChange={(e) => setRef(i, { name: e.target.value })} />
          <select value={r.target} onChange={(e) => setRef(i, { target: e.target.value })}>
            <option value="">(target)</option>
            {entityNames.filter((n) => n !== entity.name).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select value={r.cardinality}
            onChange={(e) => setRef(i, { cardinality: e.target.value as "one" | "many" })}>
            <option value="one">one</option>
            <option value="many">many</option>
          </select>
          <button onClick={() => onChange({ references: (entity.references ?? []).filter((_, j) => j !== i) })}>×</button>
        </div>
      ))}
      <button onClick={() => onChange({
        references: [...(entity.references ?? []), { name: "", target: "", cardinality: "one" }],
      })}>+ Add reference</button>
      <button className="danger" style={{ marginTop: 12 }} onClick={onDelete}>Delete Entity</button>
    </>
  );
}

function AggregateEditor({ aggregate, entityNames, onChange, onDelete }: {
  aggregate: Aggregate;
  entityNames: string[];
  onChange: (patch: Partial<Aggregate>) => void;
  onDelete: () => void;
}) {
  const toggleMember = (n: string) => {
    const set = new Set(aggregate.members ?? []);
    if (set.has(n)) set.delete(n); else set.add(n);
    onChange({ members: [...set] });
  };
  return (
    <>
      <h3>《Aggregate》</h3>
      <label>name</label>
      <input value={aggregate.name} onChange={(e) => onChange({ name: e.target.value })} />
      <label>root entity</label>
      <select value={aggregate.root} onChange={(e) => onChange({ root: e.target.value })}>
        <option value="">(none)</option>
        {entityNames.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <h3 style={{ marginTop: 12 }}>Member entities</h3>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
        Additional entities inside the consistency boundary (the root is always included).
      </div>
      {entityNames.filter((n) => n !== aggregate.root).map((n) => (
        <label key={n} style={{ display: "block", marginTop: 4 }}>
          <input type="checkbox"
            checked={(aggregate.members ?? []).includes(n)}
            onChange={() => toggleMember(n)} /> {n}
        </label>
      ))}
      <button className="danger" style={{ marginTop: 12 }} onClick={onDelete}>Delete Aggregate</button>
    </>
  );
}
