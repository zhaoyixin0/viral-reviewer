import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { TrendingCard, shouldShowPlaceholder } from "@/components/trending/TrendingCard";
import type { TrendingCard as TrendingCardData } from "@/app/api/trending/route";

function makeCard(overrides: Partial<TrendingCardData> = {}): TrendingCardData {
  return {
    id: "tt-1",
    platform: "tiktok",
    url: "https://www.tiktok.com/@u/video/1",
    cover: "https://cdn.tiktokcdn.com/img/cover.jpg",
    title: "demo title",
    topic: "搞笑",
    views: 12345,
    velocity: {
      weekOverWeek: null,
      rank: { current: 0, previous: null },
      trend: "new",
    },
    ...overrides,
  };
}

describe("shouldShowPlaceholder", () => {
  // phase 1 诊断：cover 空率 = 0 但 URL 100% 403（CDN signed-URL 过期），
  // UI 兜底必须同时覆盖 (cover 空) + (浏览器实际渲染失败)。
  it("returns true when cover is empty string (上游未提供封面)", () => {
    expect(shouldShowPlaceholder("", false)).toBe(true);
  });

  it("returns true when cover is non-empty but img onError fired (CDN 401/403/网络炸)", () => {
    expect(shouldShowPlaceholder("https://cdn.example.com/x.jpg", true)).toBe(true);
  });

  it("returns false when cover is non-empty and load succeeded (happy path)", () => {
    expect(shouldShowPlaceholder("https://cdn.example.com/x.jpg", false)).toBe(false);
  });
});

describe("TrendingCard SSR markup", () => {
  // 不依赖 jsdom/RTL：用 react-dom/server.renderToStaticMarkup 在 node env 直出 HTML 字符串,
  // 验 referrerPolicy 落 DOM 属性 + 占位与 <img> 分支可见。
  it("renders <img> with referrerPolicy=\"no-referrer\" when cover present", () => {
    const html = renderToStaticMarkup(createElement(TrendingCard, { card: makeCard() }));
    expect(html).toContain("<img");
    // React 把 referrerPolicy 序列化为小写 referrerpolicy（HTML 属性大小写不敏感,DOM 表现一致）
    expect(html.toLowerCase()).toContain('referrerpolicy="no-referrer"');
    expect(html).not.toContain("无封面");
  });

  it("renders 无封面 placeholder when cover is empty string", () => {
    const html = renderToStaticMarkup(
      createElement(TrendingCard, { card: makeCard({ cover: "" }) }),
    );
    expect(html).toContain("无封面");
    expect(html).not.toContain("<img");
  });
});
