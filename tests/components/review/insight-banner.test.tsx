// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { InsightBanner } from "@/components/review/InsightBanner";
import type { InsightBannerData } from "@/lib/insight/generate-banner";

function mk(overrides: Partial<InsightBannerData> = {}): InsightBannerData {
  return {
    week: "2026-W20",
    headline: "结合本周 [travel 赛道] 趋势",
    bullets: [
      "剪辑手法:jumpcut 占 50% + montage 占 30%",
      'BGM Top1:"Sunset Drive"(命中 12 视频)',
    ],
    actionable: "vlog 优先尝试 jumpcut；如题材契合，抓住热点窗口。",
    sourceWeek: "2026-W20",
    sampleVideoIds: ["v1", "v2", "v3"],
    ...overrides,
  };
}

describe("InsightBanner", () => {
  afterEach(cleanup);

  it("data=null → 不渲染任何 DOM (firstChild === null)", () => {
    const { container } = render(<InsightBanner data={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("happy path: 5 段全渲染 (headline / bullets / actionable / sourceWeek / sampleVideoIds)", () => {
    render(<InsightBanner data={mk()} />);
    // headline
    expect(
      screen.getByText("结合本周 [travel 赛道] 趋势"),
    ).toBeInTheDocument();
    // bullets
    expect(screen.getByText(/jumpcut 占 50%/)).toBeInTheDocument();
    expect(screen.getByText(/Sunset Drive/)).toBeInTheDocument();
    // actionable + "建议:" UI prefix (C1.1 MED #1 deferred here)
    expect(screen.getByText("建议:")).toBeInTheDocument();
    expect(screen.getByText(/vlog 优先尝试 jumpcut/)).toBeInTheDocument();
    // sourceWeek
    expect(screen.getByText(/2026-W20/)).toBeInTheDocument();
    // sampleVideoIds chips
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
  });

  it("bullets 0 条 → 不渲染 ul 列表 (actionable + sourceWeek 仍渲染)", () => {
    render(<InsightBanner data={mk({ bullets: [] })} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("建议:")).toBeInTheDocument();
    expect(screen.getByText(/2026-W20/)).toBeInTheDocument();
  });

  it("sampleVideoIds=[] → 不渲染参考视频段", () => {
    render(<InsightBanner data={mk({ sampleVideoIds: [] })} />);
    expect(screen.queryByText("参考视频:")).toBeNull();
    // headline 仍渲染
    expect(screen.getByText(/travel 赛道/)).toBeInTheDocument();
  });

  it("sampleVideoIds=1 → 1 chip", () => {
    render(<InsightBanner data={mk({ sampleVideoIds: ["only1"] })} />);
    expect(screen.getByText("only1")).toBeInTheDocument();
    expect(screen.queryByText("v2")).toBeNull();
  });

  it("sampleVideoIds=2 → 2 chips", () => {
    render(<InsightBanner data={mk({ sampleVideoIds: ["alpha", "beta"] })} />);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.queryByText("gamma")).toBeNull();
  });

  it("sampleVideoIds=3 (边界 cap) → 3 chips 都显示", () => {
    render(
      <InsightBanner
        data={mk({ sampleVideoIds: ["one", "two", "three"] })}
      />,
    );
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
    expect(screen.getByText("three")).toBeInTheDocument();
  });

  it("accessibility: aria-label = '本周爆款洞察'", () => {
    render(<InsightBanner data={mk()} />);
    expect(screen.getByLabelText("本周爆款洞察")).toBeInTheDocument();
  });

  it("bullets 单条 → 仍渲染 ul", () => {
    render(<InsightBanner data={mk({ bullets: ["唯一一条"] })} />);
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("唯一一条")).toBeInTheDocument();
  });
});
