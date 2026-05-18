import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ViralVideo } from "@/lib/review-engine/types";
import type { TrendingHashtag } from "@/lib/trending/types";

const generateContentMock = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: (...a: unknown[]) => generateContentMock(...a) };
  },
  createUserContent: (parts: unknown) => parts,
  createPartFromUri: (uri: string, mime: string) => ({ uri, mime }),
}));

import { detectEvents, __test } from "@/lib/trending/event-detector";

function vid(id: string, tags: string[], title = id): ViralVideo {
  return {
    id, platform: "tiktok", url: `https://x/${id}`, cover: "", title,
    description: "", topic: "", tags,
    views: 1000, likes: 0, comments: 0, shares: 0, duration: 25,
    playStyle: "未分类", visualStyle: "未分类", hook: "",
    bgm: "", authorHandle: "@u", publishedAt: "2026-05-10",
  };
}

function ht(name: string, rank = 1): TrendingHashtag {
  return { name, rank, viewCount: 1000, videoCount: 10, rankDiff: 0, isNew: false };
}

beforeEach(() => {
  generateContentMock.mockReset();
  delete process.env.GOOGLE_API_KEY;
});

describe("detectEventsKeywords (deterministic strategy)", () => {
  it("matches a hashtag against the keyword dictionary (case-insensitive)", () => {
    const r = __test.detectEventsKeywords({
      trendingHashtags: [ht("MetGala")],
      enrichedVideos: [],
    });
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("met_gala");
    expect(r[0].displayName).toBe("Met Gala");
    expect(r[0].matchedHashtags).toEqual(["MetGala"]);
  });

  it("matches via video tags when hashtags don't carry the keyword", () => {
    const r = __test.detectEventsKeywords({
      trendingHashtags: [ht("unrelated")],
      enrichedVideos: [vid("v1", ["#vlogmas", "#cozy"])],
    });
    expect(r.find((e) => e.name === "xmas")).toBeDefined();
  });

  it("ignores '#' prefix on hashtag tokens", () => {
    const r = __test.detectEventsKeywords({
      trendingHashtags: [],
      enrichedVideos: [vid("v1", ["#valentine"])],
    });
    expect(r.find((e) => e.name === "vday")).toBeDefined();
  });

  it("returns empty list when nothing matches", () => {
    const r = __test.detectEventsKeywords({
      trendingHashtags: [ht("foryou"), ht("morningroutine")],
      enrichedVideos: [vid("v1", ["#fitness"])],
    });
    expect(r).toEqual([]);
  });

  it("samples up to 3 matched videos per event", () => {
    const r = __test.detectEventsKeywords({
      trendingHashtags: [],
      enrichedVideos: [
        vid("a", ["#halloween"]),
        vid("b", ["#halloween"]),
        vid("c", ["#spookyseason"]),
        vid("d", ["#halloween"]),
        vid("e", ["#halloween"]),
      ],
    });
    const halloween = r.find((e) => e.name === "halloween");
    expect(halloween?.sampleVideoIds.length).toBe(3);
    expect(halloween?.matchedVideoCount).toBe(5);
  });

  it("matches when tokens contain spaces (collapsed to non-space)", () => {
    const r = __test.detectEventsKeywords({
      trendingHashtags: [ht("metball")],
      enrichedVideos: [],
    });
    expect(r.find((e) => e.name === "met_gala")).toBeDefined();
  });
});

