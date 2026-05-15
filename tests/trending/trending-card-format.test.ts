import { describe, expect, it } from "vitest";
import { formatVelocityBadge, safeHref } from "@/components/trending/TrendingCard";

describe("formatVelocityBadge", () => {
  it("renders NEW for trend=new with null weekOverWeek (never +null% / NaN%)", () => {
    const badge = formatVelocityBadge({ weekOverWeek: null, rank: { current: 0, previous: null }, trend: "new" });
    expect(badge.label).toBe("NEW");
    expect(badge.label).not.toContain("null");
    expect(badge.label).not.toContain("NaN");
  });

  it("renders +45% for a rising video", () => {
    const badge = formatVelocityBadge({ weekOverWeek: 0.45, rank: { current: 0, previous: 1 }, trend: "rising" });
    expect(badge.label).toBe("+45%");
  });

  it("renders -8% for a falling video", () => {
    const badge = formatVelocityBadge({ weekOverWeek: -0.08, rank: { current: 2, previous: 1 }, trend: "falling" });
    expect(badge.label).toBe("-8%");
  });

  it("renders 持平 for a stable video", () => {
    const badge = formatVelocityBadge({ weekOverWeek: 0.01, rank: { current: 1, previous: 1 }, trend: "stable" });
    expect(badge.label).toBe("持平");
  });

  it("never produces NaN even if weekOverWeek is null but trend is not 'new'", () => {
    // 防御:数据不一致时也不能渲染 NaN
    const badge = formatVelocityBadge({ weekOverWeek: null, rank: { current: 0, previous: 0 }, trend: "stable" });
    expect(badge.label).not.toContain("NaN");
  });
});

describe("safeHref", () => {
  it("returns the url unchanged for http/https schemes", () => {
    expect(safeHref("https://www.tiktok.com/@u/video/123")).toBe("https://www.tiktok.com/@u/video/123");
    expect(safeHref("http://example.com")).toBe("http://example.com");
  });
  it("returns undefined for javascript: URIs", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("JaVaScRiPt:alert(1)")).toBeUndefined();
  });
  it("returns undefined for data: / file: / vbscript: / about: / mailto: / ftp:", () => {
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeHref("vbscript:msgbox")).toBeUndefined();
    expect(safeHref("file:///etc/passwd")).toBeUndefined();
    expect(safeHref("about:blank")).toBeUndefined();
    expect(safeHref("mailto:a@b.com")).toBeUndefined();
    expect(safeHref("ftp://example.com")).toBeUndefined();
  });
  it("returns undefined for empty / whitespace url (defensive)", () => {
    expect(safeHref("")).toBeUndefined();
    expect(safeHref("   javascript:alert(1)")).toBeUndefined();
  });
});
