import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { PlainNodeData } from '../../domain/valueObjects/NodeData';
import { PollingStatus } from '../../domain/services/IPollingService';

/**
 * Redux Store - ノードデータのスライス
 *
 * Reduxパターンでは、ポーリングで取得したデータをRedux Storeに保存し、
 * コンポーネントがuseSelectorでデータを取得する。
 * これにより、複数のコンポーネント間でデータを共有できる。
 */

interface NodeDataState {
  /** 最新のノードデータ（nodeIdをキーとするマップ） */
  latestData: Record<string, PlainNodeData>;
  /** データ取得履歴（最新N件） */
  history: PlainNodeData[];
  /** ポーリングステータス */
  pollingStatus: PollingStatus;
  /** エラーメッセージ */
  error: string | null;
  /** ポーリング回数 */
  pollCount: number;
  /** 最終更新時刻 */
  lastUpdated: string | null;
}

const initialState: NodeDataState = {
  latestData: {},
  history: [],
  pollingStatus: 'idle',
  error: null,
  pollCount: 0,
  lastUpdated: null,
};

const MAX_HISTORY = 100;

const nodeDataSlice = createSlice({
  name: 'nodeData',
  initialState,
  reducers: {
    /** ポーリングで取得したデータを保存 */
    setNodeData(state, action: PayloadAction<PlainNodeData[]>) {
      const dataList = action.payload;

      for (const data of dataList) {
        state.latestData[data.nodeId] = data;
      }

      // 履歴に追加（最大件数を超えたら古いものから削除）
      state.history = [...state.history, ...dataList].slice(-MAX_HISTORY);
      state.pollCount += 1;
      state.lastUpdated = new Date().toISOString();
      state.error = null;
    },

    /** ポーリングステータスを更新 */
    setPollingStatus(state, action: PayloadAction<PollingStatus>) {
      state.pollingStatus = action.payload;
    },

    /** エラーを設定 */
    setError(state, action: PayloadAction<string>) {
      state.error = action.payload;
    },

    /** 状態をリセット */
    resetState() {
      return initialState;
    },
  },
});

export const { setNodeData, setPollingStatus, setError, resetState } =
  nodeDataSlice.actions;

export default nodeDataSlice.reducer;