describe("detectEvents (public, useLLM=false)", () => {
  it("returns keyword-only result when useLLM is omitted / false", async () => {
    const r = await detectEvents({
      trendingHashtags: [ht("MetGala")],
      enrichedVideos: [],
      useLLM: false,
    });
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("met_gala");
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});

describe("detectEvents (public, useLLM=true with LLM mocked)", () => {
  beforeEach(() => {
    process.env.GOOGLE_API_KEY = "fake-test-key";
  });

  it("merges LLM events with keyword events (LLM displayName wins on conflict)", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        events: [
          {
            name: "met_gala",
            displayName: "Met Gala 2026 (Sleeping Beauties)",
            matchedHashtags: ["MetGala", "MetGala2026"],
          },
          {
            name: "summer_solstice",
            displayName: "Summer Solstice",
            matchedHashtags: ["summersolstice"],
          },
        ],
      }),
    });

    const r = await detectEvents({
      trendingHashtags: [ht("MetGala"), ht("summersolstice")],
      enrichedVideos: [vid("v1", ["#metgala"])],
      useLLM: true,
    });

    const byName = Object.fromEntries(r.map((e) => [e.name, e]));
    expect(byName["met_gala"].displayName).toBe("Met Gala 2026 (Sleeping Beauties)");
    expect(byName["met_gala"].matchedHashtags).toEqual(
      expect.arrayContaining(["MetGala", "MetGala2026"]),
    );
    expect(byName["summer_solstice"]).toBeDefined();
  });

  it("falls back to keywords when LLM throws", async () => {
    generateContentMock.mockRejectedValueOnce(new Error("Gemini 500"));

    const r = await detectEvents({
      trendingHashtags: [ht("xmas")],
      enrichedVideos: [],
      useLLM: true,
    });

    expect(r.find((e) => e.name === "xmas")).toBeDefined();
  });

  it("falls back to keywords when LLM returns empty text", async () => {
    generateContentMock.mockResolvedValueOnce({ text: "" });

    const r = await detectEvents({
      trendingHashtags: [ht("Halloween")],
      enrichedVideos: [],
      useLLM: true,
    });

    expect(r.find((e) => e.name === "halloween")).toBeDefined();
  });

  it("falls back to keywords when LLM response is invalid JSON", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: "not valid json at all",
    });

    const r = await detectEvents({
      trendingHashtags: [ht("vlogmas")],
      enrichedVideos: [],
      useLLM: true,
    });

    expect(r.find((e) => e.name === "xmas")).toBeDefined();
  });

  it("falls back to keywords when LLM JSON fails loose Zod schema", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({ events: [{ noNameField: true }] }),
    });

    const r = await detectEvents({
      trendingHashtags: [ht("xmas")],
      enrichedVideos: [],
      useLLM: true,
    });

    expect(r.find((e) => e.name === "xmas")).toBeDefined();
  });

  it("loose Zod: tolerates extra fields in LLM event objects", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        events: [
          {
            name: "novel_2027",
            displayName: "Novel Event",
            matchedHashtags: ["novel"],
            futureField: { score: 0.9 },
          },
        ],
        analystNotes: "extra top-level OK too",
      }),
    });

    const r = await detectEvents({
      trendingHashtags: [ht("novel")],
      enrichedVideos: [],
      useLLM: true,
    });

    expect(r.find((e) => e.name === "novel_2027")).toBeDefined();
  });

  it("when GOOGLE_API_KEY is absent, useLLM is a no-op (keywords only)", async () => {
    delete process.env.GOOGLE_API_KEY;

    const r = await detectEvents({
      trendingHashtags: [ht("MetGala")],
      enrichedVideos: [],
      useLLM: true,
    });

    expect(generateContentMock).not.toHaveBeenCalled();
    expect(r.find((e) => e.name === "met_gala")).toBeDefined();
  });

  it("strips markdown ``` fences from LLM response before parsing", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: '```json\n{ "events": [ { "name": "novel", "displayName": "Novel", "matchedHashtags": [] } ] }\n```',
    });

    const r = await detectEvents({
      trendingHashtags: [],
      enrichedVideos: [],
      useLLM: true,
    });

    expect(r.find((e) => e.name === "novel")).toBeDefined();
  });

  it("LLM event recomputes matchedVideoCount/sampleVideoIds from input videos", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        events: [
          {
            name: "novel_event",
            displayName: "Novel Event",
            matchedHashtags: ["#novel"],
          },
        ],
      }),
    });

    const r = await detectEvents({
      trendingHashtags: [],
      enrichedVideos: [
        vid("v1", ["#novel"]),
        vid("v2", ["#novel"]),
        vid("v3", ["#unrelated"]),
      ],
      useLLM: true,
    });

    const novel = r.find((e) => e.name === "novel_event")!;
    expect(novel.matchedVideoCount).toBe(2);
    expect(novel.sampleVideoIds.sort()).toEqual(["v1", "v2"]);
  });
});
