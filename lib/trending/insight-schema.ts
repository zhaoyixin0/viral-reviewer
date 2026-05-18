import { z } from "zod";

/**
 * TrendingInsight — aggregate report layer on top of the raw v1 snapshot.
 *
 * Sits inside TrendingSnapshot v2 as the optional `insight` field. Designed to
 * be forward-compatible: every container uses `.passthrough()` so writers can
 * add fields without breaking readers, and old v1 snapshots (no `insight`) parse
 * without error (the field is `.optional()` at the snapshot layer).
 *
 * SCHEMA DESIGN NOTES (read before adding fields):
 *
 * 1. BgmInsight.name is `z.string()`, NOT enum — BGM titles are free-form
 *    text (per memory llm-schema-looseness + lib/cut-plan/schema.ts RULE 1).
 * 2. EventInsight.name is `z.string()` so the dictionary in event-keywords.ts
 *    (and the future Gemini-Pro overlay, D1=B) can introduce new event keys
 *    week-over-week without a schema bump.
 * 3. VelocityInsight.{bgmWoW,eventWoW}.trend uses z.enum because these tags
 *    are computed by aggregate.ts deterministically, not LLM-derived. Adding
 *    a tag is a code change that should trip a type error.
 * 4. .default([]) on arrays / {} on records is safe per CutPlan schema RULE 3
 *    (default on arrays / records is fine; only enum-like free-text fields
 *    need to avoid it).
 * 5. Numeric ranges are validated (0..1 for distribution, 0..100 for density)
 *    so a writer bug surfaces immediately instead of corrupting the snapshot.
 */

export const HashtagInsightSchema = z
  .object({
    name: z.string(),
    videoCount: z.number().int().min(0),
    /** Technique frequency distribution, normalized to sum ~= 1.0. */
    techniqueDistribution: z
      .record(z.string(), z.number().min(0).max(1))
      .default({}),
    /** Mean of CutPlan.density.overall across the hashtag's enriched videos. */
    avgDensity: z.number().min(0).max(100).default(0),
    /** Top videos within the hashtag, by views (≤3 IDs). */
    topVideoIds: z.array(z.string()).default([]),
  })
  .passthrough();

export type HashtagInsight = z.infer<typeof HashtagInsightSchema>;

export const BgmInsightSchema = z
  .object({
    name: z.string(),
    hitCount: z.number().int().min(0),
    hitVideoIds: z.array(z.string()).default([]),
    /** Gemini's trending flag from CutPlan.bgm.trending, when present. */
    trending: z.boolean().nullable().optional(),
  })
  .passthrough();

export type BgmInsight = z.infer<typeof BgmInsightSchema>;

export const EventInsightSchema = z
  .object({
    /** Dictionary key — stable identifier, e.g. "met_gala". */
    name: z.string(),
    /** Human-readable label, e.g. "Met Gala 2026". */
    displayName: z.string(),
    matchedHashtags: z.array(z.string()).default([]),
    matchedVideoCount: z.number().int().min(0),
    sampleVideoIds: z.array(z.string()).default([]),
  })
  .passthrough();

export type EventInsight = z.infer<typeof EventInsightSchema>;

export const BgmWoWEntrySchema = z
  .object({
    name: z.string(),
    trend: z.enum(["rising", "stable", "falling", "new"]),
    deltaHits: z.number(),
  })
  .passthrough();

export const EventWoWEntrySchema = z
  .object({
    name: z.string(),
    trend: z.enum(["new", "stable", "ended"]),
  })
  .passthrough();

export const VelocityInsightSchema = z
  .object({
    /** Per-technique week-over-week share delta. Empty when no prior snapshot. */
    techniqueWoW: z.record(z.string(), z.number()).default({}),
    bgmWoW: z.array(BgmWoWEntrySchema).default([]),
    eventWoW: z.array(EventWoWEntrySchema).default([]),
  })
  .passthrough();

export type VelocityInsight = z.infer<typeof VelocityInsightSchema>;

export const TrendingInsightSchema = z
  .object({
    /** ISO week identifier, mirrors the parent snapshot's week. */
    week: z.string(),
    /** ISO timestamp when aggregation ran. */
    capturedAt: z.string(),
    hashtagInsights: z.array(HashtagInsightSchema).default([]),
    bgmInsights: z.array(BgmInsightSchema).default([]),
    eventInsights: z.array(EventInsightSchema).default([]),
    velocity: VelocityInsightSchema,
    /** Number of videos enrichBatch successfully turned into CutPlans this week. */
    totalEnriched: z.number().int().min(0),
  })
  .passthrough();

export type TrendingInsight = z.infer<typeof TrendingInsightSchema>;

/**
 * Construct an empty (no-data) insight for the given week. Used when
 * enrichBatch returns zero plans — keeps the snapshot writable (with raw
 * videos preserved) while signalling that no aggregation succeeded.
 */
export function emptyInsight(week: string): TrendingInsight {
  return {
    week,
    capturedAt: new Date().toISOString(),
    hashtagInsights: [],
    bgmInsights: [],
    eventInsights: [],
    velocity: { techniqueWoW: {}, bgmWoW: [], eventWoW: [] },
    totalEnriched: 0,
  };
}
