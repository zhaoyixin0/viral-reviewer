import { describe, expect, it } from "vitest";
import { getIsoWeek } from "@/lib/utils/iso-week";

describe("getIsoWeek", () => {
  it("formats a mid-year date as YYYY-Www with zero-padded week", () => {
    // 2026-05-13 是周三,ISO week 20
    expect(getIsoWeek(new Date("2026-05-13T00:00:00Z"))).toBe("2026-W20");
  });

  it("zero-pads single-digit week numbers", () => {
    // 2026-01-05 是周一,ISO week 02
    expect(getIsoWeek(new Date("2026-01-05T00:00:00Z"))).toBe("2026-W02");
  });

  it("handles year-boundary: 2025-12-31 belongs to ISO week 2026-W01", () => {
    // 2025-12-31 是周三,ISO 周归属 2026-W01
    expect(getIsoWeek(new Date("2025-12-31T00:00:00Z"))).toBe("2026-W01");
  });

  it("defaults to current date when no arg passed", () => {
    expect(getIsoWeek()).toMatch(/^\d{4}-W\d{2}$/);
  });
});
