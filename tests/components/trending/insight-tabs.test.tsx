// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { InsightTabs, type TabKey } from "@/components/trending/InsightTabs";
import type { BoardInsightDTO } from "@/lib/trending/insight-projection";
import type { TrendingHashtagCard } from "@/app/api/trending/route";

function mkInsight(overrides: Partial<BoardInsightDTO> = {}): BoardInsightDTO {
  return {
    hashtagTab: [
      {
        name: "morningroutine",
        videoCount: 5,
        techniqueDistribution: { push_in: 0.6, match_cut: 0.4 },
        avgDensity: 42,
        topVideoIds: ["v1"],
      },
    ],
    techniqueTab: [
      { technique: "push_in", share: 0.6, trend: "rising" },
      { technique: "match_cut", share: 0.4, trend: "stable" },
    ],
    bgmTab: [
      { name: "BGM-Alpha", hitCount: 8, trending: true, trend: "rising" },
      { name: "BGM-Beta", hitCount: 3, trending: null, trend: "stable" },
      { name: "BGM-Gamma", hitCount: 1 },
    ],
    eventTab: [
      {
        name: "met_gala",
        displayName: "Met Gala 2026",
        matchedHashtags: ["metgala", "metgala2026"],
        matchedVideoCount: 7,
      },
    ],
    velocityTab: {
      techniqueWoW: { push_in: 0.08 },
      bgmWoW: [{ name: "BGM-Alpha", trend: "rising", deltaHits: 5 }],
      eventWoW: [{ name: "met_gala", trend: "new" }],
    },
    ...overrides,
  };
}

function mkTrendingHashtag(name: string, rank = 1): TrendingHashtagCard {
  return {
    name,
    rank,
    viewCount: 12_000_000,
    videoCount: 200,
    velocity: {
      weekOverWeek: 0.5,
      rank: { current: rank, previous: null },
      trend: "rising",
    },
  };
}

/**
 * Stateful wrapper:InsightTabs 是 controlled,activeTab 通过 props 传入。
 * 测试 fixture 包一层 useState 让 fireEvent.click 能驱动状态。
 */
function Harness({
  insight,
  platform = "all",
  trendingHashtags = [],
  initialTab = "hashtag",
}: {
  insight: BoardInsightDTO | null;
  platform?: "all" | "tiktok" | "instagram";
  trendingHashtags?: TrendingHashtagCard[];
  initialTab?: TabKey;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  return (
    <InsightTabs
      insight={insight}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      platform={platform}
      trendingHashtags={trendingHashtags}
      videosSlot={<div data-testid="videos-slot">VIDEO_GRID</div>}
    />
  );
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  cleanup();
});

