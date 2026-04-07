/**
 * Web Worker: setInterval ベースのポーリングワーカー
 *
 * Worker内でsetIntervalを使用してポーリングを行う。
 * メインスレッドとはpostMessage/onmessageで通信する。
 */

/* eslint-disable no-restricted-globals */

interface WorkerState {
  timerId: ReturnType<typeof setInterval> | null;
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

/** モックデータ生成（Worker内ではDOMやモジュールが使えないため直接生成） */
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

function poll() {
  if (!state.isRunning) return;

  try {
    // Worker内でフェッチをシミュレート（実際のアプリではfetchを使用可能）
    const data = generateMockData(state.nodeIds);
    self.postMessage({ type: 'data', data });
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

function startPolling() {
  stopPolling();
  state.isRunning = true;
  poll(); // 初回即時実行
  state.timerId = setInterval(poll, state.intervalMs);
  self.postMessage({ type: 'status', data: 'running' });
}

function stopPolling() {
  if (state.timerId !== null) {
    clearInterval(state.timerId);
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
      if (state.timerId !== null) {
        clearInterval(state.timerId);
        state.timerId = null;
      }
      state.isRunning = false;
      self.postMessage({ type: 'status', data: 'paused' });
      break;

    case 'resume':
      state.isRunning = true;
      poll();
      state.timerId = setInterval(poll, state.intervalMs);
      self.postMessage({ type: 'status', data: 'running' });
      break;

    case 'setInterval':
      state.intervalMs = intervalMs;
      if (state.isRunning) {
        // 再起動して新しいインターバルを適用
        if (state.timerId !== null) {
          clearInterval(state.timerId);
        }
        state.timerId = setInterval(poll, state.intervalMs);
      }
      break;
  }
};

export {};
