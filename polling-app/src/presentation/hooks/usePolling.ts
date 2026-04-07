import { useState, useEffect, useRef, useCallback } from 'react';
import { NodeData } from '../../domain/valueObjects/NodeData';
import { Node } from '../../domain/entities/Node';
import { PollingStatus } from '../../domain/services/IPollingService';
import { PollingConfig } from '../../domain/valueObjects/PollingConfig';
import { PollingUseCase } from '../../application/usecases/PollingUseCase';
import { Container, PollingStrategy } from '../../application/di/Container';

/**
 * ポーリングフック（Redux不使用パターン）
 *
 * ローカルstateでデータを管理する。
 * 単一コンポーネントやページ内でのデータ管理に適している。
 */
export function usePolling(strategy: PollingStrategy, intervalMs: number = 3000) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [latestData, setLatestData] = useState<Record<string, NodeData>>({});
  const [history, setHistory] = useState<NodeData[]>([]);
  const [status, setStatus] = useState<PollingStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  const useCaseRef = useRef<PollingUseCase | null>(null);
  const intervalRef = useRef(intervalMs);

  // strategyが変わったらuseCaseを再作成
  useEffect(() => {
    const useCase = Container.createPollingUseCase(strategy);
    useCaseRef.current = useCase;

    useCase.initialize().then((loadedNodes) => {
      setNodes(loadedNodes);
    });

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
        const dataMap: Record<string, NodeData> = {};
        for (const d of dataList) {
          dataMap[d.nodeId] = d;
        }
        setLatestData((prev) => ({ ...prev, ...dataMap }));
        setHistory((prev) => [...prev, ...dataList].slice(-100));
        setPollCount((c) => c + 1);
        setError(null);
      },
      (err) => {
        setError(err.message);
      }
    );
    setStatus('running');
  }, []);

  const stop = useCallback(() => {
    useCaseRef.current?.stopPolling();
    setStatus('stopped');
  }, []);

  const pause = useCallback(() => {
    useCaseRef.current?.pausePolling();
    setStatus('paused');
  }, []);

  const resume = useCallback(() => {
    useCaseRef.current?.resumePolling();
    setStatus('running');
  }, []);

  const changeInterval = useCallback((newInterval: number) => {
    intervalRef.current = newInterval;
    useCaseRef.current?.setInterval(newInterval);
  }, []);

  const reset = useCallback(() => {
    useCaseRef.current?.stopPolling();
    setLatestData({});
    setHistory([]);
    setStatus('idle');
    setError(null);
    setPollCount(0);
  }, []);

  return {
    nodes,
    latestData,
    history,
    status,
    error,
    pollCount,
    start,
    stop,
    pause,
    resume,
    changeInterval,
    reset,
  };
}
