import { useMemo, useState } from "react";
import { api } from "../api/client";
import { useFetch } from "../api/useFetch";
import type { HeatmapCell, HeatmapLayer } from "../api/types";
import { corrColor, corrTextColor } from "../lib/corrColor";
import { formatCorr } from "../lib/format";
import { ErrorBanner } from "./ErrorBanner";
import { Loading } from "./Loading";

const WINDOWS = [20, 60, 120];
const LAGS = [-1, 0, 1];

function lagLabel(lag: number): string {
  if (lag === 0) return "同日 (lag 0)";
  return lag > 0 ? `米国が翌日 (lag +${lag})` : `米国が前日 (lag ${lag})`;
}

interface MatrixProps {
  layer: HeatmapLayer;
}

/** 1 レイヤー分のアジア/欧州(行) × 米国(列) マトリクス */
function LayerMatrix({ layer }: MatrixProps) {
  const { rows, cols, cellMap } = useMemo(() => {
    const rows: { symbol: string; name: string }[] = [];
    const cols: { symbol: string; name: string }[] = [];
    const cellMap = new Map<string, HeatmapCell>();
    for (const cell of layer.cells) {
      if (!rows.some((r) => r.symbol === cell.asia)) {
        rows.push({ symbol: cell.asia, name: cell.asia_name });
      }
      if (!cols.some((c) => c.symbol === cell.us)) {
        cols.push({ symbol: cell.us, name: cell.us_name });
      }
      cellMap.set(`${cell.asia}|${cell.us}`, cell);
    }
    return { rows, cols, cellMap };
  }, [layer]);

  return (
    <section className="card">
      <h3>
        {layer.layer_id}: {layer.layer_name}
      </h3>
      <div className="table-scroll">
        <table className="heatmap-table">
          <thead>
            <tr>
              <th className="rowhead">アジア/欧州 ＼ 米国</th>
              {cols.map((c) => (
                <th key={c.symbol} title={c.name}>
                  {c.symbol}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol}>
                <th className="rowhead" title={r.name}>
                  {r.symbol}
                  <span className="sub">{r.name}</span>
                </th>
                {cols.map((c) => {
                  const cell = cellMap.get(`${r.symbol}|${c.symbol}`);
                  const corr = cell?.corr ?? null;
                  return (
                    <td
                      key={c.symbol}
                      className="heat-cell"
                      style={{
                        background: corrColor(corr),
                        color: corrTextColor(corr),
                      }}
                      title={
                        cell
                          ? `${cell.asia_name} × ${cell.us_name}\n相関: ${formatCorr(corr)} / n=${cell.n}`
                          : "データなし"
                      }
                    >
                      {formatCorr(corr)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function HeatmapView() {
  const [window, setWindow] = useState(120);
  const [lag, setLag] = useState(0);
  const { data, loading, error } = useFetch(
    () => api.heatmap(window, lag),
    [window, lag],
  );

  return (
    <div>
      <div className="controls">
        <div className="control-group">
          <span className="control-label">窓 (営業日):</span>
          {WINDOWS.map((w) => (
            <button
              key={w}
              className={w === window ? "toggle active" : "toggle"}
              onClick={() => setWindow(w)}
            >
              {w}日
            </button>
          ))}
        </div>
        <div className="control-group">
          <span className="control-label">ラグ:</span>
          {LAGS.map((l) => (
            <button
              key={l}
              className={l === lag ? "toggle active" : "toggle"}
              onClick={() => setLag(l)}
              title={lagLabel(l)}
            >
              {l > 0 ? `+${l}` : l}
            </button>
          ))}
        </div>
        <div className="legend">
          <span className="legend-chip" style={{ background: corrColor(-0.8) }} />
          負の相関
          <span className="legend-chip" style={{ background: corrColor(0) }} />0
          <span className="legend-chip" style={{ background: corrColor(0.8) }} />
          正の相関
          <span className="legend-chip" style={{ background: corrColor(null) }} />
          データ不足
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && <Loading />}
      {data && (
        <>
          <p className="muted">
            直近 {data.window} 営業日のリターン相関（{lagLabel(data.lag)}
            ）。セルにカーソルを合わせると銘柄名とサンプル数 n を表示します。
          </p>
          {data.layers.map((layer) => (
            <LayerMatrix key={layer.layer_id} layer={layer} />
          ))}
        </>
      )}
    </div>
  );
}
