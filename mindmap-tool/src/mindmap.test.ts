import { describe, expect, test } from "bun:test";
import { parseMindMapYaml, stripCodeFence, toYaml } from "./mindmap-yaml";
import { renderSvg } from "./layout";
import { renderStandaloneHtml } from "./render";
import { fallbackGenerate } from "./ai";

const SAMPLE = `
title: テスト
root:
  text: 中心
  children:
    - text: 枝A
      note: メモ
      children:
        - text: 葉1
        - text: 葉2
    - text: 枝B
`;

describe("parseMindMapYaml", () => {
  test("正常なYAMLを解析できる", () => {
    const map = parseMindMapYaml(SAMPLE);
    expect(map.title).toBe("テスト");
    expect(map.root.text).toBe("中心");
    expect(map.root.children).toHaveLength(2);
    expect(map.root.children![0].children![1].text).toBe("葉2");
    expect(map.root.children![0].note).toBe("メモ");
  });

  test("コードフェンス付きでも解析できる", () => {
    const fenced = "```yaml\n" + SAMPLE.trim() + "\n```";
    expect(parseMindMapYaml(fenced).title).toBe("テスト");
  });

  test("title欠落はエラー", () => {
    expect(() => parseMindMapYaml("root:\n  text: a")).toThrow();
  });

  test("textが無いノードはエラー", () => {
    expect(() =>
      parseMindMapYaml("title: t\nroot:\n  text: a\n  children:\n    - note: x"),
    ).toThrow();
  });

  test("toYamlの往復で構造が保たれる", () => {
    const map = parseMindMapYaml(SAMPLE);
    const reparsed = parseMindMapYaml(toYaml(map));
    expect(reparsed).toEqual(map);
  });
});

describe("stripCodeFence", () => {
  test("フェンス無しはそのまま", () => {
    expect(stripCodeFence("title: a")).toBe("title: a");
  });
});

describe("renderSvg", () => {
  test("全ノードのテキストがSVGに含まれる", () => {
    const map = parseMindMapYaml(SAMPLE);
    const svg = renderSvg(map);
    expect(svg).toStartWith("<svg");
    for (const text of ["中心", "枝A", "枝B", "葉1", "葉2"]) {
      expect(svg).toContain(text);
    }
  });

  test("XSSになりうる文字はエスケープされる", () => {
    const map = parseMindMapYaml('title: t\nroot:\n  text: "<script>alert(1)</script>"');
    const svg = renderSvg(map);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});

describe("renderStandaloneHtml", () => {
  test("タイトルとSVGを含むHTMLを生成する", () => {
    const map = parseMindMapYaml(SAMPLE);
    const html = renderStandaloneHtml(map);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>テスト</title>");
    expect(html).toContain("<svg");
  });
});

describe("fallbackGenerate", () => {
  test("文を分割して枝にする(最初の文はルートになり重複しない)", () => {
    const map = fallbackGenerate("新サービスを考える。ターゲットは開発者。機能は音声入力。");
    expect(map.root.text).toBe("新サービスを考える");
    expect(map.root.children!.map((c) => c.text)).toEqual([
      "ターゲットは開発者",
      "機能は音声入力",
    ]);
  });

  test("既存YAMLに追記できる", () => {
    const base = fallbackGenerate("最初のアイデア。候補は2つ。");
    const updated = fallbackGenerate("追加の話題。", toYaml(base));
    expect(updated.root.children!.map((c) => c.text)).toEqual([
      "候補は2つ",
      "追加の話題",
    ]);
  });
});
