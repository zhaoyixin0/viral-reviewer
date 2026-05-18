import type { HashtagInsight } from "@/lib/trending/insight-schema";

/**
 * Asymmetric fuzzy match between a user-supplied topic and the hashtag
 * insights list. Forward direction always (hashtag name contains user topic
 * substring); reverse direction (user topic contains hashtag name) only when
 * the hashtag name is at least MIN_FUZZY_LENGTH chars long, to avoid false
 * positives like name="go" matching topic="ego" or name="or" matching
 * topic="tutorial".
 *
 * Falls back to insights[0] when a topic is supplied but no fuzzy hit lands.
 * Returns insights[0] directly when no topic is supplied. Returns null on an
 * empty insights array.
 *
 * Single source of truth shared by:
 * - `lib/insight/insight-template.ts` renderTemplate (best hashtag for
 *    headline + bullets)
 * - `lib/insight/generate-banner.ts` pickSampleVideoIds (LLM path supplies
 *    deterministic sampleVideoIds independent of LLM output)
 *
 * Keeping the LLM path and template path on the same selection logic
 * guarantees they emit the same sampleVideoIds for a given input.
 */
export const MIN_FUZZY_LENGTH = 3;

export function findBestHashtag(
  insights: readonly HashtagInsight[],
  userTopic: string | undefined,
): HashtagInsight | null {
  if (insights.length === 0) return null;
  if (userTopic) {
    const lower = userTopic.toLowerCase();
    const hit = insights.find((h) => {
      const name = h.name.toLowerCase();
      if (name.includes(lower)) return true;
      return name.length >= MIN_FUZZY_LENGTH && lower.includes(name);
    });
    if (hit) return hit;
  }
  return insights[0] ?? null;
}
