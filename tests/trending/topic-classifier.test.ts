import { describe, expect, it, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: (...a: unknown[]) => createMock(...a) };
  },
}));

import { classifyTopics } from "@/lib/trending/topic-classifier";
import type { ViralVideo } from "@/lib/review-engine/types";

function vid(id: string, over: Partial<ViralVideo> = {}): ViralVideo {
  return {
    id,
    platform: "tiktok",
    url: `https://www.tiktok.com/@u/video/${id}`,
    cover: "",
    title: "morning workout routine",
    description: "high protein breakfast after gym",
    topic: "",
    tags: ["#fitness"],
    views: 1000,
    likes: 10,
    comments: 1,
    shares: 1,
    duration: 20,
    playStyle: "未分类",
    visualStyle: "未分类",
    hook: "h",
    bgm: "b",
    authorHandle: "@u",
    publishedAt: "2026-05-01",
    ...over,
  };
}

function mockReply(obj: unknown) {
  createMock.mockResolvedValueOnce({
    content: [{ type: "text", text: JSON.stringify(obj) }],
  });
}

beforeEach(() => {
  createMock.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("classifyTopics", () => {
  it("writes topic and topicConfidence onto each video", async () => {
    mockReply({ topic: "早餐健身", confidence: 0.92 });
    const [out] = await classifyTopics([vid("a")], ["早餐健身", "旅行 vlog"]);
    expect(out.topic).toBe("早餐健身");
    expect(out.topicConfidence).toBeCloseTo(0.92);
  });

  it("leaves topicConfidence undefined when the LLM call throws", async () => {
    createMock.mockRejectedValueOnce(new Error("api down"));
    const [out] = await classifyTopics([vid("a")], ["早餐健身"]);
    expect(out.topicConfidence).toBeUndefined();
    // 分类失败不写 topic,保留原值(空串)
    expect(out.topic).toBe("");
  });

  it("leaves topicConfidence undefined when reply JSON is malformed", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "not json" }],
    });
    const [out] = await classifyTopics([vid("a")], ["早餐健身"]);
    expect(out.topicConfidence).toBeUndefined();
  });

  it("clamps confidence into [0,1]", async () => {
    mockReply({ topic: "x", confidence: 1.7 });
    const [out] = await classifyTopics([vid("a")], ["x"]);
    expect(out.topicConfidence).toBe(1);
  });

  it("processes every video in the batch", async () => {
    mockReply({ topic: "早餐健身", confidence: 0.8 });
    mockReply({ topic: "旅行 vlog", confidence: 0.7 });
    const out = await classifyTopics([vid("a"), vid("b")], ["早餐健身", "旅行 vlog"]);
    expect(out).toHaveLength(2);
    expect(out[0].topic).toBe("早餐健身");
    expect(out[1].topic).toBe("旅行 vlog");
  });
});
