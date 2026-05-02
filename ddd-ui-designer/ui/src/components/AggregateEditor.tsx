import type {
  Aggregate, Entity, Field, FieldType, ValueObject,
} from "../types";

interface Props {
  aggregate: Aggregate;
  onChange: (a: Aggregate) => void;
}

const FIELD_TYPES: FieldType[] = [
  "string", "text", "int", "bool", "date", "enum", "ref", "vo",
];

export function AggregateEditor({ aggregate, onChange }: Props) {
  const update = (patch: Partial<Aggregate>) =>
    onChange({ ...aggregate, ...patch });

  return (
    <div>
      <h2>Aggregate: {aggregate.name}</h2>
      <label className="row">
        名前
        <input
          type="text"
          value={aggregate.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </label>
      <label className="row">
        Singleton?
        <input
          type="checkbox"
          checked={!!aggregate.isSingleton}
          onChange={(e) => update({ isSingleton: e.target.checked })}
        />
      </label>

      <div className="subhead">UI ヒント (任意)</div>
      <label className="row">
        Pattern
        <select
          value={aggregate.uiHint?.pattern ?? ""}
          onChange={(e) => update({ uiHint: { ...aggregate.uiHint, pattern: e.target.value as any } })}
        >
          <option value="">(自動)</option>
          <option value="P1">P1 List+Modal</option>
          <option value="P2">P2 List+Detail</option>
          <option value="P3">P3 Master-Detail</option>
          <option value="P4">P4 Wizard</option>
          <option value="P5">P5 Single Form</option>
        </select>
      </label>
      <label className="row">
        子エンティティ表示
        <select
          value={aggregate.uiHint?.childStyle ?? ""}
          onChange={(e) => update({ uiHint: { ...aggregate.uiHint, childStyle: e.target.value as any } })}
        >
          <option value="">tab (既定)</option>
          <option value="tab">tab</option>
          <option value="section">section</option>
          <option value="table">table</option>
        </select>
      </label>

      <div className="subhead">Root Entity</div>
      <EntityEditor
        entity={aggregate.root}
        siblings={(aggregate.entities ?? []).map((e) => e.name)}
        valueObjects={aggregate.valueObjects ?? []}
        otherAggregates={[]}
        onChange={(e) => update({ root: e })}
      />

      <div className="subhead">子 Entities</div>
      {(aggregate.entities ?? []).map((e, idx) => (
        <details key={idx} style={{ border: "1px solid #e5e7eb", borderRadius: 4, padding: 6, marginBottom: 6 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>{e.name || "(no name)"}</summary>
          <EntityEditor
            entity={e}
            siblings={[]}
            valueObjects={aggregate.valueObjects ?? []}
            otherAggregates={[]}
            onChange={(updated) => {
              const next = [...(aggregate.entities ?? [])];
              next[idx] = updated;
              update({ entities: next });
            }}
            onDelete={() => {
              const next = (aggregate.entities ?? []).filter((_, i) => i !== idx);
              update({ entities: next });
            }}
          />
        </details>
      ))}
      <button
        className="btn secondary"
        onClick={() =>
          update({
            entities: [
              ...(aggregate.entities ?? []),
              { name: "Child" + ((aggregate.entities?.length ?? 0) + 1), fields: [] },
            ],
          })
        }
      >+ 子Entity追加</button>

      <div className="subhead">Value Objects</div>
      {(aggregate.valueObjects ?? []).map((vo, idx) => (
        <VOEditor
          key={idx}
          vo={vo}
          onChange={(v) => {
            const next = [...(aggregate.valueObjects ?? [])];
            next[idx] = v;
            update({ valueObjects: next });
          }}
          onDelete={() => {
            const next = (aggregate.valueObjects ?? []).filter((_, i) => i !== idx);
            update({ valueObjects: next });
          }}
        />
      ))}
      <button
        className="btn secondary"
        onClick={() =>
          update({
            valueObjects: [
              ...(aggregate.valueObjects ?? []),
              { name: "VO" + ((aggregate.valueObjects?.length ?? 0) + 1), fields: [] },
            ],
          })
        }
      >+ VO追加</button>
    </div>
  );
}

function EntityEditor({
  entity, siblings, valueObjects, onChange, onDelete,
}: {
  entity: Entity;
  siblings: string[];
  valueObjects: ValueObject[];
  otherAggregates: string[];
  onChange: (e: Entity) => void;
  onDelete?: () => void;
}) {
  const update = (patch: Partial<Entity>) => onChange({ ...entity, ...patch });
  return (
    <div>
      <label className="row">
        名前
        <input
          type="text"
          value={entity.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </label>
      {siblings.length > 0 && (
        <label className="row">
          子Entity (children)
          <select
            multiple
            value={entity.children ?? []}
            onChange={(e) => {
              const opts = Array.from(e.target.selectedOptions).map((o) => o.value);
              update({ children: opts });
            }}
            style={{ height: 60 }}
          >
            {siblings.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}
      <FieldsEditor
        fields={entity.fields}
        valueObjects={valueObjects}
        onChange={(fs) => update({ fields: fs })}
      />
      {onDelete && (
        <button className="btn danger" onClick={onDelete} style={{ marginTop: 6 }}>このEntityを削除</button>
      )}
    </div>
  );
}

function FieldsEditor({
  fields, valueObjects, onChange,
}: {
  fields: Field[];
  valueObjects: ValueObject[];
  onChange: (fs: Field[]) => void;
}) {
  const setAt = (i: number, patch: Partial<Field>) => {
    const next = [...fields];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  return (
    <div>
      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>fields</div>
      {fields.map((f, i) => (
        <div className="field-row" key={i}>
          <input
            type="text"
            value={f.name}
            onChange={(e) => setAt(i, { name: e.target.value })}
            placeholder="name"
          />
          <select
            value={f.type}
            onChange={(e) => setAt(i, { type: e.target.value as FieldType })}
          >
            {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {f.type === "vo" ? (
            <select
              value={f.voTypeRef ?? ""}
              onChange={(e) => setAt(i, { voTypeRef: e.target.value })}
            >
              <option value="">(VO選択)</option>
              {valueObjects.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          ) : f.type === "ref" ? (
            <input
              type="text"
              value={f.refTo ?? ""}
              onChange={(e) => setAt(i, { refTo: e.target.value })}
              placeholder="refTo (Aggregate name)"
            />
          ) : f.type === "enum" ? (
            <input
              type="text"
              value={(f.enumValues ?? []).join(",")}
              onChange={(e) => setAt(i, { enumValues: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              placeholder="A,B,C"
            />
          ) : (
            <span />
          )}
          <button onClick={() => onChange(fields.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button
        className="btn secondary"
        onClick={() => onChange([...fields, { name: "field" + (fields.length + 1), type: "string" }])}
      >+ field</button>
    </div>
  );
}

function VOEditor({
  vo, onChange, onDelete,
}: { vo: ValueObject; onChange: (v: ValueObject) => void; onDelete: () => void }) {
  return (
    <details style={{ border: "1px solid #e5e7eb", borderRadius: 4, padding: 6, marginBottom: 6 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        {vo.name} {vo.isIdentifier && <small>(id)</small>}
      </summary>
      <label className="row">
        名前
        <input
          type="text"
          value={vo.name}
          onChange={(e) => onChange({ ...vo, name: e.target.value })}
        />
      </label>
      <label className="row">
        Identifier?
        <input
          type="checkbox"
          checked={!!vo.isIdentifier}
          onChange={(e) => onChange({ ...vo, isIdentifier: e.target.checked })}
        />
      </label>
      <FieldsEditor
        fields={vo.fields}
        valueObjects={[]}
        onChange={(fs) => onChange({ ...vo, fields: fs })}
      />
      <button className="btn danger" onClick={onDelete} style={{ marginTop: 6 }}>このVOを削除</button>
    </details>
  );
}
