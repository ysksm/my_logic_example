/**
 * Web Worker: setTimeout 再帰ベースのポーリングワーカー
 *
 * Worker内でsetTimeout再帰パターンを使用。
 * データ取得完了後に次のタイマーを設定するため、リクエストが重複しない。
 */

/* eslint-disable no-restricted-globals */

interface WorkerState {
  timerId: ReturnType<typeof setTimeout> | null;
  nodeIds: string[];
  intervalMs: number;
  isRunning: boolean;
}

const state: WorkerState = {
  timerId: null,
  nodeIds: [],
  intervalMs: 3000,
  isRunning: false,
};

/** モックデータ生成 */
function generateMockData(nodeIds: string[]) {
  return nodeIds.map((nodeId) => {
    const rand = Math.random();
    const status = rand < 0.8 ? 'online' : rand < 0.95 ? 'offline' : 'error';
    return {
      nodeId,
      value: Math.round(Math.random() * 100 * 10) / 10,
      status,
      timestamp: new Date().toISOString(),
      metadata: {
        cpu: Math.round(Math.random() * 100),
        memory: Math.round(Math.random() * 100),
        latency: Math.round(Math.random() * 500),
      },
    };
  });
}

/** ネットワーク遅延をシミュレート */
function simulateDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll() {
  if (!state.isRunning) return;

  try {
    // ネットワーク遅延をシミュレート
    await simulateDelay(50 + Math.random() * 200);

    if (!state.isRunning) return;

    const data = generateMockData(state.nodeIds);
    self.postMessage({ type: 'data', data });
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  // 完了後に次のポーリングをスケジュール（setTimeout再帰の核心部分）
  scheduleNext();
}

function scheduleNext() {
  if (!state.isRunning) return;
  state.timerId = setTimeout(poll, state.intervalMs);
}

function startPolling() {
  stopPolling();
  state.isRunning = true;
  self.postMessage({ type: 'status', data: 'running' });
  // 初回は即時実行
  state.timerId = setTimeout(poll, 0);
}

function stopPolling() {
  if (state.timerId !== null) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }
  state.isRunning = false;
}

self.onmessage = (event: MessageEvent) => {
  const { command, nodeIds, intervalMs } = event.data;

  switch (command) {
    case 'start':
      state.nodeIds = nodeIds;
      state.intervalMs = intervalMs;
      startPolling();
      break;

    case 'stop':
      stopPolling();
      self.postMessage({ type: 'status', data: 'stopped' });
      break;

    case 'pause':
      stopPolling();
      self.postMessage({ type: 'status', data: 'paused' });
      break;

    case 'resume':
      state.isRunning = true;
      self.postMessage({ type: 'status', data: 'running' });
      scheduleNext();
      break;

    case 'setInterval':
      state.intervalMs = intervalMs;
      // 次回スケジュールから新しいインターバルが自動適用される
      break;
  }
};

export {};
