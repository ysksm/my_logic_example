import { describe, expect, it } from "vitest";
import { formatCorr, formatPct, formatSigma } from "./format";

describe("formatPct", () => {
  it("正の値は + 符号付きパーセントになる", () => {
    expect(formatPct(0.012)).toBe("+1.2%");
    expect(formatPct(0.0567, 2)).toBe("+5.67%");
  });

  it("負の値はマイナス表記になる", () => {
    expect(formatPct(-0.045)).toBe("-4.5%");
  });

  it("0 は符号なし", () => {
    expect(formatPct(0)).toBe("0.0%");
  });

  it("withSign=false で + 符号を抑制できる", () => {
    expect(formatPct(0.67, 0, false)).toBe("67%");
  });

  it("null / undefined / NaN は em ダッシュ", () => {
    expect(formatPct(null)).toBe("—");
    expect(formatPct(undefined)).toBe("—");
    expect(formatPct(Number.NaN)).toBe("—");
  });
});

describe("formatSigma", () => {
  it("σ 付きで表記する", () => {
    expect(formatSigma(2.4)).toBe("+2.4σ");
    expect(formatSigma(-1.25)).toBe("-1.3σ");
    expect(formatSigma(2.34, 2)).toBe("+2.34σ");
  });

  it("null / NaN は em ダッシュ", () => {
    expect(formatSigma(null)).toBe("—");
    expect(formatSigma(Number.NaN)).toBe("—");
  });
});

describe("formatCorr", () => {
  it("小数2桁で表記する", () => {
    expect(formatCorr(0.4567)).toBe("0.46");
    expect(formatCorr(-0.3)).toBe("-0.30");
  });

  it("null / NaN は em ダッシュ", () => {
    expect(formatCorr(null)).toBe("—");
    expect(formatCorr(Number.NaN)).toBe("—");
  });
});
