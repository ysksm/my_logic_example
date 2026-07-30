import { describe, expect, it } from "vitest";
import { strengthLabel } from "./strengthLabel";

describe("strengthLabel", () => {
  it("strong は「強」で赤系", () => {
    const badge = strengthLabel("strong");
    expect(badge.label).toBe("強");
    expect(badge.bg).toBe("#d32f2f");
    expect(badge.fg).toBe("#ffffff");
  });

  it("moderate は「中」で橙系", () => {
    const badge = strengthLabel("moderate");
    expect(badge.label).toBe("中");
    expect(badge.bg).toBe("#ef6c00");
  });

  it("weak は「弱」で灰色", () => {
    const badge = strengthLabel("weak");
    expect(badge.label).toBe("弱");
    expect(badge.bg).toBe("#9e9e9e");
  });

  it("none は「なし」で薄灰", () => {
    const badge = strengthLabel("none");
    expect(badge.label).toBe("なし");
    expect(badge.bg).toBe("#e0e0e0");
  });

  it("未知の値は none 相当にフォールバックする", () => {
    expect(strengthLabel("unexpected").label).toBe("なし");
  });
});
