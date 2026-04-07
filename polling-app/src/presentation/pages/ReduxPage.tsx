import React, { useState } from 'react';
import { PollingStrategy } from '../../application/di/Container';
import { usePollingWithRedux } from '../hooks/usePollingWithRedux';
import { PollingControls } from '../components/PollingControls';
import { NodeDataGrid } from '../components/NodeDataGrid';
import { StrategySelector } from '../components/StrategySelector';
import { PollingHistory } from '../components/PollingHistory';

/**
 * Redux使用ページ
 *
 * usePollingWithReduxフックでRedux Storeを使ってデータを管理する。
 * 複数コンポーネント間でのデータ共有や、DevToolsでの状態確認に最適。
 */
export const ReduxPage: React.FC = () => {
  const [strategy, setStrategy] = useState<PollingStrategy>('setTimeout');
  const polling = usePollingWithRedux(strategy);

  const handleStrategyChange = (newStrategy: PollingStrategy) => {
    polling.reset();
    setStrategy(newStrategy);
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h2 style={styles.heading}>Redux使用パターン</h2>
        <p style={styles.desc}>
          usePollingWithReduxフックでRedux Storeを使用。
          データはRedux DevToolsで確認可能。複数コンポーネント間でデータ共有可能。
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

      {polling.lastUpdated && (
        <div style={styles.lastUpdated}>
          最終更新: {new Date(polling.lastUpdated).toLocaleTimeString('ja-JP')}
        </div>
      )}

      <NodeDataGrid data={polling.latestData} title="ノードデータ (リアルタイム - Redux Store)" />

      <PollingHistory history={polling.history} />
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
  lastUpdated: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '12px',
  },
};
