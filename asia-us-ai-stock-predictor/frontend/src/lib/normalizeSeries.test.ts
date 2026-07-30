import { describe, expect, it } from "vitest";
import { normalizeSeries } from "./normalizeSeries";

describe("normalizeSeries", () => {
  it("各系列の最初の非null値を100に正規化する", () => {
    const result = normalizeSeries([
      { date: "2024-06-01", asia_close: 200, us_close: 50 },
      { date: "2024-06-02", asia_close: 300, us_close: 75 },
      { date: "2024-06-03", asia_close: 100, us_close: 100 },
    ]);
    expect(result).toEqual([
      { date: "2024-06-01", asia: 100, us: 100 },
      { date: "2024-06-02", asia: 150, us: 150 },
      { date: "2024-06-03", asia: 50, us: 200 },
    ]);
  });

  it("先頭が null でも最初の非null値を基準にする", () => {
    const result = normalizeSeries([
      { date: "2024-06-01", asia_close: null, us_close: 50 },
      { date: "2024-06-02", asia_close: 400, us_close: null },
      { date: "2024-06-03", asia_close: 500, us_close: 75 },
    ]);
    expect(result[0]).toEqual({ date: "2024-06-01", asia: null, us: 100 });
    expect(result[1]).toEqual({ date: "2024-06-02", asia: 100, us: null });
    expect(result[2]).toEqual({ date: "2024-06-03", asia: 125, us: 150 });
  });

  it("null（祝日ずれ）はそのまま null を返して線を切る", () => {
    const result = normalizeSeries([
      { date: "2024-06-01", asia_close: 100, us_close: 10 },
      { date: "2024-06-02", asia_close: null, us_close: 12 },
      { date: "2024-06-03", asia_close: 110, us_close: null },
    ]);
    expect(result[1].asia).toBeNull();
    expect(result[2].us).toBeNull();
    expect(result[1].us).toBe(120);
    expect(result[2].asia).toBeCloseTo(110);
  });

  it("全て null の系列は全行 null になる", () => {
    const result = normalizeSeries([
      { date: "2024-06-01", asia_close: null, us_close: 10 },
      { date: "2024-06-02", asia_close: null, us_close: 11 },
    ]);
    expect(result.every((p) => p.asia === null)).toBe(true);
    expect(result[0].us).toBe(100);
    expect(result[1].us).toBeCloseTo(110);
  });

  it("空配列は空配列を返す", () => {
    expect(normalizeSeries([])).toEqual([]);
  });

  it("基準値が 0 の場合はゼロ除算せず null にする", () => {
    const result = normalizeSeries([
      { date: "2024-06-01", asia_close: 0, us_close: 10 },
      { date: "2024-06-02", asia_close: 5, us_close: 20 },
    ]);
    expect(result[0].asia).toBeNull();
    expect(result[1].asia).toBeNull();
    expect(result[1].us).toBe(200);
  });
});
