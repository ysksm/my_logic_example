/**
 * CLI: YAMLファイルからスタンドアロンHTMLのマインドマップを生成する。
 *
 *   bun run src/cli.ts render examples/sample.yaml -o sample.html
 */
import { parseArgs } from "util";
import { parseMindMapYaml } from "./mindmap-yaml";
import { renderStandaloneHtml } from "./render";

const [command, ...rest] = Bun.argv.slice(2);

if (command !== "render") {
  console.error("使い方: bun run src/cli.ts render <input.yaml> [-o output.html]");
  process.exit(1);
}

const { values, positionals } = parseArgs({
  args: rest,
  options: { output: { type: "string", short: "o" } },
  allowPositionals: true,
});

const input = positionals[0];
if (!input) {
  console.error("入力YAMLファイルを指定してください");
  process.exit(1);
}

const yamlText = await Bun.file(input).text();
const map = parseMindMapYaml(yamlText);
const html = renderStandaloneHtml(map);
const output = values.output ?? input.replace(/\.ya?ml$/, "") + ".html";
await Bun.write(output, html);
console.log(`書き出しました: ${output} (${map.title})`);
