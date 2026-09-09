import { parse, stringify } from "yaml";
import type { MindMap, MindMapNode } from "./types";

/** YAML文字列を MindMap として解析・検証する。不正なら Error を投げる。 */
export function parseMindMapYaml(source: string): MindMap {
  const stripped = stripCodeFence(source);
  const data = parse(stripped);
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("YAMLのトップレベルはオブジェクトである必要があります");
  }
  const record = data as Record<string, unknown>;
  const title = record["title"];
  if (typeof title !== "string" || title.trim() === "") {
    throw new Error("title (文字列) が必要です");
  }
  const root = validateNode(record["root"], "root");
  return { title: title.trim(), root };
}

/** MindMap を正規化されたYAML文字列にする。 */
export function toYaml(map: MindMap): string {
  return stringify(map, { lineWidth: 0 });
}

function validateNode(value: unknown, path: string): MindMapNode {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} はオブジェクトである必要があります`);
  }
  const record = value as Record<string, unknown>;
  const text = record["text"];
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error(`${path}.text (文字列) が必要です`);
  }
  const node: MindMapNode = { text: text.trim() };
  if (record["note"] !== undefined && record["note"] !== null) {
    if (typeof record["note"] !== "string") {
      throw new Error(`${path}.note は文字列である必要があります`);
    }
    node.note = record["note"];
  }
  const children = record["children"];
  if (children !== undefined && children !== null) {
    if (!Array.isArray(children)) {
      throw new Error(`${path}.children は配列である必要があります`);
    }
    node.children = children.map((child, i) =>
      validateNode(child, `${path}.children[${i}]`),
    );
  }
  return node;
}

/** AI応答などに含まれがちな ```yaml フェンスを剥がす。 */
export function stripCodeFence(source: string): string {
  const trimmed = source.trim();
  const match = trimmed.match(/^```(?:ya?ml)?\s*\n([\s\S]*?)\n```\s*$/);
  return match ? match[1] : trimmed;
}
