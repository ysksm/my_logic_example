import React from 'react';
import { PlainNodeData } from '../../domain/valueObjects/NodeData';

interface NodeDataGridProps {
  data: Record<string, PlainNodeData> | Record<string, { nodeId: string; value: number; status: string; timestamp: string | Date; metadata: Record<string, unknown> }>;
  title?: string;
}

/**
 * ノードデータをグリッド表示するコンポーネント
 */
export const NodeDataGrid: React.FC<NodeDataGridProps> = ({ data, title }) => {
  const entries = Object.values(data);

  if (entries.length === 0) {
    return (
      <div style={styles.empty}>
        {title && <h3 style={styles.title}>{title}</h3>}
        <p style={styles.emptyText}>データがありません。ポーリングを開始してください。</p>
      </div>
    );
  }

  return (
    <div>
      {title && <h3 style={styles.title}>{title}</h3>}
      <div style={styles.grid}>
        {entries.map((item) => {
          const meta = item.metadata as { cpu?: number; memory?: number; latency?: number };
          const timestamp =
            typeof item.timestamp === 'string'
              ? item.timestamp
              : (item.timestamp as Date).toISOString();

          return (
            <div
              key={item.nodeId}
              style={{
                ...styles.card,
                borderLeftColor: statusColor(item.status as string),
              }}
            >
              <div style={styles.cardHeader}>
                <span style={styles.nodeId}>{item.nodeId}</span>
                <span
                  style={{
                    ...styles.status,
                    backgroundColor: statusColor(item.status as string),
                  }}
                >
                  {item.status}
                </span>
              </div>
              <div style={styles.value}>{item.value}</div>
              <div style={styles.meta}>
                <span>CPU: {meta.cpu ?? '-'}%</span>
                <span>Mem: {meta.memory ?? '-'}%</span>
                <span>Lat: {meta.latency ?? '-'}ms</span>
              </div>
              <div style={styles.timestamp}>
                {new Date(timestamp).toLocaleTimeString('ja-JP')}
              </div>
            </div>
          );
        })}
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
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '12px',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '16px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    borderLeft: '4px solid',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  nodeId: {
    fontWeight: 'bold',
    fontSize: '14px',
  },
  status: {
    color: 'white',
    padding: '2px 8px',
    borderRadius: '8px',
    fontSize: '12px',
  },
  value: {
    fontSize: '28px',
    fontWeight: 'bold',
    marginBottom: '8px',
    textAlign: 'center' as const,
  },
  meta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: '#666',
    marginBottom: '4px',
  },
  timestamp: {
    fontSize: '11px',
    color: '#999',
    textAlign: 'right' as const,
  },
  title: {
    marginBottom: '12px',
    fontSize: '16px',
  },
  empty: {
    textAlign: 'center' as const,
    padding: '32px',
  },
  emptyText: {
    color: '#888',
  },
};
