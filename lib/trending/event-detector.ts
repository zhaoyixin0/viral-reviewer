import "server-only";
import { GoogleGenAI, createUserContent } from "@google/genai";
import { z } from "zod";
import type { ViralVideo } from "@/lib/review-engine/types";
import { createLogger } from "@/lib/observability/structured-log";
import { EVENT_KEYWORDS, type EventKeyword } from "./event-keywords";
import type { EventInsight } from "./insight-schema";
import type { TrendingHashtag } from "./types";

const log = createLogger({ module: "trending/event-detector" });

/**
 * Event detection layer (T2 C5, plan §3.3 C, D1=B).
 *
 * Dual strategy:
 *   - keywords (always available, sync): scans hashtag names + per-video tags
 *     against EVENT_KEYWORDS dictionary
 *   - llm (D1=B, async, optional): one Gemini Pro call per cron run that
 *     reads this week's top hashtag names + sample titles and returns active
 *     events list (loose Zod schema per memory llm-schema-looseness)
 *
 * Default behaviour: keywords are always evaluated first as a deterministic
 * floor. If `useLLM=true` (default in production cron) we *overlay* the LLM
 * findings on top — same `name` merges (LLM displayName + matchedHashtags
 * win), new `name` appends. LLM failure logs + falls back to keywords result
 * with no user-visible error.
 */

const LLMEventSchema = z
  .object({
    name: z.string().min(1),
    displayName: z.string().min(1),
    matchedHashtags: z.array(z.string()).default([]),
  })
  .passthrough();

const LLMResponseSchema = z
  .object({
    events: z.array(LLMEventSchema).default([]),
  })
  .passthrough();

export type DetectEventsInput = {
  trendingHashtags: TrendingHashtag[];
  enrichedVideos: ViralVideo[];
  /** Pre-detection: 1 = D1=B LLM overlay enabled. */
  useLLM?: boolean;
  signal?: AbortSignal;
};

