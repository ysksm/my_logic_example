import { join } from "path";
import { mkdir, readdir } from "fs/promises";
import { generateMindMap } from "./ai";
import { parseMindMapYaml, toYaml } from "./mindmap-yaml";
import { renderSvg } from "./layout";
import { renderStandaloneHtml } from "./render";

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = new URL("..", import.meta.url).pathname;
const PUBLIC_DIR = join(ROOT_DIR, "public");
const DATA_DIR = join(ROOT_DIR, "data");

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorResponse(err: unknown, status = 400): Response {
  const message = err instanceof Error ? err.message : String(err);
  return json({ error: message }, status);
}

/** 保存ファイル名に使える形へ正規化(パストラバーサル防止) */
function safeName(name: string): string {
  const cleaned = name.replace(/[^\w\-ぁ-んァ-ヶ一-龠ー]/g, "_").slice(0, 60);
  if (!cleaned) throw new Error("ファイル名が不正です");
  return cleaned;
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    try {
      // --- 静的ファイル ---
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        return new Response(Bun.file(join(PUBLIC_DIR, "index.html")));
      }

      // --- 発話テキスト → マインドマップYAML生成 ---
      if (req.method === "POST" && url.pathname === "/api/generate") {
        const body = (await req.json()) as { text?: string; currentYaml?: string };
        if (!body.text?.trim()) return json({ error: "text が必要です" }, 400);
        const result = await generateMindMap(body.text, body.currentYaml || undefined);
        return json({
          yaml: result.yaml,
          svg: renderSvg(result.map),
          engine: result.engine,
        });
      }

      // --- YAML → SVGプレビュー ---
      if (req.method === "POST" && url.pathname === "/api/preview") {
        const body = (await req.json()) as { yaml?: string };
        if (!body.yaml?.trim()) return json({ error: "yaml が必要です" }, 400);
        const map = parseMindMapYaml(body.yaml);
        return json({ svg: renderSvg(map), title: map.title });
      }

      // --- YAML → スタンドアロンHTMLエクスポート ---
      if (req.method === "POST" && url.pathname === "/api/export") {
        const body = (await req.json()) as { yaml?: string };
        if (!body.yaml?.trim()) return json({ error: "yaml が必要です" }, 400);
        const map = parseMindMapYaml(body.yaml);
        return new Response(renderStandaloneHtml(map), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Disposition": `attachment; filename="mindmap.html"`,
          },
        });
      }

      // --- 保存済みマップ一覧 ---
      if (req.method === "GET" && url.pathname === "/api/maps") {
        await mkdir(DATA_DIR, { recursive: true });
        const files = await readdir(DATA_DIR);
        const names = files
          .filter((f) => f.endsWith(".yaml"))
          .map((f) => f.replace(/\.yaml$/, ""))
          .sort();
        return json({ maps: names });
      }

      // --- マップ保存 / 読み込み ---
      const mapMatch = url.pathname.match(/^\/api\/maps\/([^/]+)$/);
      if (mapMatch) {
        const name = safeName(decodeURIComponent(mapMatch[1]));
        const filePath = join(DATA_DIR, `${name}.yaml`);
        if (req.method === "PUT") {
          const body = (await req.json()) as { yaml?: string };
          if (!body.yaml?.trim()) return json({ error: "yaml が必要です" }, 400);
          const map = parseMindMapYaml(body.yaml); // 検証してから保存
          await mkdir(DATA_DIR, { recursive: true });
          await Bun.write(filePath, toYaml(map));
          return json({ saved: name });
        }
        if (req.method === "GET") {
          const file = Bun.file(filePath);
          if (!(await file.exists())) return json({ error: "見つかりません" }, 404);
          return json({ yaml: await file.text() });
        }
      }

      return json({ error: "Not Found" }, 404);
    } catch (err) {
      return errorResponse(err);
    }
  },
});

console.log(`mindmap-tool: http://localhost:${server.port}`);
if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.log(
    "注意: ANTHROPIC_API_KEY が未設定のため、AI生成は簡易フォールバック(文分割)で動作します。",
  );
}
