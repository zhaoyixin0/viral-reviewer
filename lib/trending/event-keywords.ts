/**
 * Event dictionary for the keywords strategy in event-detector.ts (T2 C5).
 *
 * Only put high-confidence event tokens here. False positives produce noisy
 * insight (memory R4 in plan §11). The LLM overlay (D1=B) is the long-term
 * source of week-by-week events; this dictionary is the always-available
 * fallback so the cron never produces a snapshot with zero events for
 * predictable seasonal moments.
 *
 * Convention: `name` is a stable identifier consumed by velocity diff; it
 * must NOT change once shipped (renames break "stable" / "ended" detection).
 * `displayName` is user-visible; safe to edit.
 *
 * Matching rules (in event-detector.ts):
 *   - case-insensitive
 *   - tokens are matched as substrings against hashtag.name AND each video's
 *     `tags` array (also normalized to lowercase, stripped of leading "#")
 *   - an event is "active" if at least one token matches in EITHER source
 */

export type EventKeyword = {
  name: string;
  displayName: string;
  tokens: string[];
};

export const EVENT_KEYWORDS: readonly EventKeyword[] = [
  {
    name: "met_gala",
    displayName: "Met Gala",
    tokens: ["metgala", "met gala", "metball"],
  },
  {
    name: "xmas",
    displayName: "Christmas",
    tokens: ["christmas", "xmas", "vlogmas", "christmasdecor"],
  },
  {
    name: "vday",
    displayName: "Valentine's Day",
    tokens: ["valentinesday", "vday", "valentine"],
  },
  {
    name: "halloween",
    displayName: "Halloween",
    tokens: ["halloween", "spookyseason", "halloweenmakeup"],
  },
  {
    name: "fashion_week",
    displayName: "Fashion Week",
    tokens: ["fashionweek", "nyfw", "lfw", "mfw", "pfw"],
  },
  {
    name: "back_to_school",
    displayName: "Back to School",
    tokens: ["backtoschool", "btsoutfits", "dormtour"],
  },
  {
    name: "lunar_new_year",
    displayName: "Lunar New Year",
    tokens: ["lunarnewyear", "chinesenewyear", "cny", "yearofthe"],
  },
] as const;
