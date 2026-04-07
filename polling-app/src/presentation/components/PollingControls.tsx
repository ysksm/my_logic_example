import React, { useState } from 'react';
import { PollingStatus } from '../../domain/services/IPollingService';

interface PollingControlsProps {
  status: PollingStatus;
  pollCount: number;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onChangeInterval: (ms: number) => void;
  onReset: () => void;
}

/**
 * ポーリング制御コンポーネント
 * 開始/停止/一時停止/再開/インターバル変更のUIを提供
 */
export const PollingControls: React.FC<PollingControlsProps> = ({
  status,
  pollCount,
  onStart,
  onStop,
  onPause,
  onResume,
  onChangeInterval,
  onReset,
}) => {
  const [interval, setInterval] = useState(3000);

  const statusColors: Record<PollingStatus, string> = {
    idle: '#888',
    running: '#4caf50',
    paused: '#ff9800',
    stopped: '#f44336',
  };

  const statusLabels: Record<PollingStatus, string> = {
    idle: '待機中',
    running: '実行中',
    paused: '一時停止',
    stopped: '停止',
  };

  return (
    <div style={styles.container}>
      <div style={styles.statusRow}>
        <span
          style={{
            ...styles.statusBadge,
            backgroundColor: statusColors[status],
          }}
        >
          {statusLabels[status]}
        </span>
        <span style={styles.pollCount}>ポーリング回数: {pollCount}</span>
      </div>

      <div style={styles.buttonRow}>
        <button
          onClick={onStart}
          disabled={status === 'running'}
          style={{
            ...styles.button,
            backgroundColor: status === 'running' ? '#ccc' : '#4caf50',
          }}
        >
          開始
        </button>
        <button
          onClick={onPause}
          disabled={status !== 'running'}
          style={{
            ...styles.button,
            backgroundColor: status !== 'running' ? '#ccc' : '#ff9800',
          }}
        >
          一時停止
        </button>
        <button
          onClick={onResume}
          disabled={status !== 'paused'}
          style={{
            ...styles.button,
            backgroundColor: status !== 'paused' ? '#ccc' : '#2196f3',
          }}
        >
          再開
        </button>
        <button
          onClick={onStop}
          disabled={status === 'idle' || status === 'stopped'}
          style={{
            ...styles.button,
            backgroundColor:
              status === 'idle' || status === 'stopped' ? '#ccc' : '#f44336',
          }}
        >
          停止
        </button>
        <button onClick={onReset} style={styles.resetButton}>
          リセット
        </button>
      </div>

      <div style={styles.intervalRow}>
        <label style={styles.label}>インターバル:</label>
        <input
          type="range"
          min={500}
          max={10000}
          step={500}
          value={interval}
          onChange={(e) => {
            const val = Number(e.target.value);
            setInterval(val);
            onChangeInterval(val);
          }}
          style={styles.slider}
        />
        <span style={styles.intervalValue}>{interval}ms</span>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '16px',
    backgroundColor: '#f5f5f5',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '12px',
  },
  statusBadge: {
    color: 'white',
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  pollCount: {
    fontSize: '14px',
    color: '#666',
  },
  buttonRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px',
    flexWrap: 'wrap' as const,
  },
  button: {
    color: 'white',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  resetButton: {
    color: '#333',
    backgroundColor: '#e0e0e0',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  intervalRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  label: {
    fontSize: '14px',
    fontWeight: 'bold',
  },
  slider: {
    flex: 1,
  },
  intervalValue: {
    fontSize: '14px',
    minWidth: '60px',
    textAlign: 'right' as const,
  },
};
