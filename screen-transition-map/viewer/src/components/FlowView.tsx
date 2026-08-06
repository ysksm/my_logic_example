import { useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { layoutNodes } from "../lib/layout";
import { operationLabel, type ScreenMapDocument } from "../types";
import { ScreenNode, type ScreenFlowNode } from "./ScreenNode";

const nodeTypes = { screen: ScreenNode };

interface Props {
  doc: ScreenMapDocument;
  selectedScreenId: string | null;
  onSelectScreen: (id: string) => void;
}

export function FlowView({ doc, selectedScreenId, onSelectScreen }: Props) {
  const { nodes, edges } = useMemo(() => {
    const rawNodes: ScreenFlowNode[] = doc.screens.map((screen) => ({
      id: screen.id,
      type: "screen",
      position: { x: 0, y: 0 },
      data: {
        name: screen.name,
        path: screen.path,
        screenshot: screen.screenshot,
      },
    }));
    const baseEdges: Edge[] = doc.transitions.map((t) => ({
      id: t.id,
      source: t.from,
      sourceHandle: "out",
      target: t.to,
      targetHandle: "in",
      label: operationLabel(t.operation),
      labelStyle: { fontSize: 11 },
      style: { strokeWidth: 1.5 },
      animated: t.operation.actionType === "auto",
    }));
    const nodes = layoutNodes(rawNodes, baseEdges) as ScreenFlowNode[];

    // 右→左へ戻る遷移は破線にしてノード下辺を経由させ、順方向のエッジ/ラベルとの重なりを避ける。
    // 迂回の深さを 1 本ごとにずらし、戻り同士のラベル衝突も防ぐ
    const xById = new Map(nodes.map((n) => [n.id, n.position.x]));
    let backCount = 0;
    const edges = baseEdges.map((edge) =>
      (xById.get(edge.source) ?? 0) >= (xById.get(edge.target) ?? 0)
        ? {
            ...edge,
            sourceHandle: "back-out",
            targetHandle: "back-in",
            type: "smoothstep",
            pathOptions: { borderRadius: 12, offset: 36 + (backCount++ % 4) * 30 },
            style: { ...edge.style, strokeDasharray: "6 3", stroke: "#9ca3af" },
            labelStyle: { ...edge.labelStyle, fill: "#6b7280" },
          }
        : edge,
    );
    return { nodes, edges };
  }, [doc]);

  const displayNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === selectedScreenId,
      })),
    [nodes, selectedScreenId],
  );

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    onSelectScreen(node.id);
  };

  return (
    <ReactFlow
      nodes={displayNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      fitView
      nodesConnectable={false}
      elementsSelectable
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}
