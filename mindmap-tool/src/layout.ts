import type { MindMap, MindMapNode } from "./types";

const FONT_SIZE = 14;
const NODE_PADDING_X = 12;
const NODE_HEIGHT = 34;
const ROW_GAP = 14;
const COLUMN_GAP = 56;
const MARGIN = 32;

/** 枝(ルート直下の子)ごとに割り当てるカラーパレット */
const BRANCH_COLORS = [
  "#2563eb",
  "#d97706",
  "#059669",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
];
const ROOT_COLOR = "#1e293b";

interface LaidOutNode {
  node: MindMapNode;
  depth: number;
  x: number;
  y: number;
  width: number;
  color: string;
  children: LaidOutNode[];
}

/** 全角文字を考慮したおおよそのテキスト幅(px) */
function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += ch.codePointAt(0)! > 0xff ? FONT_SIZE : FONT_SIZE * 0.55;
  }
  return width;
}

function nodeWidth(node: MindMapNode): number {
  return Math.ceil(textWidth(node.text)) + NODE_PADDING_X * 2;
}

/** サブツリーの葉の数(縦方向のスロット数) */
function leafCount(node: MindMapNode): number {
  if (!node.children || node.children.length === 0) return 1;
  return node.children.reduce((sum, child) => sum + leafCount(child), 0);
}

/** 左→右のツリーレイアウトを計算する */
export function layoutMindMap(map: MindMap): LaidOutNode {
  // 深さごとの最大ノード幅からカラムのX座標を決める
  const depthWidths: number[] = [];
  const scanDepth = (node: MindMapNode, depth: number) => {
    depthWidths[depth] = Math.max(depthWidths[depth] ?? 0, nodeWidth(node));
    node.children?.forEach((child) => scanDepth(child, depth + 1));
  };
  scanDepth(map.root, 0);

  const columnX: number[] = [];
  let x = MARGIN;
  for (let d = 0; d < depthWidths.length; d++) {
    columnX[d] = x;
    x += depthWidths[d] + COLUMN_GAP;
  }

  let nextSlot = 0;
  const place = (
    node: MindMapNode,
    depth: number,
    color: string,
    branchIndex: number,
  ): LaidOutNode => {
    const children: LaidOutNode[] = [];
    let y: number;
    if (!node.children || node.children.length === 0) {
      y = MARGIN + nextSlot * (NODE_HEIGHT + ROW_GAP);
      nextSlot += 1;
    } else {
      node.children.forEach((child, i) => {
        const childColor =
          depth === 0 ? BRANCH_COLORS[i % BRANCH_COLORS.length] : color;
        children.push(place(child, depth + 1, childColor, i));
      });
      y = (children[0].y + children[children.length - 1].y) / 2;
    }
    return {
      node,
      depth,
      x: columnX[depth],
      y,
      width: nodeWidth(node),
      color: depth === 0 ? ROOT_COLOR : color,
      children,
    };
  };

  return place(map.root, 0, ROOT_COLOR, 0);
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** MindMap をSVG文字列に描画する */
export function renderSvg(map: MindMap): string {
  const root = layoutMindMap(map);
  const parts: string[] = [];
  let maxX = 0;
  let maxY = 0;

  const walk = (laid: LaidOutNode) => {
    maxX = Math.max(maxX, laid.x + laid.width);
    maxY = Math.max(maxY, laid.y + NODE_HEIGHT);
    for (const child of laid.children) {
      const startX = laid.x + laid.width;
      const startY = laid.y + NODE_HEIGHT / 2;
      const endX = child.x;
      const endY = child.y + NODE_HEIGHT / 2;
      const controlX = (startX + endX) / 2;
      parts.push(
        `<path d="M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}" fill="none" stroke="${child.color}" stroke-width="2" opacity="0.6"/>`,
      );
      walk(child);
    }
    const isRoot = laid.depth === 0;
    const fill = isRoot ? laid.color : "#ffffff";
    const textColor = isRoot ? "#ffffff" : "#1e293b";
    const title = laid.node.note
      ? `<title>${escapeXml(laid.node.note)}</title>`
      : "";
    parts.push(
      `<g>${title}<rect x="${laid.x}" y="${laid.y}" rx="10" ry="10" width="${laid.width}" height="${NODE_HEIGHT}" fill="${fill}" stroke="${laid.color}" stroke-width="2"/>` +
        `<text x="${laid.x + laid.width / 2}" y="${laid.y + NODE_HEIGHT / 2}" text-anchor="middle" dominant-baseline="central" font-size="${FONT_SIZE}" fill="${textColor}">${escapeXml(laid.node.text)}</text></g>`,
    );
  };
  walk(root);

  const width = maxX + MARGIN;
  const height = maxY + MARGIN;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="'Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif">` +
    `<rect width="${width}" height="${height}" fill="#f8fafc"/>` +
    parts.join("") +
    "</svg>"
  );
}
