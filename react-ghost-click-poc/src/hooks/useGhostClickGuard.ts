import { useLayoutEffect, type RefObject } from "react";
import { TIME_GUARD_MS } from "../strategies";

/**
 * 対策 5: 要素がマウントされてから一定時間内の click を無視する。
 *
 * capture 段階のネイティブリスナーで stopPropagation するので、
 * React の onClick (root で bubble を待ち受けている) には届かない。
 * ダイアログ / ポップオーバーの共通コンポーネントに 1 行足すだけで済むのが利点。
 */
export function useGhostClickGuard(
  ref: RefObject<HTMLElement>,
  enabled: boolean,
  options: { windowMs?: number; onBlocked?: (e: MouseEvent) => void } = {},
) {
  const { windowMs = TIME_GUARD_MS, onBlocked } = options;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;

    const openedAt = performance.now();
    const handler = (e: MouseEvent) => {
      if (performance.now() - openedAt >= windowMs) return;
      e.stopPropagation();
      e.preventDefault();
      onBlocked?.(e);
    };
    el.addEventListener("click", handler, true);
    return () => el.removeEventListener("click", handler, true);
    // onBlocked は最新のものを使いたいわけではないので依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, enabled, windowMs]);
}
