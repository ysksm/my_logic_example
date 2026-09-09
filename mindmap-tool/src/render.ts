import type { MindMap } from "./types";
import { renderSvg } from "./layout";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** MindMap を単体で開けるHTMLページ(スタンドアロン)として書き出す */
export function renderStandaloneHtml(map: MindMap): string {
  const svg = renderSvg(map);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(map.title)}</title>
<style>
  body { margin: 0; background: #f8fafc; color: #1e293b; font-family: 'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', sans-serif; }
  header { padding: 16px 24px; border-bottom: 1px solid #e2e8f0; background: #ffffff; }
  h1 { margin: 0; font-size: 18px; }
  main { padding: 24px; overflow: auto; }
</style>
</head>
<body>
<header><h1>${escapeHtml(map.title)}</h1></header>
<main>${svg}</main>
</body>
</html>
`;
}
