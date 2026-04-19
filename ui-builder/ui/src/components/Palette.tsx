import type { ComponentType } from "../types";

// Defaults applied when a palette item is dropped onto the canvas.
const PALETTE: { type: ComponentType; label: string; props: Record<string, unknown> }[] = [
  { type: "Text", label: "Text", props: { w: 200, h: 28, text: "Label", size: 14 } },
  { type: "Button", label: "Button", props: { w: 120, h: 36, label: "Click" } },
  { type: "Input", label: "Input", props: { w: 200, h: 28, placeholder: "..." } },
  { type: "Textarea", label: "Textarea", props: { w: 240, h: 80, placeholder: "..." } },
  { type: "NumberInput", label: "Number", props: { w: 120, h: 28 } },
  { type: "DateInput", label: "Date", props: { w: 160, h: 28 } },
  { type: "Checkbox", label: "Checkbox", props: { w: 120, h: 28, label: "Check" } },
  { type: "Table", label: "Table", props: { w: 600, h: 300, model: "" } },
];

interface Props {
  onAdd: (type: ComponentType, defaults: Record<string, unknown>) => void;
}

export function Palette({ onAdd }: Props) {
  return (
    <div>
      <h3>Components</h3>
      <ul>
        {PALETTE.map((p) => (
          <li
            key={p.type}
            className="palette-item"
            onClick={() => onAdd(p.type, p.props)}
            title="Click to add to canvas"
          >
            {p.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
