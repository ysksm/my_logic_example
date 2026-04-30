import { useState } from "react";
import { useMaintenance } from "@/application/hooks/useMaintenance";
import type { TableDump } from "@/domain/types";

export default function MaintenancePage() {
  const m = useMaintenance();
  const [token, setToken] = useState("");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [dump, setDump] = useState<TableDump | null>(null);
  const [sql, setSql] = useState("SELECT * FROM tickets LIMIT 50");
  const [queryResult, setQueryResult] = useState<TableDump | null>(null);

  return (
    <>
      <h1>メンテナンス</h1>

      <div className="panel">
        <p>
          メンテナンスモードを有効化すると、DBのテーブル一覧の閲覧、テーブル全件 dump、任意 SQL の実行が
          可能になります。本番環境では <code>MAINTENANCE_TOKEN</code> 環境変数で保護してください。
        </p>
        <div className="row">
          <strong>状態:</strong>
          <span className={`badge ${m.enabled ? "done" : "todo"}`}>{m.enabled ? "ENABLED" : "DISABLED"}</span>
          {!m.enabled ? (
            <>
              <input placeholder="token (任意)" value={token} onChange={(e) => setToken(e.target.value)} />
              <button onClick={() => m.enable(token)}>有効化</button>
            </>
          ) : (
            <button className="danger" onClick={() => m.disable()}>解除</button>
          )}
        </div>
        {m.error && <p style={{ color: "red" }}>{m.error}</p>}
      </div>

      {m.enabled && (
        <>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>テーブル一覧</h3>
            <div className="row">
              {m.tables.map((t) => (
                <button
                  key={t}
                  className={selectedTable === t ? "" : "secondary"}
                  onClick={async () => {
                    setSelectedTable(t);
                    setDump(await m.dumpTable(t, 200));
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
            {dump && selectedTable && (
              <div style={{ marginTop: 12 }}>
                <h4>{selectedTable} ({dump.row_count} rows)</h4>
                <DumpTable dump={dump} />
              </div>
            )}
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>任意 SQL</h3>
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              style={{ width: "100%", minHeight: 100, fontFamily: "monospace" }}
            />
            <div style={{ marginTop: 8 }}>
              <button onClick={async () => setQueryResult(await m.runQuery(sql))}>実行</button>
            </div>
            {queryResult && (
              <div style={{ marginTop: 12 }}>
                <strong>{queryResult.row_count} rows</strong>
                <DumpTable dump={queryResult} />
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

function DumpTable({ dump }: { dump: TableDump }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            {dump.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dump.rows.map((row, i) => (
            <tr key={i}>
              {row.map((v, j) => (
                <td key={j}>
                  <code style={{ fontSize: 11 }}>
                    {v === null || v === undefined ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </code>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
