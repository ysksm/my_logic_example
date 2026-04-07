import { useEffect, useRef, useCallback } from 'react';
import { PollingStatus } from '../../domain/services/IPollingService';
import { PollingConfig } from '../../domain/valueObjects/PollingConfig';
import { PollingUseCase } from '../../application/usecases/PollingUseCase';
import { Container, PollingStrategy } from '../../application/di/Container';
import { useAppDispatch, useAppSelector } from '../store/store';
import {
  setNodeData,
  setPollingStatus,
  setError,
  resetState,
} from '../store/nodeDataSlice';

/**
 * ポーリングフック（Redux使用パターン）
 *
 * データをRedux Storeに保存し、useSelectorでデータを取得する。
 * 複数コンポーネント間でのデータ共有に適している。
 */
export function usePollingWithRedux(
  strategy: PollingStrategy,
  intervalMs: number = 3000
) {
  const dispatch = useAppDispatch();
  const { latestData, history, pollingStatus, error, pollCount, lastUpdated } =
    useAppSelector((state) => state.nodeData);

  const useCaseRef = useRef<PollingUseCase | null>(null);
  const intervalRef = useRef(intervalMs);

  useEffect(() => {
    const useCase = Container.createPollingUseCase(strategy);
    useCaseRef.current = useCase;

    useCase.initialize();

    return () => {
      useCase.dispose();
      useCaseRef.current = null;
    };
  }, [strategy]);

  const start = useCallback(() => {
    const useCase = useCaseRef.current;
    if (!useCase) return;

    const config = new PollingConfig(intervalRef.current);

    useCase.startPolling(
      config,
      (dataList) => {
        // Redux storeにデータをdispatch
        dispatch(setNodeData(dataList.map((d) => d.toPlain())));
      },
      (err) => {
        dispatch(setError(err.message));
      }
    );
    dispatch(setPollingStatus('running'));
  }, [dispatch]);

  const stop = useCallback(() => {
    useCaseRef.current?.stopPolling();
    dispatch(setPollingStatus('stopped'));
  }, [dispatch]);

  const pause = useCallback(() => {
    useCaseRef.current?.pausePolling();
    dispatch(setPollingStatus('paused'));
  }, [dispatch]);

  const resume = useCallback(() => {
    useCaseRef.current?.resumePolling();
    dispatch(setPollingStatus('running'));
  }, [dispatch]);

  const changeInterval = useCallback((newInterval: number) => {
    intervalRef.current = newInterval;
    useCaseRef.current?.setInterval(newInterval);
  }, []);

  const reset = useCallback(() => {
    useCaseRef.current?.stopPolling();
    dispatch(resetState());
  }, [dispatch]);

  return {
    latestData,
    history,
    status: pollingStatus,
    error,
    pollCount,
    lastUpdated,
    start,
    stop,
    pause,
    resume,
    changeInterval,
    reset,
  };
}
