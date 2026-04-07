import React, { useState } from 'react';
import { PollingStrategy } from '../../application/di/Container';
import { usePolling } from '../hooks/usePolling';
import { PollingControls } from '../components/PollingControls';
import { NodeDataGrid } from '../components/NodeDataGrid';
import { StrategySelector } from '../components/StrategySelector';
import { PollingHistory } from '../components/PollingHistory';

/**
 * Redux不使用ページ
 *
 * usePollingフックでローカルstateを使ってデータを管理する。
 * 単純なユースケースやコンポーネント単位でのデータ管理に最適。
 */
export const NoReduxPage: React.FC = () => {
  const [strategy, setStrategy] = useState<PollingStrategy>('setInterval');
  const polling = usePolling(strategy);

  const handleStrategyChange = (newStrategy: PollingStrategy) => {
    polling.reset();
    setStrategy(newStrategy);
  };

  // NodeDataオブジェクトをPlain形式に変換して表示
  const plainData: Record<string, { nodeId: string; value: number; status: string; timestamp: string; metadata: Record<string, unknown> }> = {};
  for (const [key, nd] of Object.entries(polling.latestData)) {
    plainData[key] = {
      nodeId: nd.nodeId,
      value: nd.value,
      status: nd.status,
      timestamp: nd.timestamp.toISOString(),
      metadata: nd.metadata,
    };
  }

  const plainHistory = polling.history.map((nd) => ({
    nodeId: nd.nodeId,
    value: nd.value,
    status: nd.status,
    timestamp: nd.timestamp.toISOString(),
    metadata: nd.metadata,
  }));

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h2 style={styles.heading}>Redux不使用パターン</h2>
        <p style={styles.desc}>
          usePollingフックでローカルstateを使用。データはコンポーネント内で管理される。
        </p>
      </div>

      <StrategySelector
        current={strategy}
        onChange={handleStrategyChange}
        disabled={polling.status === 'running'}
      />

      <PollingControls
        status={polling.status}
        pollCount={polling.pollCount}
        onStart={polling.start}
        onStop={polling.stop}
        onPause={polling.pause}
        onResume={polling.resume}
        onChangeInterval={polling.changeInterval}
        onReset={polling.reset}
      />

      {polling.error && (
        <div style={styles.error}>Error: {polling.error}</div>
      )}

      <NodeDataGrid data={plainData} title="ノードデータ (リアルタイム)" />

      <PollingHistory history={plainHistory} />
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: '24px',
  },
  header: {
    marginBottom: '16px',
  },
  heading: {
    fontSize: '20px',
    marginBottom: '4px',
  },
  desc: {
    color: '#666',
    fontSize: '14px',
  },
  error: {
    backgroundColor: '#ffebee',
    color: '#c62828',
    padding: '8px 16px',
    borderRadius: '4px',
    marginBottom: '12px',
    fontSize: '14px',
  },
};