describe("InsightTabs — 降级路径", () => {
  it("insight=null → 只显示 videos tab,5 个 insight tab 隐藏", () => {
    render(<Harness insight={null} initialTab="videos" />);
    expect(screen.getByRole("tab", { name: "视频网格" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Hashtag 榜" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "技法分布" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "BGM" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "热点事件" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "动量" })).toBeNull();
    // videos tabpanel 内容来自 videosSlot
    expect(screen.getByTestId("videos-slot")).toBeInTheDocument();
  });
});

describe("InsightTabs — 6 tab 全显 + 切换", () => {
  it("insight 非空 → 6 个 tab nav 全可见,默认 hashtag 高亮", () => {
    render(<Harness insight={mkInsight()} trendingHashtags={[mkTrendingHashtag("morningroutine")]} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(6);
    const labels = tabs.map((t) => t.textContent);
    expect(labels).toEqual([
      "Hashtag 榜",
      "技法分布",
      "BGM",
      "热点事件",
      "动量",
      "视频网格",
    ]);
    expect(screen.getByRole("tab", { name: "Hashtag 榜" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("默认 hashtag tab → 渲染 HashtagTab (TikTok 趋势 Hashtag 榜标题可见)", () => {
    render(<Harness insight={mkInsight()} trendingHashtags={[mkTrendingHashtag("morningroutine")]} />);
    expect(screen.getByText(/TikTok 趋势 Hashtag 榜/)).toBeInTheDocument();
    expect(screen.getByText(/#morningroutine/)).toBeInTheDocument();
  });

  it("点击 technique tab → TechniqueTab 渲染本周技法分布", () => {
    render(<Harness insight={mkInsight()} trendingHashtags={[mkTrendingHashtag("a")]} />);
    fireEvent.click(screen.getByRole("tab", { name: "技法分布" }));
    expect(screen.getByText(/本周技法分布/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "技法分布" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("点击 videos tab → videosSlot 内容渲染", () => {
    render(<Harness insight={mkInsight()} trendingHashtags={[]} />);
    fireEvent.click(screen.getByRole("tab", { name: "视频网格" }));
    expect(screen.getByTestId("videos-slot")).toBeInTheDocument();
  });
});

describe("InsightTabs — TechniqueTab IG disclaimer (W3 carryover #1)", () => {
  it("platform=instagram → '基于 TikTok 趋势' chip 显示", () => {
    render(<Harness insight={mkInsight()} platform="instagram" initialTab="technique" />);
    expect(screen.getByText(/基于 TikTok 趋势/)).toBeInTheDocument();
  });

  it("platform=tiktok → disclaimer 不显示", () => {
    render(<Harness insight={mkInsight()} platform="tiktok" initialTab="technique" />);
    expect(screen.queryByText(/基于 TikTok 趋势/)).toBeNull();
  });

  it("platform=all → disclaimer 不显示", () => {
    render(<Harness insight={mkInsight()} platform="all" initialTab="technique" />);
    expect(screen.queryByText(/基于 TikTok 趋势/)).toBeNull();
  });
});

describe("InsightTabs — BgmTab `trending === true` 严格 (W3 carryover #2)", () => {
  it("trending=true → 'Trending' 角标显示", () => {
    render(<Harness insight={mkInsight()} initialTab="bgm" />);
    // fixture 里 BGM-Alpha 是 trending=true,应见到 Trending 标签
    const trendingChips = screen.getAllByText("Trending");
    expect(trendingChips).toHaveLength(1);
  });

  it("trending=null (Gemini 显式标非trend) → 不显示 'Trending' 角标", () => {
    // reviewer M2:dedicated fixture 直接证 null 条目不渲染 chip,
    // 而非 "全局只有 1 个 chip" 间接推断 (避免 BGM-Alpha 的 1 影响判断)。
    render(
      <Harness
        insight={mkInsight({
          bgmTab: [{ name: "ExplicitNotTrending", hitCount: 1, trending: null }],
        })}
        initialTab="bgm"
      />,
    );
    expect(screen.queryByText("Trending")).toBeNull();
  });

  it("trending=undefined → 不显示 'Trending' 角标", () => {
    render(
      <Harness
        insight={mkInsight({
          bgmTab: [{ name: "OnlyNoTrending", hitCount: 1 }],
        })}
        initialTab="bgm"
      />,
    );
    expect(screen.queryByText("Trending")).toBeNull();
  });
});

describe("InsightTabs — EventTab + VelocityTab 渲染", () => {
  it("event tab → 事件 displayName + 关联 hashtag chip", () => {
    render(<Harness insight={mkInsight()} initialTab="event" />);
    expect(screen.getByText(/Met Gala 2026/)).toBeInTheDocument();
    // fixture 有 2 个 chip:#metgala / #metgala2026,验证 chip count
    const chips = screen.getAllByText(/^#metgala/);
    expect(chips).toHaveLength(2);
    expect(screen.getByText(/7 个视频命中/)).toBeInTheDocument();
  });

  it("velocity tab → 3 栏 (技法 / BGM / 事件) 都可见", () => {
    render(<Harness insight={mkInsight()} initialTab="velocity" />);
    expect(screen.getByText("技法 WoW")).toBeInTheDocument();
    expect(screen.getByText("BGM WoW")).toBeInTheDocument();
    expect(screen.getByText("事件 WoW")).toBeInTheDocument();
  });

  it("velocity tab + 无 prev 数据 → 基线 banner 显示", () => {
    render(
      <Harness
        insight={mkInsight({
          velocityTab: {
            techniqueWoW: {},
            bgmWoW: [{ name: "X", trend: "new", deltaHits: 5 }],
            eventWoW: [{ name: "Y", trend: "new" }],
          },
        })}
        initialTab="velocity"
      />,
    );
    expect(screen.getByText(/首周基线视图/)).toBeInTheDocument();
  });
});

describe("InsightTabs — ARIA tabs 合规", () => {
  it("tabpanel 存在且 aria-labelledby 指向 active tab", () => {
    render(<Harness insight={mkInsight()} />);
    const tabpanel = screen.getByRole("tabpanel");
    expect(tabpanel).toHaveAttribute("aria-labelledby", "insight-tab-hashtag");
    expect(tabpanel).toHaveAttribute("id", "insight-tabpanel-hashtag");
  });

  it("aria-selected 唯一,切换后转移", () => {
    render(<Harness insight={mkInsight()} />);
    const selected = screen
      .getAllByRole("tab")
      .filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);

    fireEvent.click(screen.getByRole("tab", { name: "BGM" }));
    const selectedAfter = screen
      .getAllByRole("tab")
      .filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selectedAfter).toHaveLength(1);
    expect(selectedAfter[0]?.textContent).toBe("BGM");
  });
});
