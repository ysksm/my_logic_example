import type { Aggregate, DomainModel } from "../types";

interface Props {
  domain: DomainModel;
  selected: string | null;
  onSelect: (aggregateName: string) => void;
  onAdd: () => void;
  onRemove: (aggregateName: string) => void;
}

export function DomainTree({ domain, selected, onSelect, onAdd, onRemove }: Props) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h2>Aggregates</h2>
        <button className="btn" onClick={onAdd}>+ 追加</button>
      </div>
      {domain.aggregates.map((ag) => (
        <AggregateRow
          key={ag.name}
          ag={ag}
          selected={selected === ag.name}
          onSelect={() => onSelect(ag.name)}
          onRemove={() => onRemove(ag.name)}
        />
      ))}
    </div>
  );
}

function AggregateRow({
  ag, selected, onSelect, onRemove,
}: { ag: Aggregate; selected: boolean; onSelect: () => void; onRemove: () => void }) {
  return (
    <div className={`tree-item ${selected ? "selected" : ""}`} onClick={onSelect}>
      <span>
        {ag.isSingleton ? "⚙ " : "◆ "}
        {ag.name}
        {ag.uiHint?.pattern && <small style={{ marginLeft: 6 }}>{ag.uiHint.pattern}</small>}
      </span>
      <button
        className="btn danger"
        style={{ padding: "1px 6px", fontSize: 11 }}
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
      >×</button>
    </div>
  );
}
