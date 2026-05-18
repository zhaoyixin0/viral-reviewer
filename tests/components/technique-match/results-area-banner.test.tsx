// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Stub deep-lane subcomponents — this is a banner integration test, not a
// deep-lane render test. Their real implementations read fields off the
// `match` object that we intentionally stub minimally.
vi.mock("@/components/technique-match/PriorityActions", () => ({
  PriorityActions: () => null,
}));
vi.mock("@/components/technique-match/AssemblySummary", () => ({
  AssemblySummary: () => null,
}));
vi.mock("@/components/technique-match/BgmRecommendations", () => ({
  BgmRecommendations: () => null,
}));
vi.mock("@/components/technique-match/ReferenceReports", () => ({
  ReferenceReports: () => null,
}));
vi.mock("@/components/technique-match/GlobalDoNots", () => ({
  GlobalDoNots: () => null,
}));
vi.mock("@/components/technique-match/CapCutExport", () => ({
  CapCutExport: () => null,
}));
vi.mock("@/components/technique-match/UserDiagnosis", () => ({
  UserDiagnosis: () => null,
}));

import {
  AnalyzeResults,
  type AnalyzeResponseShape,
} from "@/components/technique-match/ResultsArea";
import type { InsightBannerData } from "@/lib/insight/generate-banner";
import type { StageEvent } from "@/app/review/page";
import type { TechniqueMatchingResult } from "@/lib/technique-matching/types";

function mkBanner(
  overrides: Partial<InsightBannerData> = {},
): InsightBannerData {
  return {
    week: "2026-W20",
    headline: "结合本周 [travel 赛道] 趋势",
    bullets: ["剪辑手法:jumpcut 占 50%"],
    actionable: "vlog 优先尝试 jumpcut。",
    sourceWeek: "2026-W20",
    sampleVideoIds: ["v1"],
    ...overrides,
  };
}

function mkFull(
  banner: InsightBannerData | null | undefined,
): AnalyzeResponseShape {
  return {
    userVideoIds: [],
    userPotentials: [],
    failedVideoIndexes: [],
    referenceSource: "test",
    match: {
      // Minimal cast — banner rendering doesn't read these fields, so the
      // shape stub is fine for this targeted integration test.
    } as unknown as TechniqueMatchingResult,
    ...(banner !== undefined ? { insightBanner: banner } : {}),
  };
}

function mkInsightStage(banner: InsightBannerData | null): StageEvent {
  return {
    stage: "insight",
    message: banner ? "洞察就绪" : "本周无可用趋势数据",
    data: { banner },
    time: Date.now(),
  };
}

const COMMON_PROPS = {
  loading: false,
  error: null,
  partials: [],
  videoUrls: null,
  videoFileNames: null,
};

describe("AnalyzeResults — InsightBanner integration (L3+ T6 C4 wire)", () => {
  afterEach(cleanup);

  it("full.insightBanner 给定 → banner section 渲染", () => {
    render(
      <AnalyzeResults
        {...COMMON_PROPS}
        stages={[]}
        full={mkFull(mkBanner())}
      />,
    );
    expect(screen.getByLabelText("本周爆款洞察")).toBeInTheDocument();
    expect(
      screen.getByText("结合本周 [travel 赛道] 趋势"),
    ).toBeInTheDocument();
  });

  it("full.insightBanner === null → banner section 不渲染", () => {
    render(
      <AnalyzeResults
        {...COMMON_PROPS}
        stages={[]}
        full={mkFull(null)}
      />,
    );
    expect(screen.queryByLabelText("本周爆款洞察")).toBeNull();
  });

  it("full=null + stages 含 insight banner event → 从 stages 派生显示", () => {
    // Pre-result skeleton + banner 阶段：showing banner while Opus still runs.
    render(
      <AnalyzeResults
        {...COMMON_PROPS}
        loading
        stages={[
          { stage: "load_refs", message: "loaded", time: 1 },
          {
            stage: "insight",
            message: "生成爆款洞察…",
            data: { loading: true },
            time: 2,
          },
          mkInsightStage(mkBanner({ headline: "early-stream banner" })),
        ]}
        full={null}
      />,
    );
    expect(screen.getByLabelText("本周爆款洞察")).toBeInTheDocument();
    expect(screen.getByText("early-stream banner")).toBeInTheDocument();
  });

  it("full=null + stages 只含 loading skeleton → 不渲染 banner（无 data）", () => {
    render(
      <AnalyzeResults
        {...COMMON_PROPS}
        loading
        stages={[
          {
            stage: "insight",
            message: "生成爆款洞察…",
            data: { loading: true },
            time: 1,
          },
        ]}
        full={null}
      />,
    );
    expect(screen.queryByLabelText("本周爆款洞察")).toBeNull();
  });

  it("full.insightBanner 优先于 stages（authoritative on result land）", () => {
    render(
      <AnalyzeResults
        {...COMMON_PROPS}
        stages={[mkInsightStage(mkBanner({ headline: "from stages" }))]}
        full={mkFull(mkBanner({ headline: "from full (authoritative)" }))}
      />,
    );
    expect(
      screen.getByText("from full (authoritative)"),
    ).toBeInTheDocument();
    expect(screen.queryByText("from stages")).toBeNull();
  });
});
