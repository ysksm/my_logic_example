import { useLayoutEffect, useRef } from "react";
import type { Part, Point } from "../types";
import type { DialogGuard } from "../strategies";
import { useGhostClickGuard } from "../hooks/useGhostClickGuard";
import { ClickShield } from "./ClickShield";
import { pushNote } from "../lib/eventLog";

/** 「削除」ボタンのサイズ。指の真下にボタンが来るようにダイアログ位置を決める */
const BTN_W = 96;
const BTN_H = 44;
const DIALOG_W = 220;
const DIALOG_H = 120;

interface Props {
  part: Part;
  /** タップした viewport 座標。ここに「削除」ボタンの中心を合わせる */
  anchor: Point;
  guard: DialogGuard;
  onDelete: (part: Part) => void;
  onClose: () => void;
}

/**
 * タップ位置に現れるコンテキストメニュー風の <dialog>。
 * 実務では「タップ位置にポップオーバー」「画面中央のモーダルでたまたまボタンが指の下」
 * のどちらでも同じ問題が起きる。ここでは再現を確実にするため前者にしている。
 */
export function PartDialog({ part, anchor, guard, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  useGhostClickGuard(ref, guard === "timeGuard", {
    onBlocked: (e) => pushNote(`🛡 time-guard が click をブロック (${describe(e)})`),
  });

  const left = clamp(anchor.x - BTN_W / 2, 0, window.innerWidth - DIALOG_W);
  const top = clamp(anchor.y - BTN_H / 2, 0, window.innerHeight - DIALOG_H);

  return (
    <dialog
      ref={ref}
      data-log="dialog"
      data-testid="part-dialog"
      className="part-dialog"
      style={{ left, top, width: DIALOG_W }}
      onClose={onClose}
    >
      {guard === "shield" && (
        <ClickShield onSwallow={() => pushNote("🛡 shield が click を吸収")} />
      )}
      <div className="part-dialog__buttons">
        <button
          type="button"
          data-log="dialog-delete"
          data-testid="delete"
          className="danger"
          style={{ width: BTN_W, height: BTN_H }}
          onClick={() => onDelete(part)}
        >
          削除
        </button>
        <button
          type="button"
          data-log="dialog-cancel"
          data-testid="cancel"
          style={{ height: BTN_H }}
          onClick={() => ref.current?.close()}
        >
          キャンセル
        </button>
      </div>
      <p className="part-dialog__caption">パーツ {part.name} を操作します</p>
    </dialog>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function describe(e: MouseEvent) {
  const t = e.target;
  return t instanceof Element ? (t.getAttribute("data-log") ?? t.tagName.toLowerCase()) : "?";
}
