import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

export type ScreenNodeData = {
  name: string;
  path: string;
  screenshot?: string;
};

export type ScreenFlowNode = Node<ScreenNodeData, "screen">;

export function ScreenNode({ data, selected }: NodeProps<ScreenFlowNode>) {
  return (
    <div className={selected ? "screen-node selected" : "screen-node"}>
      <Handle id="in" type="target" position={Position.Left} />
      {/* 戻り方向 (右→左) の遷移用: 下辺を経由させて順方向エッジとの重なりを避ける */}
      <Handle id="back-out" type="source" position={Position.Bottom} style={{ left: "70%" }} />
      <Handle id="back-in" type="target" position={Position.Bottom} style={{ left: "30%" }} />
      <div className="screen-node-name">{data.name}</div>
      <div className="screen-node-path">{data.path}</div>
      {data.screenshot ? (
        <img
          className="screen-node-thumb"
          src={data.screenshot}
          alt={data.name}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <div className="screen-node-thumb placeholder">キャプチャなし</div>
      )}
      <Handle id="out" type="source" position={Position.Right} />
    </div>
  );
}
