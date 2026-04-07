import React from 'react';
import { PlainNodeData } from '../../domain/valueObjects/NodeData';

interface PollingHistoryProps {
  history: PlainNodeData[] | Array<{ nodeId: string; value: number; status: string; timestamp: string | Date }>;
  maxItems?: number;
}

/**
 * ポーリング履歴を表示するコンポーネント
 */
export const PollingHistory: React.FC<PollingHistoryProps> = ({
  history,
  maxItems = 30,
}) => {
  const recentHistory = history.slice(-maxItems).reverse();

  if (recentHistory.length === 0) {
    return null;
  }

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>取得履歴 (最新{maxItems}件)</h3>
      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>時刻</th>
              <th style={styles.th}>ノード</th>
              <th style={styles.th}>値</th>
              <th style={styles.th}>ステータス</th>
            </tr>
          </thead>
          <tbody>
            {recentHistory.map((item, index) => {
              const timestamp =
                typeof item.timestamp === 'string'
                  ? item.timestamp
                  : (item.timestamp as Date).toISOString();

              return (
                <tr key={`${item.nodeId}-${timestamp}-${index}`}>
                  <td style={styles.td}>
                    {new Date(timestamp).toLocaleTimeString('ja-JP')}
                  </td>
                  <td style={styles.td}>{item.nodeId}</td>
                  <td style={styles.td}>{item.value}</td>
                  <td style={styles.td}>
                    <span
                      style={{
                        ...styles.statusBadge,
                        backgroundColor: statusColor(item.status),
                      }}
                    >
                      {item.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

function statusColor(status: string): string {
  switch (status) {
    case 'online':
      return '#4caf50';
    case 'offline':
      return '#ff9800';
    case 'error':
      return '#f44336';
    default:
      return '#888';
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginTop: '16px',
  },
  title: {
    fontSize: '16px',
    marginBottom: '8px',
  },
  tableWrapper: {
    maxHeight: '300px',
    overflow: 'auto',
    borderRadius: '8px',
    border: '1px solid #e0e0e0',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '13px',
  },
  th: {
    position: 'sticky' as const,
    top: 0,
    backgroundColor: '#f5f5f5',
    padding: '8px 12px',
    textAlign: 'left' as const,
    borderBottom: '2px solid #ddd',
    fontWeight: 'bold',
  },
  td: {
    padding: '6px 12px',
    borderBottom: '1px solid #eee',
  },
  statusBadge: {
    color: 'white',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '11px',
  },
};
