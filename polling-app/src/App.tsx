import React, { useState } from 'react';
import { Provider } from 'react-redux';
import { store } from './presentation/store/store';
import { NoReduxPage } from './presentation/pages/NoReduxPage';
import { ReduxPage } from './presentation/pages/ReduxPage';

type Tab = 'no-redux' | 'redux';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('no-redux');

  return (
    <Provider store={store}>
      <div style={styles.app}>
        <header style={styles.header}>
          <h1 style={styles.title}>Polling Timer Patterns</h1>
          <p style={styles.subtitle}>
            DDD + レイヤードアーキテクチャ + DI/DIP によるポーリングパターン学習アプリ
          </p>
        </header>

        <nav style={styles.nav}>
          <button
            onClick={() => setActiveTab('no-redux')}
            style={{
              ...styles.tab,
              ...(activeTab === 'no-redux' ? styles.activeTab : {}),
            }}
          >
            Redux不使用パターン
          </button>
          <button
            onClick={() => setActiveTab('redux')}
            style={{
              ...styles.tab,
              ...(activeTab === 'redux' ? styles.activeTab : {}),
            }}
          >
            Redux使用パターン
          </button>
        </nav>

        <main style={styles.main}>
          {activeTab === 'no-redux' && <NoReduxPage />}
          {activeTab === 'redux' && <ReduxPage />}
        </main>

        <footer style={styles.footer}>
          <div style={styles.architecture}>
            <h3>アーキテクチャ構成</h3>
            <pre style={styles.pre}>{`
polling-app/src/
├── domain/               # ドメイン層（ビジネスロジックの核心）
│   ├── entities/         #   エンティティ (Node)
│   ├── valueObjects/     #   値オブジェクト (NodeData, PollingConfig)
│   ├── repositories/     #   リポジトリインターフェース (DIP)
│   └── services/         #   サービスインターフェース (DIP)
├── application/          # アプリケーション層（ユースケース）
│   ├── usecases/         #   PollingUseCase
│   └── di/               #   DIコンテナ
├── infrastructure/       # インフラ層（技術的実装）
│   ├── repositories/     #   MockNodeRepository
│   ├── polling/          #   4つのポーリング戦略
│   │   ├── SetIntervalPollingService      # パターン1: setInterval
│   │   ├── SetTimeoutPollingService       # パターン2: setTimeout再帰
│   │   ├── WebWorkerIntervalPollingService # パターン3: Worker+setInterval
│   │   └── WebWorkerTimeoutPollingService  # パターン4: Worker+setTimeout
│   └── workers/          #   Web Workerファイル
└── presentation/         # プレゼンテーション層（UI）
    ├── components/       #   共通コンポーネント
    ├── hooks/            #   usePolling, usePollingWithRedux
    ├── pages/            #   NoReduxPage, ReduxPage
    └── store/            #   Redux Store
`}</pre>
          </div>
        </footer>
      </div>
    </Provider>
  );
};

const styles: Record<string, React.CSSProperties> = {
  app: {
    maxWidth: '1200px',
    margin: '0 auto',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    textAlign: 'center' as const,
    padding: '24px',
    borderBottom: '1px solid #e0e0e0',
  },
  title: {
    fontSize: '28px',
    margin: '0 0 8px',
  },
  subtitle: {
    color: '#666',
    fontSize: '14px',
    margin: 0,
  },
  nav: {
    display: 'flex',
    borderBottom: '2px solid #e0e0e0',
  },
  tab: {
    flex: 1,
    padding: '12px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#666',
    borderBottom: '3px solid transparent',
    transition: 'all 0.2s',
  },
  activeTab: {
    color: '#2196f3',
    borderBottomColor: '#2196f3',
  },
  main: {
    minHeight: '500px',
  },
  footer: {
    borderTop: '1px solid #e0e0e0',
    padding: '24px',
    marginTop: '24px',
  },
  architecture: {
    fontSize: '14px',
  },
  pre: {
    backgroundColor: '#f5f5f5',
    padding: '16px',
    borderRadius: '8px',
    overflow: 'auto',
    fontSize: '12px',
    lineHeight: '1.5',
  },
};

export default App;
