import { describe, expect, it } from "vitest";
import { mergeRolling } from "./mergeRolling";

describe("mergeRolling", () => {
  it("複数窓のローリング相関を日付でマージする", () => {
    const merged = mergeRolling({
      "20": [
        { date: "2024-06-01", corr: 0.4 },
        { date: "2024-06-02", corr: 0.5 },
      ],
      "60": [{ date: "2024-06-02", corr: 0.3 }],
    });
    expect(merged).toEqual([
      { date: "2024-06-01", w20: 0.4 },
      { date: "2024-06-02", w20: 0.5, w60: 0.3 },
    ]);
  });

  it("日付順にソートされる", () => {
    const merged = mergeRolling({
      "20": [
        { date: "2024-06-03", corr: 0.1 },
        { date: "2024-06-01", corr: 0.2 },
      ],
    });
    expect(merged.map((p) => p.date)).toEqual(["2024-06-01", "2024-06-03"]);
  });

  it("null / NaN の相関は null として保持する", () => {
    const merged = mergeRolling({
      "120": [
        { date: "2024-06-01", corr: null },
        { date: "2024-06-02", corr: Number.NaN },
      ],
    });
    expect(merged[0].w120).toBeNull();
    expect(merged[1].w120).toBeNull();
  });

  it("空オブジェクトは空配列を返す", () => {
    expect(mergeRolling({})).toEqual([]);
  });
});
