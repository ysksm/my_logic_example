import { describe, expect, it } from "vitest";
import { corrColor, corrTextColor } from "./corrColor";

describe("corrColor", () => {
  it("null はグレーを返す", () => {
    expect(corrColor(null)).toBe("hsl(0, 0%, 88%)");
    expect(corrColor(undefined)).toBe("hsl(0, 0%, 88%)");
  });

  it("NaN もグレーを返す", () => {
    expect(corrColor(Number.NaN)).toBe("hsl(0, 0%, 88%)");
  });

  it("正の相関は赤系 (hue=4)", () => {
    expect(corrColor(0.8)).toMatch(/^hsl\(4, /);
    expect(corrColor(0.01)).toMatch(/^hsl\(4, /);
  });

  it("負の相関は青系 (hue=215)", () => {
    expect(corrColor(-0.8)).toMatch(/^hsl\(215, /);
  });

  it("相関が強いほど明度が下がる（濃くなる）", () => {
    const light = (s: string) => Number(s.match(/(\d+)%\)$/)![1]);
    expect(light(corrColor(1))).toBeLessThan(light(corrColor(0.5)));
    expect(light(corrColor(0.5))).toBeLessThan(light(corrColor(0.1)));
    expect(light(corrColor(-1))).toBeLessThan(light(corrColor(-0.2)));
  });

  it("corr=0 はほぼ白", () => {
    expect(corrColor(0)).toBe("hsl(4, 78%, 96%)");
  });

  it("範囲外の値は -1..1 にクランプされる", () => {
    expect(corrColor(5)).toBe(corrColor(1));
    expect(corrColor(-5)).toBe(corrColor(-1));
  });
});

describe("corrTextColor", () => {
  it("濃いセルは白文字、薄いセルは黒系文字", () => {
    expect(corrTextColor(0.9)).toBe("#fff");
    expect(corrTextColor(-0.9)).toBe("#fff");
    expect(corrTextColor(0.2)).toBe("#222");
    expect(corrTextColor(null)).toBe("#555");
  });
});
