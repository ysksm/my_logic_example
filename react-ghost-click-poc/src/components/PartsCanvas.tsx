import { useEffect, useRef, type PointerEvent, type MouseEvent, type TouchEvent } from "react";
import type { Part, Point } from "../types";
import type { Strategy } from "../strategies";

export const CANVAS_W = 360;
export const CANVAS_H = 300;

export interface ActivateInfo {
  part: Part;
  /** viewport 座標 (ダイアログの表示位置に使う) */
  client: Point;
  pointerType: string;
}

interface Props {
  parts: Part[];
  strategy: Strategy;
  onActivate: (info: ActivateInfo) => void;
}

function hitTest(parts: Part[], p: Point): Part | undefined {
  // 後に描いたものが手前なので後ろから探す
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i];
    if (p.x >= q.x && p.x <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h) return q;
  }
  return undefined;
}

/**
 * パーツを置いた <canvas>。
 * 戦略の trigger に応じて pointerup または click でパーツ操作を通知する。
 */
export function PartsCanvas({ parts, strategy, onActivate }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  // 「このタッチでダイアログを開いた」印。touchend で preventDefault するか決めるのに使う
  const openedDuringTouch = useRef(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.strokeStyle = "#e2e2e2";
    for (let x = 0; x <= CANVAS_W; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_H);
      ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_W, y);
      ctx.stroke();
    }

    for (const p of parts) {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 20px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`パーツ ${p.name}`, p.x + p.w / 2, p.y + p.h / 2);
    }
  }, [parts]);

  const toLocal = (clientX: number, clientY: number): Point => {
    const rect = ref.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const activateAt = (clientX: number, clientY: number, pointerType: string) => {
    const part = hitTest(parts, toLocal(clientX, clientY));
    if (!part) return false;
    onActivate({ part, client: { x: clientX, y: clientY }, pointerType });
    return true;
  };

  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    if (strategy.trigger !== "pointerup") return;
    if (activateAt(e.clientX, e.clientY, e.pointerType)) {
      openedDuringTouch.current = true;
    }
  };

  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (strategy.trigger !== "click") return;
    const pt = (e.nativeEvent as Partial<globalThis.PointerEvent>).pointerType ?? "mouse";
    activateAt(e.clientX, e.clientY, pt);
  };

  const onTouchEnd = (e: TouchEvent<HTMLCanvasElement>) => {
    const opened = openedDuringTouch.current;
    openedDuringTouch.current = false;
    if (!opened || !strategy.preventDefaultTouchEnd) return;
    // 対策 1: このタップ由来の互換マウスイベント (mousedown/mouseup/click) を生成させない。
    // React の onTouchEnd は非 passive で登録されるので preventDefault が効く。
    e.preventDefault();
  };

  return (
    <canvas
      ref={ref}
      data-log="canvas"
      data-testid="parts-canvas"
      className="parts-canvas"
      style={{ width: CANVAS_W, height: CANVAS_H }}
      onPointerUp={onPointerUp}
      onClick={onClick}
      onTouchEnd={onTouchEnd}
    />
  );
}
