import { useEffect, useState } from "react";
import { SHIELD_TIMEOUT_MS } from "../strategies";

/**
 * 対策 6: 最初の click を吸収して消える透明な全画面要素。
 *
 * <dialog>.showModal() は top layer に載るため、通常の z-index では
 * その上に要素を置けない。したがってこのシールドは dialog の *子* として描画し、
 * position: fixed で viewport 全体を覆う。
 */
export function ClickShield({
  timeoutMs = SHIELD_TIMEOUT_MS,
  onSwallow,
}: {
  timeoutMs?: number;
  onSwallow?: () => void;
}) {
  const [active, setActive] = useState(true);

  useEffect(() => {
    const id = window.setTimeout(() => setActive(false), timeoutMs);
    return () => window.clearTimeout(id);
  }, [timeoutMs]);

  if (!active) return null;
  return (
    <div
      className="click-shield"
      data-log="shield"
      data-testid="click-shield"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onSwallow?.();
        setActive(false);
      }}
    />
  );
}
