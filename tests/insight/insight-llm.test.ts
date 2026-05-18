import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrendingInsight } from "@/lib/trending/insight-schema";

// Hoisted mock — vi.mock runs before module evaluation; class form is more
// reliable across vi.fn() constructor edge cases than mockImplementation.
const { mockCreate, MockAnthropic } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  class MockAnthropic {
    messages = { create: mockCreate };
  }
  return { mockCreate, MockAnthropic };
});

vi.mock("@anthropic-ai/sdk", () => ({
  default: MockAnthropic,
}));

const { generateBannerLlm, __resetClientForTests } = await import(
  "@/lib/insight/insight-llm"
);

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

function mkPopulatedInsight(): TrendingInsight {
  return mkInsight({
    hashtagInsights: [
      {
        name: "travelvlog",
        videoCount: 10,
        techniqueDistribution: { jumpcut: 0.5, montage: 0.3 },
        avgDensity: 6,
        topVideoIds: ["v1", "v2", "v3", "v4"],
      },
    ],
    bgmInsights: [{ name: "Sunset Drive", hitCount: 8, hitVideoIds: ["b1"] }],
    totalEnriched: 10,
  });
}

function mockResponse(text: string) {
  // Minimal shape — generateBannerLlm only reads content[].type/text.
  return { content: [{ type: "text", text }] } as never;
}

describe("generateBannerLlm", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    __resetClientForTests();
    mockCreate.mockReset();
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.useRealTimers();
  });

  it("happy path: Haiku 返合规 JSON → 返 InsightBannerData", async () => {
    mockCreate.mockResolvedValue(
      mockResponse(
        JSON.stringify({
          headline: "结合本周 [travelvlog 赛道] 趋势",
          bullets: ["剪辑手法:jumpcut 占 50%", "BGM Top1:Sunset Drive"],
          actionable: "vlog 优先尝试 jumpcut 配 Sunset Drive 蹭热度。",
          sourceWeek: "2026-W20",
        }),
      ),
    );

    const result = await generateBannerLlm({
      userFormat: "vlog",
      userTopic: "travel",
      insight: mkPopulatedInsight(),
      week: "2026-W20",
      sampleVideoIds: ["v1", "v2", "v3"],
    });

    expect(result).not.toBeNull();
    expect(result?.headline).toContain("travelvlog");
    expect(result?.bullets).toHaveLength(2);
    expect(result?.actionable).toContain("vlog");
    expect(result?.week).toBe("2026-W20");
    expect(result?.sourceWeek).toBe("2026-W20");
    // sampleVideoIds taken from caller-supplied (deterministic), not LLM
    expect(result?.sampleVideoIds).toEqual(["v1", "v2", "v3"]);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("schema fail: Haiku 返字段缺失的 JSON → null (caller fallback)", async () => {
    mockCreate.mockResolvedValue(
      mockResponse(
        JSON.stringify({
          // missing "headline" + "actionable" + "sourceWeek"
          bullets: ["剪辑手法:jumpcut 占 50%"],
        }),
      ),
    );

    const result = await generateBannerLlm({
      userFormat: "vlog",
      insight: mkPopulatedInsight(),
      week: "2026-W20",
      sampleVideoIds: ["v1"],
    });

    expect(result).toBeNull();
  });

  it("invalid JSON: Haiku 返非 JSON 文本 → null", async () => {
    mockCreate.mockResolvedValue(
      mockResponse("Sorry, I cannot generate a banner for this input."),
    );

    const result = await generateBannerLlm({
      userFormat: "vlog",
      insight: mkPopulatedInsight(),
      week: "2026-W20",
      sampleVideoIds: [],
    });

    expect(result).toBeNull();
  });

  it("markdown fence: Haiku 在 JSON 外包 ```json ... ``` 仍能 parse", async () => {
    mockCreate.mockResolvedValue(
      mockResponse(
        "```json\n" +
          JSON.stringify({
            headline: "结合本周 [travelvlog 赛道] 趋势",
            bullets: [],
            actionable: "本周暂无显著趋势。",
            sourceWeek: "2026-W20",
          }) +
          "\n```",
      ),
    );

    const result = await generateBannerLlm({
      userFormat: "vlog",
      insight: mkPopulatedInsight(),
      week: "2026-W20",
      sampleVideoIds: [],
    });

    expect(result).not.toBeNull();
    expect(result?.headline).toContain("travelvlog");
  });

  it("API error: messages.create throw → null", async () => {
    mockCreate.mockRejectedValue(new Error("Rate limit"));

    const result = await generateBannerLlm({
      userFormat: "vlog",
      insight: mkPopulatedInsight(),
      week: "2026-W20",
      sampleVideoIds: [],
    });

    expect(result).toBeNull();
  });

  it("timeout: pending Promise → null after 8s", async () => {
    vi.useFakeTimers();
    // create never resolves — timeout race wins
    mockCreate.mockReturnValue(new Promise(() => {}));

    const promise = generateBannerLlm({
      userFormat: "vlog",
      insight: mkPopulatedInsight(),
      week: "2026-W20",
      sampleVideoIds: [],
    });

    await vi.advanceTimersByTimeAsync(8001);
    const result = await promise;

    expect(result).toBeNull();
  });

  it("empty insight: 无 hashtag/bgm/event → 直接 null 不调 LLM (省成本)", async () => {
    const result = await generateBannerLlm({
      userFormat: "vlog",
      insight: mkInsight(), // empty arrays
      week: "2026-W20",
      sampleVideoIds: [],
    });

    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("missing ANTHROPIC_API_KEY: throw at getClient → null", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    __resetClientForTests();

    const result = await generateBannerLlm({
      userFormat: "vlog",
      insight: mkPopulatedInsight(),
      week: "2026-W20",
      sampleVideoIds: [],
    });

    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