function normalize(token: string): string {
  return token.toLowerCase().replace(/^#+/, "").replace(/\s+/g, "");
}

/** True iff any token appears as a substring of any candidate (post-normalize). */
function tokenHit(tokens: string[], candidates: string[]): boolean {
  const normCandidates = candidates.map(normalize).filter(Boolean);
  for (const t of tokens) {
    const nt = normalize(t);
    if (!nt) continue;
    if (normCandidates.some((c) => c.includes(nt))) return true;
  }
  return false;
}

function matchingHashtagsForEvent(
  ev: EventKeyword,
  hashtags: TrendingHashtag[],
): string[] {
  const out: string[] = [];
  for (const h of hashtags) {
    if (tokenHit(ev.tokens, [h.name])) out.push(h.name);
  }
  return out;
}

function detectEventsKeywords(input: DetectEventsInput): EventInsight[] {
  const out: EventInsight[] = [];
  for (const ev of EVENT_KEYWORDS) {
    const matchedHashtags = matchingHashtagsForEvent(ev, input.trendingHashtags);
    const matchedVideos = input.enrichedVideos.filter((v) =>
      tokenHit(ev.tokens, [...(v.tags ?? []), v.title ?? ""]),
    );
    if (matchedHashtags.length === 0 && matchedVideos.length === 0) continue;
    out.push({
      name: ev.name,
      displayName: ev.displayName,
      matchedHashtags,
      matchedVideoCount: matchedVideos.length,
      sampleVideoIds: matchedVideos.slice(0, 3).map((v) => v.id),
    });
  }
  return out;
}

/**
 * Fresh client per call (W3 C8 P0). A module-level singleton would survive
 * env-var rotation (e.g. ops swapping GOOGLE_API_KEY mid-process or test
 * suites mutating process.env between cases). Construction cost is a small
 * struct allocation — negligible next to the network round-trip.
 */
function getClient(): GoogleGenAI | null {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

async function detectEventsLLM(
  input: DetectEventsInput,
): Promise<EventInsight[] | null> {
  const ai = getClient();
  if (!ai) return null;

  const hashtagLines = input.trendingHashtags
    .slice(0, 30)
    .map((h, i) => `${i + 1}. #${h.name} (rank ${h.rank})`)
    .join("\n");
  const sampleTitles = input.enrichedVideos
    .slice(0, 15)
    .map((v) => `- ${v.title}`)
    .join("\n");

  const model = process.env.TRENDING_EVENT_MODEL || "gemini-2.5-pro";
  const systemInstruction = `You identify active cultural / seasonal / fashion events that explain spikes in TikTok and Instagram trending hashtags this week.
Return strict JSON: { "events": [ { "name": "snake_case_id", "displayName": "Human Readable", "matchedHashtags": ["tag1","tag2"] } ] }.
Only list events you can support with at least one hashtag from the input. Use a stable snake_case identifier for "name" (e.g. met_gala, lunar_new_year). Skip generic categories like "fashion" or "food".`;

  const userPrompt = `This week's trending hashtags:
${hashtagLines}

Sample titles from enriched videos:
${sampleTitles}

Return active events only.`;

  let raw: string;
  try {
    // W3 C8 P2: @google/genai SDK's GenerateContentConfig.abortSignal is the
    // documented hook (verified via node_modules/@google/genai/dist/genai.d.ts:4207).
    // SDK note: "AbortSignal is a client-only operation … will not cancel the
    // request in the service. You will still be charged usage for any applicable
    // operations." — we accept that trade-off: cancellation here is about freeing
    // the cron route's await, not avoiding spend.
    const response = await ai.models.generateContent({
      model,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.2,
        ...(input.signal ? { abortSignal: input.signal } : {}),
      },
      contents: createUserContent([userPrompt]),
    });
    // Belt-and-suspenders: even with abortSignal wired, an early-aborted promise
    // can resolve with stale text before throwing — re-check before parsing.
    if (input.signal?.aborted) return null;
    raw = (response.text ?? "").trim();
    if (!raw) {
      log.warn("event-detector LLM empty response");
      return null;
    }
  } catch (e) {
    log.warn("event-detector LLM call failed", { err: e });
    return null;
  }

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  let parsed: z.infer<typeof LLMResponseSchema>;
  try {
    parsed = LLMResponseSchema.parse(JSON.parse(cleaned));
  } catch (e) {
    log.warn("event-detector LLM parse failed", { err: e, sample: cleaned.slice(0, 200) });
    return null;
  }

  return parsed.events.map((ev) => {
    const matchedHashtagSet = new Set(ev.matchedHashtags.map((h) => h.replace(/^#+/, "")));
    const matchedVideos = input.enrichedVideos.filter((v) => {
      for (const t of v.tags ?? []) {
        if (matchedHashtagSet.has(t.replace(/^#+/, ""))) return true;
      }
      return false;
    });
    return {
      name: ev.name,
      displayName: ev.displayName,
      matchedHashtags: Array.from(matchedHashtagSet),
      matchedVideoCount: matchedVideos.length,
      sampleVideoIds: matchedVideos.slice(0, 3).map((v) => v.id),
    };
  });
}

/**
 * Merge two event lists by `name`. LLM entry wins on conflict for
 * displayName / matchedHashtags (LLM gets the more current label);
 * matchedVideoCount + sampleVideoIds are recomputed from the union of
 * matchedHashtags via a final keyword-style pass.
 */
function mergeEvents(
  base: EventInsight[],
  overlay: EventInsight[],
): EventInsight[] {
  const byName = new Map<string, EventInsight>();
  for (const e of base) byName.set(e.name, e);
  for (const e of overlay) {
    const existing = byName.get(e.name);
    if (!existing) {
      byName.set(e.name, e);
    } else {
      byName.set(e.name, {
        ...existing,
        displayName: e.displayName,
        matchedHashtags: Array.from(
          new Set([...existing.matchedHashtags, ...e.matchedHashtags]),
        ),
        matchedVideoCount: Math.max(
          existing.matchedVideoCount,
          e.matchedVideoCount,
        ),
        sampleVideoIds: existing.sampleVideoIds.length
          ? existing.sampleVideoIds
          : e.sampleVideoIds,
      });
    }
  }
  return Array.from(byName.values());
}

export async function detectEvents(
  input: DetectEventsInput,
): Promise<EventInsight[]> {
  const keywordResult = detectEventsKeywords(input);
  if (!input.useLLM) return keywordResult;

  const llmResult = await detectEventsLLM(input);
  if (llmResult === null) return keywordResult;
  return mergeEvents(keywordResult, llmResult);
}

/** Test-only export of the keyword strategy (no Gemini dependency). */
export const __test = { detectEventsKeywords };
