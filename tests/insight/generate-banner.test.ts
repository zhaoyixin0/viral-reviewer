import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGenerateBannerLlm = vi.hoisted(() => vi.fn());

vi.mock("@/lib/insight/insight-llm", () => ({
  generateBannerLlm: mockGenerateBannerLlm,
}));

const { generateBanner } = await import("@/lib/insight/generate-banner");
type TrendingInsight =
  import("@/lib/trending/insight-schema").TrendingInsight;
type TrendingSnapshot = import("@/lib/trending/types").TrendingSnapshot;

function mkSnapshot(insight?: TrendingInsight): TrendingSnapshot {
  const base: TrendingSnapshot = {
    schemaVersion: 2,
    week: "2026-W20",
    capturedAt: "2026-05-17T00:00:00Z",
    trendingHashtags: [],
    videos: [],
    meta: {
      tiktok: {
        source: "trends-actor",
        actorRun: "x",
        rawCount: 0,
        enrichedCount: 0,
        ok: true,
      },
      instagram: {
        source: "hashtag-proxy",
        actorRun: "y",
        rawCount: 0,
        enrichedCount: 0,
        ok: true,
      },
      partial: false,
    },
  };
  return insight !== undefined ? { ...base, insight } : base;
}

function mkInsight(overrides: Partial<TrendingInsight> = {}): TrendingInsight {
  return {
    week: "2026-W20",
    capturedAt: "2026-05-17T00:00:00Z",
    hashtagInsights: [],
    bgmInsights: [],
    eventInsights: [],
    velocity: { techniqueWoW: {}, bgmWoW: [], eventWoW: [] },
    totalEnriched: 0,
    ...overrides,
  };
}

describe("generateBanner", () => {
  beforeEach(() => {
    mockGenerateBannerLlm.mockReset();
  });

  it("snapshot=null → null", async () => {
    const result = await generateBanner({
      userFormat: "vlog",
      snapshot: null,
    });
    expect(result).toBeNull();
  });

  it("snapshot.insight=undefined(v1 老快照)→ null", async () => {
    const result = await generateBanner({
      userFormat: "vlog",
      snapshot: mkSnapshot(),
    });
    expect(result).toBeNull();
  });

  it("strategy='template' + 有 insight → 委托 renderTemplate,返回 banner", async () => {
    const result = await generateBanner({
      userFormat: "vlog",
      snapshot: mkSnapshot(
        mkInsight({
          hashtagInsights: [
            {
              name: "travel",
              videoCount: 3,
              techniqueDistribution: { jumpcut: 0.5 },
              avgDensity: 5,
              topVideoIds: ["v1"],
            },
          ],
          totalEnriched: 3,
        }),
      ),
      strategy: "template",
    });
    expect(result).not.toBeNull();
    expect(result?.headline).toContain("travel");
    expect(result?.sourceWeek).toBe("2026-W20");
  });

  it("默认 strategy(未传)走 template path", async () => {
    const result = await generateBanner({
      userFormat: "vlog",
      snapshot: mkSnapshot(
        mkInsight({
          hashtagInsights: [
            {
              name: "fitness",
              videoCount: 2,
              techniqueDistribution: {},
              avgDensity: 0,
              topVideoIds: [],
            },
          ],
        }),
      ),
    });
    expect(result?.headline).toContain("fitness");
  });

  it("strategy='llm' + LLM 成功 → 返 LLM data,sampleVideoIds 来自 caller 预算", async () => {
    mockGenerateBannerLlm.mockResolvedValue({
      week: "2026-W20",
      headline: "LLM headline",
      bullets: ["LLM bullet 1", "LLM bullet 2"],
      actionable: "LLM actionable",
      sourceWeek: "2026-W20",
      sampleVideoIds: ["v1", "v2", "v3"],
    });

    const result = await generateBanner({
      userFormat: "vlog",
      userTopic: "travel",
      snapshot: mkSnapshot(
        mkInsight({
          hashtagInsights: [
            {
              name: "travelvlog",
              videoCount: 10,
              techniqueDistribution: { jumpcut: 0.5 },
              avgDensity: 5,
              topVideoIds: ["v1", "v2", "v3", "v4"],
            },
          ],
        }),
      ),
      strategy: "llm",
    });

    expect(result).not.toBeNull();
    expect(result?.headline).toBe("LLM headline");
    expect(mockGenerateBannerLlm).toHaveBeenCalledOnce();
    // sampleVideoIds passed to LLM is caller-pre-computed from best hashtag
    expect(mockGenerateBannerLlm).toHaveBeenCalledWith(
      expect.objectContaining({ sampleVideoIds: ["v1", "v2", "v3"] }),
    );
  });

  it("strategy='llm' + LLM 返 null → fallback 到 renderTemplate(数据不丢)", async () => {
    mockGenerateBannerLlm.mockResolvedValue(null);

    const result = await generateBanner({
      userFormat: "vlog",
      snapshot: mkSnapshot(
        mkInsight({
          hashtagInsights: [
            {
              name: "fitness",
              videoCount: 3,
              techniqueDistribution: { speedup: 0.6 },
              avgDensity: 4,
              topVideoIds: ["f1"],
            },
          ],
        }),
      ),
      strategy: "llm",
    });

    // fallback path → template headline format "结合本周 [fitness 赛道] 趋势"
    expect(result).not.toBeNull();
    expect(result?.headline).toContain("fitness");
    expect(mockGenerateBannerLlm).toHaveBeenCalledOnce();
  });

  it("strategy='llm' + LLM throw(意外)→ fallback 到 renderTemplate", async () => {
    mockGenerateBannerLlm.mockRejectedValue(new Error("Unexpected"));

    const result = await generateBanner({
      userFormat: "vlog",
      snapshot: mkSnapshot(
        mkInsight({
          hashtagInsights: [
            {
              name: "asmr",
              videoCount: 1,
              techniqueDistribution: {},
              avgDensity: 0,
              topVideoIds: [],
            },
          ],
        }),
      ),
      strategy: "llm",
    }).catch(() => {
      // If generateBanner re-throws, this test will fail intentionally —
      // contract is: LLM failures must not propagate out (data-path safety).
      throw new Error("generateBanner must swallow LLM errors and fallback");
    });

    expect(result).not.toBeNull();
    expect(result?.headline).toContain("asmr");
  });

  it("userTopic 透传到 renderTemplate(命中 hashtag)", async () => {
    const result = await generateBanner({
      userFormat: "vlog",
      userTopic: "travel",
      snapshot: mkSnapshot(
        mkInsight({
          hashtagInsights: [
            {
              name: "travelvlog",
              videoCount: 5,
              techniqueDistribution: {},
              avgDensity: 0,
              topVideoIds: [],
            },
            {
              name: "fitness",
              videoCount: 3,
              techniqueDistribution: {},
              avgDensity: 0,
              topVideoIds: [],
            },
          ],
        }),
      ),
    });
    expect(result?.headline).toContain("travelvlog");
  });
});
