import React from 'react';
import {
  PollingStrategy,
  STRATEGY_DESCRIPTIONS,
} from '../../application/di/Container';

interface StrategySelectorProps {
  current: PollingStrategy;
  onChange: (strategy: PollingStrategy) => void;
  disabled?: boolean;
}

/**
 * ポーリング戦略を選択するコンポーネント
 */
export const StrategySelector: React.FC<StrategySelectorProps> = ({
  current,
  onChange,
  disabled = false,
}) => {
  const strategies = Object.entries(STRATEGY_DESCRIPTIONS) as [
    PollingStrategy,
    { name: string; description: string }
  ][];

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>ポーリング戦略</h3>
      <div style={styles.grid}>
        {strategies.map(([key, { name, description }]) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            disabled={disabled}
            style={{
              ...styles.card,
              ...(current === key ? styles.selected : {}),
              ...(disabled ? styles.disabled : {}),
            }}
          >
            <div style={styles.name}>{name}</div>
            <div style={styles.description}>{description}</div>
          </button>
        ))}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginBottom: '16px',
  },
  title: {
    marginBottom: '12px',
    fontSize: '16px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '8px',
  },
  card: {
    textAlign: 'left' as const,
    padding: '12px',
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    backgroundColor: 'white',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  selected: {
    borderColor: '#2196f3',
    backgroundColor: '#e3f2fd',
  },
  disabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  name: {
    fontWeight: 'bold',
    fontSize: '14px',
    marginBottom: '4px',
  },
  description: {
    fontSize: '12px',
    color: '#666',
    lineHeight: '1.4',
  },
};
