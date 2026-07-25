import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type NodeTypes,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { ScreenNode } from "./components/ScreenNode";
import { PropertyPanel } from "./components/PropertyPanel";
import { sampleDocument } from "./sampleData";
import { loadDocument, saveDocument } from "./lib/storage";
import { computeLayout } from "./lib/layout";
import {
  documentToFlow,
  flowToDocument,
  mergeDocument,
  parseDocument,
  uid,
} from "./lib/serialization";
import {
  edgeDisplayLabel,
  type ScreenFlowNode,
  type ScreenNodeData,
  type TransitionEdgeData,
  type TransitionFlowEdge,
} from "./types";
import "./App.css";

const nodeTypes: NodeTypes = { screen: ScreenNode };

const defaultEdgeOptions = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
};

function initialFlow() {
  return documentToFlow(loadDocument() ?? sampleDocument);
}

export default function App() {
  const initial = useMemo(initialFlow, []);
  const [nodes, setNodes, onNodesChange] = useNodesState<ScreenFlowNode>(
    initial.nodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<TransitionFlowEdge>(
    initial.edges,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importModeRef = useRef<"replace" | "merge">("replace");

  // 変更を localStorage へ自動保存 (ドラッグ中の連続保存を防ぐため少し遅延)
  useEffect(() => {
    const timer = setTimeout(() => {
      saveDocument(flowToDocument(nodes, edges));
    }, 400);
    return () => clearTimeout(timer);
  }, [nodes, edges]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const data: TransitionEdgeData = {
        triggerType: "click",
        selector: "",
        label: "",
        discoveredBy: "manual",
      };
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: uid("t"),
            label: edgeDisplayLabel(data),
            data,
          },
          eds,
        ),
      );
    },
    [setEdges],
  );

  const onSelectionChange = useCallback(
    ({ nodes: selNodes, edges: selEdges }: OnSelectionChangeParams) => {
      setSelectedNodeId(selNodes[0]?.id ?? null);
      setSelectedEdgeId(selNodes.length === 0 ? (selEdges[0]?.id ?? null) : null);
    },
    [],
  );

  const updateNodeData = useCallback(
    (id: string, patch: Partial<ScreenNodeData>) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
        ),
      );
    },
    [setNodes],
  );

  const updateEdgeData = useCallback(
    (id: string, patch: Partial<TransitionEdgeData>) => {
      setEdges((eds) =>
        eds.map((edge) => {
          if (edge.id !== id) return edge;
          const data = { ...edge.data!, ...patch };
          return { ...edge, data, label: edgeDisplayLabel(data) };
        }),
      );
    },
    [setEdges],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedNodeId(null);
    },
    [setNodes, setEdges],
  );

  const deleteEdge = useCallback(
    (id: string) => {
      setEdges((eds) => eds.filter((e) => e.id !== id));
      setSelectedEdgeId(null);
    },
    [setEdges],
  );

  const addScreen = useCallback(() => {
    const id = uid("s");
    const offset = nodes.length * 24;
    const node: ScreenFlowNode = {
      id,
      type: "screen",
      position: { x: 80 + (offset % 240), y: 80 + (offset % 320) },
      data: {
        name: `画面 ${nodes.length + 1}`,
        url: "",
        description: "",
        discoveredBy: "manual",
      },
      selected: true,
    };
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), node]);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  }, [nodes.length, setNodes]);

  const autoLayout = useCallback(() => {
    setNodes((nds) => {
      const positions = computeLayout(nds, edges);
      return nds.map((node) => ({
        ...node,
        position: positions.get(node.id) ?? node.position,
      }));
    });
  }, [edges, setNodes]);

  const exportJson = useCallback(() => {
    const doc = flowToDocument(nodes, edges);
    const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "screen-flow.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setStatusMessage("screen-flow.json をエクスポートしました");
  }, [nodes, edges]);

  const requestImport = useCallback((mode: "replace" | "merge") => {
    importModeRef.current = mode;
    fileInputRef.current?.click();
  }, []);

  const onFileSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        const doc = parseDocument(JSON.parse(await file.text()));
        if (importModeRef.current === "replace") {
          const flow = documentToFlow(doc);
          setNodes(flow.nodes);
          setEdges(flow.edges);
          setStatusMessage(
            `インポートしました (画面 ${flow.nodes.length} / 遷移 ${flow.edges.length})`,
          );
        } else {
          const result = mergeDocument(nodes, edges, doc);
          setNodes(result.nodes);
          setEdges(result.edges);
          setStatusMessage(
            `マージしました (画面 +${result.addedScreens} / 遷移 +${result.addedTransitions} / 既存更新 ${result.updatedScreens})`,
          );
        }
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
      } catch (error) {
        setStatusMessage(
          `インポートに失敗しました: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [nodes, edges, setNodes, setEdges],
  );

  const clearAll = useCallback(() => {
    if (!window.confirm("すべての画面と遷移を削除しますか?")) return;
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, [setNodes, setEdges]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;
  const screenNameOf = useCallback(
    (id: string) => nodes.find((n) => n.id === id)?.data.name ?? id,
    [nodes],
  );

  return (
    <div className="app">
      <header className="toolbar">
        <h1>画面遷移図デザイナー</h1>
        <div className="toolbar-buttons">
          <button onClick={addScreen}>+ 画面を追加</button>
          <button onClick={autoLayout}>自動レイアウト</button>
          <button onClick={exportJson}>エクスポート</button>
          <button onClick={() => requestImport("replace")}>
            インポート (置換)
          </button>
          <button onClick={() => requestImport("merge")}>
            インポート (マージ)
          </button>
          <button className="danger" onClick={clearAll}>
            クリア
          </button>
        </div>
        <span className="status-message">{statusMessage}</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={onFileSelected}
        />
      </header>
      <div className="main">
        <div className="canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
          >
            <Background gap={16} />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        </div>
        <PropertyPanel
          node={selectedNode}
          edge={selectedEdge}
          screenNameOf={screenNameOf}
          onUpdateNode={updateNodeData}
          onUpdateEdge={updateEdgeData}
          onDeleteNode={deleteNode}
          onDeleteEdge={deleteEdge}
        />
      </div>
    </div>
  );
}
