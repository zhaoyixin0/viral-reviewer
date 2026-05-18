import { describe, expect, it } from "vitest";
import {
  MIN_FUZZY_LENGTH,
  findBestHashtag,
} from "@/lib/insight/hashtag-match";
import type { HashtagInsight } from "@/lib/trending/insight-schema";

function mk(name: string, topVideoIds: string[] = []): HashtagInsight {
  return {
    name,
    videoCount: 1,
    techniqueDistribution: {},
    avgDensity: 0,
    topVideoIds,
  };
}

describe("findBestHashtag", () => {
  it("empty insights → null (with or without topic)", () => {
    expect(findBestHashtag([], "anything")).toBeNull();
    expect(findBestHashtag([], undefined)).toBeNull();
  });

  it("no userTopic → insights[0]", () => {
    expect(findBestHashtag([mk("alpha"), mk("beta")], undefined)?.name).toBe(
      "alpha",
    );
  });

  it("forward match: hashtag name 含 user topic", () => {
    expect(
      findBestHashtag([mk("travel"), mk("travelvlog")], "vlog")?.name,
    ).toBe("travelvlog");
  });

  it("reverse match (name >= 3 chars): user topic 含 hashtag name", () => {
    expect(
      findBestHashtag(
        [mk("fitness"), mk("travel")],
        "travel adventure 2026",
      )?.name,
    ).toBe("travel");
  });

  it("reverse match 不允许 name < 3 chars (避免 'go' 误命中 'ego')", () => {
    // name="go" (2 chars) must NOT reverse-match topic="ego";
    // with no fuzzy hit, falls back to insights[0].
    expect(findBestHashtag([mk("fitness"), mk("go")], "ego")?.name).toBe(
      "fitness",
    );
  });

  it("case insensitive both directions", () => {
    expect(findBestHashtag([mk("Travel")], "TRIP travel ADVENTURE")?.name).toBe(
      "Travel",
    );
    expect(findBestHashtag([mk("TravelVlog")], "vlog")?.name).toBe(
      "TravelVlog",
    );
  });

  it("userTopic 不命中 → fallback insights[0]", () => {
    expect(
      findBestHashtag([mk("fitness"), mk("cooking")], "anime")?.name,
    ).toBe("fitness");
  });

  it("MIN_FUZZY_LENGTH exported constant = 3", () => {
    expect(MIN_FUZZY_LENGTH).toBe(3);
  });
});
