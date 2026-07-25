import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ScreenFlowNode } from "../types";

function ScreenNodeComponent({ data, selected }: NodeProps<ScreenFlowNode>) {
  return (
    <div className={`screen-node${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="screen-node-header">
        <span className="screen-node-name">{data.name || "(名称未設定)"}</span>
        {data.discoveredBy === "playwright" && (
          <span className="screen-node-badge" title="Playwright クロールで検出">
            PW
          </span>
        )}
      </div>
      {data.url && <div className="screen-node-url">{data.url}</div>}
      {data.description && (
        <div className="screen-node-description">{data.description}</div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const ScreenNode = memo(ScreenNodeComponent);
