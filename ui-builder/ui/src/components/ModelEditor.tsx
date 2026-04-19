import { useState } from "react";
import type { DataModel, Field, FieldType } from "../types";
import { emptyField, emptyModel } from "../api";

interface Props {
  models: DataModel[];
  onSave: (m: DataModel) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
  onScaffold: (name: string) => Promise<void>;
  onClose: () => void;
}

const TYPES: FieldType[] = ["string", "text", "int", "bool", "date", "ref"];

// Modal data-model editor — the equivalent of editing db/migrate/*.rb in Rails.
// Saving a model lets the user one-click "scaffold" an App from it.
export function ModelEditor({ models, onSave, onDelete, onScaffold, onClose }: Props) {
  const [draft, setDraft] = useState<DataModel>(emptyModel());

  const setField = (idx: number, patch: Partial<Field>) =>
    setDraft({ ...draft, fields: draft.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)) });

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Data Models</h2>

        <h3>Existing</h3>
        {models.length === 0 && <p style={{ color: "#9ca3af" }}>No models yet.</p>}
        <ul>
          {models.map((m) => (
            <li key={m.name} className="list-item" style={{ display: "flex", justifyContent: "space-between" }}>
              <span><strong>{m.name}</strong> ({m.fields.length} fields)</span>
              <span>
                <button onClick={() => onScaffold(m.name)}>Scaffold app</button>
                <button onClick={() => setDraft(m)} style={{ marginLeft: 4 }}>Edit</button>
                <button onClick={() => onDelete(m.name)} className="danger" style={{ marginLeft: 4 }}>Delete</button>
              </span>
            </li>
          ))}
        </ul>

        <h3 style={{ marginTop: 16 }}>{draft.name ? `Editing: ${draft.name}` : "New model"}</h3>
        <label>Model name</label>
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="e.g. Post" />

        <h3 style={{ marginTop: 12 }}>Fields</h3>
        {draft.fields.map((f, i) => (
          <div key={i} className="field-row">
            <input value={f.name} onChange={(e) => setField(i, { name: e.target.value })} placeholder="name" />
            <select value={f.type} onChange={(e) => setField(i, { type: e.target.value as FieldType })}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label style={{ fontSize: 12 }}>
              <input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked })} />
              req
            </label>
            <button onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <button onClick={() => setDraft({ ...draft, fields: [...draft.fields, emptyField()] })}>
          + Add field
        </button>

        <div className="modal-actions">
          <button onClick={() => setDraft(emptyModel())}>Reset</button>
          <button onClick={onClose}>Close</button>
          <button
            className="danger"
            style={{ background: "#2563eb" }}
            onClick={async () => {
              if (!draft.name) return;
              await onSave(draft);
              setDraft(emptyModel());
            }}
          >Save model</button>
        </div>
      </div>
    </div>
  );
}
