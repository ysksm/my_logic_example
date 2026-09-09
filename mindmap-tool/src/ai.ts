import Anthropic from "@anthropic-ai/sdk";
import type { MindMap } from "./types";
import { parseMindMapYaml, toYaml } from "./mindmap-yaml";

const MODEL = "claude-opus-5";

const SYSTEM_PROMPT = `あなたは発話内容からマインドマップを構造化するアシスタントです。
ユーザーが口頭で話した(または書いた)内容を受け取り、要点を階層化したマインドマップをYAMLで出力してください。

出力の規則:
- 出力はYAMLのみ。説明文やコードフェンスは一切付けない。
- スキーマは次の通り:
  title: マップ全体のタイトル(短い日本語)
  root:
    text: 中心テーマ
    children:
      - text: 枝のラベル(短く。体言止め推奨)
        note: 補足があれば1文で(任意)
        children: さらに掘り下げる場合のみ(任意)
- 階層は最大4段程度。1ノードのtextは20文字以内を目安に短くまとめる。
- 発話の重複・言い直しは整理し、同じ話題は1つのノードにまとめる。
- 発話に無い内容を勝手に追加しない。ただし話題のグルーピングのための中間ノードは作ってよい。

既存のマインドマップYAMLが与えられた場合は、それを土台に新しい発話の内容を追記・整理した完全なYAMLを出力してください(既存ノードは意味が変わらない限り残す)。`;

export interface GenerateResult {
  map: MindMap;
  yaml: string;
  /** "claude" = AI生成 / "fallback" = APIキー無し時の簡易生成 */
  engine: "claude" | "fallback";
}

function hasCredentials(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN,
  );
}

/**
 * 発話テキストからマインドマップYAMLを生成する。
 * currentYaml を渡すと既存マップへの追記(インクリメンタル更新)になる。
 */
export async function generateMindMap(
  speech: string,
  currentYaml?: string,
): Promise<GenerateResult> {
  if (!hasCredentials()) {
    const map = fallbackGenerate(speech, currentYaml);
    return { map, yaml: toYaml(map), engine: "fallback" };
  }

  const client = new Anthropic();
  const userContent = currentYaml
    ? `# 既存のマインドマップYAML\n${currentYaml}\n\n# 新しい発話内容\n${speech}`
    : `# 発話内容\n${speech}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text += block.text;
  }
  const map = parseMindMapYaml(text);
  return { map, yaml: toYaml(map), engine: "claude" };
}

/**
 * APIキーが無い環境用の簡易生成。
 * 行・句点で区切った文をそのまま枝にする(構造化はしない)。
 */
export function fallbackGenerate(speech: string, currentYaml?: string): MindMap {
  const sentences = speech
    .split(/[\n。.!?!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let map: MindMap;
  if (currentYaml) {
    map = parseMindMapYaml(currentYaml);
  } else {
    const title = sentences[0]?.slice(0, 20) || "マインドマップ";
    map = { title, root: { text: title, children: [] } };
  }
  map.root.children ??= [];
  for (const sentence of sentences) {
    const label = sentence.slice(0, 30);
    if (label === map.root.text) continue;
    if (map.root.children.some((c) => c.text === label)) continue;
    map.root.children.push({ text: label });
  }
  return map;
}
