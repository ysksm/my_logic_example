import { useRef, useState, useEffect } from "react";
import type { AppComponent, Screen } from "../types";
import { renderComponent } from "./renderComponent";

interface Props {
  screen: Screen;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<AppComponent["props"]>) => void;
}

// Canvas hosts the screen being designed. It supports click-to-select,
// drag-to-move (mousedown on the body), and drag-to-resize (handle).
export function Canvas({ screen, selectedId, onSelect, onUpdate }: Props) {
  return (
    <div className="canvas-wrap" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onSelect(null);
    }}>
      <div className="canvas" style={{ width: 880, height: 600 }} onMouseDown={(e) => {
        if ((e.target as HTMLElement).classList.contains("canvas")) onSelect(null);
      }}>
        {screen.components.map((c) => (
          <DraggableComponent
            key={c.id}
            comp={c}
            selected={c.id === selectedId}
            onSelect={() => onSelect(c.id)}
            onMove={(dx, dy) => onUpdate(c.id, { x: (c.props.x as number) + dx, y: (c.props.y as number) + dy })}
            onResize={(dw, dh) => onUpdate(c.id, {
              w: Math.max(20, (c.props.w as number) + dw),
              h: Math.max(20, (c.props.h as number) + dh),
            })}
          />
        ))}
        {screen.components.length === 0 && (
          <div className="empty">Click a component on the left to add it.</div>
        )}
      </div>
    </div>
  );
}

interface DragProps {
  comp: AppComponent;
  selected: boolean;
  onSelect: () => void;
  onMove: (dx: number, dy: number) => void;
  onResize: (dw: number, dh: number) => void;
}

function DraggableComponent({ comp, selected, onSelect, onMove, onResize }: DragProps) {
  const [drag, setDrag] = useState<{ kind: "move" | "resize"; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!drag) return;
    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (drag.kind === "move") onMove(dx, dy);
      else onResize(dx, dy);
      setDrag({ ...drag, x: e.clientX, y: e.clientY });
    };
    const onUp = () => setDrag(null);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, onMove, onResize]);

  const p = comp.props;
  return (
    <div
      ref={ref}
      className={`comp ${selected ? "selected" : ""}`}
      style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onSelect();
        setDrag({ kind: "move", x: e.clientX, y: e.clientY });
      }}
    >
      {renderComponent(comp, { mode: "design" })}
      {selected && (
        <div
          className="handle"
          onMouseDown={(e) => {
            e.stopPropagation();
            setDrag({ kind: "resize", x: e.clientX, y: e.clientY });
          }}
        />
      )}
    </div>
  );
}
