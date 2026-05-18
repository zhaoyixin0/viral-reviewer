import { describe, expect, it, vi, beforeEach } from "vitest";

const actorCallMock = vi.fn();
const listItemsMock = vi.fn();

vi.mock("@/lib/apify/client", () => ({
  getApifyClient: () => ({
    actor: (_id: string) => ({ call: (...a: unknown[]) => actorCallMock(...a) }),
    dataset: (_id: string) => ({ listItems: (...a: unknown[]) => listItemsMock(...a) }),
  }),
}));

import {
  scrapeTikTokByHashtag,
  scrapeInstagramByHashtag,
  scrapeTikTokTrendingHashtags,
} from "@/lib/apify/scrapers";

beforeEach(() => {
  actorCallMock.mockReset();
  listItemsMock.mockReset();
});

// Helper: an unresolved promise we can use to keep the SDK call pending so the
// race wrapper has time to observe the abort.
function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

describe("scrapeTikTokByHashtag — AbortSignal handling", () => {
  it("rejects immediately with AbortError when signal is already aborted", async () => {
    actorCallMock.mockResolvedValue({ id: "run", defaultDatasetId: "ds" });
    listItemsMock.mockResolvedValue({ items: [] });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      scrapeTikTokByHashtag({ hashtags: ["x"], topic: "", signal: ctrl.signal }),
    ).rejects.toThrowError(/Aborted/);
  });

  it("rejects with AbortError when signal aborts mid-flight", async () => {
    actorCallMock.mockReturnValue(neverResolves());
    const ctrl = new AbortController();
    const p = scrapeTikTokByHashtag({
      hashtags: ["x"],
      topic: "",
      signal: ctrl.signal,
    });
    queueMicrotask(() => ctrl.abort());
    await expect(p).rejects.toThrowError(/Aborted/);
  });

  it("works normally when no signal is provided", async () => {
    actorCallMock.mockResolvedValue({ id: "run", defaultDatasetId: "ds" });
    listItemsMock.mockResolvedValue({ items: [] });
    const out = await scrapeTikTokByHashtag({ hashtags: ["x"], topic: "" });
    expect(out).toEqual([]);
  });
});

describe("scrapeInstagramByHashtag — AbortSignal handling", () => {
  it("rejects immediately with AbortError when signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      scrapeInstagramByHashtag({ hashtags: ["x"], topic: "", signal: ctrl.signal }),
    ).rejects.toThrowError(/Aborted/);
  });

  it("rejects with AbortError when signal aborts during dataset fetch", async () => {
    actorCallMock.mockResolvedValue({ id: "run", defaultDatasetId: "ds" });
    listItemsMock.mockReturnValue(neverResolves());
    const ctrl = new AbortController();
    const p = scrapeInstagramByHashtag({
      hashtags: ["x"],
      topic: "",
      signal: ctrl.signal,
    });
    queueMicrotask(() => ctrl.abort());
    await expect(p).rejects.toThrowError(/Aborted/);
  });
});

describe("scrapeTikTokTrendingHashtags — AbortSignal handling", () => {
  it("rejects immediately with AbortError when signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      scrapeTikTokTrendingHashtags({ maxItems: 10, signal: ctrl.signal }),
    ).rejects.toThrowError(/Aborted/);
  });

  it("rejects with AbortError when signal aborts during actor call", async () => {
    actorCallMock.mockReturnValue(neverResolves());
    const ctrl = new AbortController();
    const p = scrapeTikTokTrendingHashtags({
      maxItems: 10,
      signal: ctrl.signal,
    });
    queueMicrotask(() => ctrl.abort());
    await expect(p).rejects.toThrowError(/Aborted/);
  });

  it("returns hashtags normally when not aborted", async () => {
    actorCallMock.mockResolvedValue({ id: "run-123", defaultDatasetId: "ds" });
    listItemsMock.mockResolvedValue({ items: [] });
    const out = await scrapeTikTokTrendingHashtags({ maxItems: 10 });
    expect(out.runId).toBe("run-123");
    expect(out.hashtags).toEqual([]);
  });
});
