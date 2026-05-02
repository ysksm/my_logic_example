import type { Run } from "../types";

interface Props {
  run: Run | null;
  onStop: () => void;
  onClose: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  generating: "ファイル生成中…",
  installing: "npm install 実行中… (初回は数十秒)",
  starting: "Vite dev server 起動中…",
  ready: "起動完了 ✅",
  stopped: "停止しました",
  error: "エラー",
};

const STATUS_COLOR: Record<string, string> = {
  generating: "#3b82f6",
  installing: "#f59e0b",
  starting: "#f59e0b",
  ready: "#16a34a",
  stopped: "#6b7280",
  error: "#dc2626",
};

export function RunPanel({ run, onStop, onClose }: Props) {
  if (!run) return null;
  const statusColor = STATUS_COLOR[run.status] ?? "#6b7280";
  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        width: 360,
        background: "#fff",
        border: "1px solid #d1d5db",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        zIndex: 1000,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          background: "#111827",
          color: "#f9fafb",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <strong>🚀 生成 → 実行: {run.domainId}</strong>
        <button
          onClick={onClose}
          style={{ background: "transparent", color: "#f9fafb", border: 0, cursor: "pointer", fontSize: 16 }}
        >
          ×
        </button>
      </div>
      <div style={{ padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: statusColor,
            }}
          />
          <strong>{STATUS_LABEL[run.status] ?? run.status}</strong>
        </div>
        {run.error && (
          <pre
            style={{
              background: "#fef2f2",
              color: "#991b1b",
              padding: 8,
              borderRadius: 4,
              fontSize: 11,
              whiteSpace: "pre-wrap",
            }}
          >
            {run.error}
          </pre>
        )}
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
          <div>
            <strong>folder:</strong>{" "}
            <code style={{ fontSize: 11 }}>{run.path}</code>
          </div>
          {run.url && run.status === "ready" && (
            <div>
              <strong>url:</strong>{" "}
              <a href={run.url} target="_blank" rel="noreferrer">
                {run.url}
              </a>
            </div>
          )}
          {run.logPath && (
            <div>
              <strong>log:</strong>{" "}
              <code style={{ fontSize: 11 }}>{run.logPath}</code>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {run.status === "ready" && run.url && (
            <a
              href={run.url}
              target="_blank"
              rel="noreferrer"
              style={{
                background: "#16a34a",
                color: "#fff",
                padding: "6px 12px",
                borderRadius: 4,
                textDecoration: "none",
                fontSize: 13,
              }}
            >
              ↗ 新しいタブで開く
            </a>
          )}
          {(run.status === "ready" || run.status === "starting" || run.status === "installing") && (
            <button
              onClick={onStop}
              style={{
                background: "#6b7280",
                color: "#fff",
                border: 0,
                padding: "6px 12px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              ◼ 停止
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
