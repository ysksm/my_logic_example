import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { SampleInfo } from "../types";

interface Props {
  /** Called with the chosen sample id. The caller decides how to handle
   *  loading (fetch + setState, or load + persist + reload). */
  onLoad: (id: string, persist: boolean) => Promise<void>;
}

export function SampleMenu({ onLoad }: Props) {
  const [open, setOpen] = useState(false);
  const [samples, setSamples] = useState<SampleInfo[] | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && samples === null) {
      api.listSamples().then(setSamples).catch((e) => setError(String(e)));
    }
  }, [open, samples]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function pick(id: string, persist: boolean) {
    setLoading(id);
    setError(null);
    try {
      await onLoad(id, persist);
      setOpen(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        data-testid="sample-menu-button"
        onClick={() => setOpen(!open)}
        title="バンドルされたサンプルから読み込み"
      >
        📂 サンプル{open ? " ▴" : " ▾"}
      </button>
      {open && (
        <div
          data-testid="sample-menu"
          style={{
            position: "absolute",
            top: 32,
            left: 0,
            background: "#fff",
            color: "#1f2937",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            minWidth: 380,
            maxWidth: 480,
            zIndex: 1000,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "8px 12px",
              borderBottom: "1px solid #e5e7eb",
              background: "#f9fafb",
              fontSize: 11,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: 0.04,
            }}
          >
            バンドルされたサンプル
          </div>
          {error && (
            <div style={{ padding: 12, color: "#991b1b", fontSize: 12 }}>{error}</div>
          )}
          {samples === null && !error && (
            <div style={{ padding: 16, color: "#6b7280", fontSize: 12 }}>読み込み中…</div>
          )}
          {samples !== null && samples.length === 0 && (
            <div style={{ padding: 16, color: "#6b7280", fontSize: 12 }}>
              サンプルが見つかりません。
            </div>
          )}
          {samples?.map((s) => (
            <div
              key={s.id}
              data-testid={`sample-${s.id}`}
              style={{
                padding: "10px 12px",
                borderBottom: "1px solid #f3f4f6",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ fontSize: 13 }}>{s.name}</strong>
                <span style={{ fontSize: 11, color: "#6b7280" }}>
                  {s.aggregateCount} 集約
                </span>
              </div>
              {s.description && (
                <div
                  style={{
                    fontSize: 11,
                    color: "#4b5563",
                    marginTop: 4,
                    lineHeight: 1.45,
                  }}
                >
                  {s.description}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button
                  data-testid={`sample-${s.id}-load`}
                  onClick={() => pick(s.id, false)}
                  disabled={loading !== null}
                  style={{
                    background: "#3b82f6",
                    color: "#fff",
                    border: 0,
                    padding: "4px 10px",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  {loading === s.id ? "読込中…" : "編集に読込"}
                </button>
                <button
                  data-testid={`sample-${s.id}-load-save`}
                  onClick={() => pick(s.id, true)}
                  disabled={loading !== null}
                  title="サンプルを編集ペインに読み込み、サーバーにも保存します"
                  style={{
                    background: "#10b981",
                    color: "#fff",
                    border: 0,
                    padding: "4px 10px",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  読込 + 保存
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
