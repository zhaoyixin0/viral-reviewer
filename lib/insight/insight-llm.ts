import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { TrendingInsight } from "@/lib/trending/insight-schema";
import type { InsightBannerData } from "./generate-banner";

/**
 * Haiku-backed banner strategy for the InsightBanner. Returns null on any
 * failure path (API error, timeout, schema mismatch, invalid JSON, empty
 * insight) — caller is expected to fallback to the deterministic template
 * strategy so the data path never breaks (memory:
 * stage2-failure-loses-stage1.md).
 *
 * Cost guard: when the insight has no hashtag / BGM / event data, returns
 * null immediately without calling the API.
 */

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 800;
const TIMEOUT_MS = 8000;

// Loose Zod schema — fields are free-form strings, never z.enum() for LLM
// descriptive output (memory: llm-schema-looseness.md). Length floors only
// catch the pathological empty-string case. sourceWeek is built per-call
// (see buildResponseSchema) so the LLM cannot return a week different from
// the input week — schema enforcement of an attribution invariant the
// prompt only requests.
function buildResponseSchema(week: string) {
  return z.object({
    headline: z.string().min(1),
    bullets: z.array(z.string()),
    actionable: z.string().min(1),
    sourceWeek: z.literal(week),
  });
}

export type GenerateBannerLlmInput = {
  userFormat: string;
  userTopic?: string | undefined;
  insight: TrendingInsight;
  week: string;
  /** Deterministic — caller pre-computes from the chosen hashtag insight to
   * avoid LLM hallucinating non-existent video IDs. */
  sampleVideoIds: string[];
};

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

/** Test-only: clear the cached client so env-var changes take effect. */
export function __resetClientForTests(): void {
  cachedClient = null;
}

export async function generateBannerLlm(
  input: GenerateBannerLlmInput,
): Promise<InsightBannerData | null> {
  const hasData =
    input.insight.hashtagInsights.length > 0 ||
    input.insight.bgmInsights.length > 0 ||
    input.insight.eventInsights.length > 0;
  if (!hasData) return null;

  try {
    const client = getClient();
    // stream omitted → non-streaming Message. The .create() return type is a
    // union of Message | Stream; narrow with an explicit cast (the call site
    // controls stream, no overload signal reaches the inferred union).
    const result = (await withTimeout(
      client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: buildUserPrompt(input) }],
      }),
      TIMEOUT_MS,
    )) as Anthropic.Message;

    const text = extractText(result.content);
    if (!text) return null;

    const parsed = parseJsonOutput(text);
    if (parsed === null) return null;

    const validated = buildResponseSchema(input.week).safeParse(parsed);
    if (!validated.success) return null;

    return {
      week: input.week,
      headline: validated.data.headline,
      bullets: validated.data.bullets,
      actionable: validated.data.actionable,
      sourceWeek: validated.data.sourceWeek,
      sampleVideoIds: input.sampleVideoIds,
    };
  } catch {
    return null;
  }
}

function buildSystemPrompt(): string {
  return [
    "你是抖音/TikTok 短视频选题与剪辑教练。",
    "基于本周趋势数据为创作者生成精炼 banner,帮助决定本周的剪辑方向。",
    "",
    "输出严格 JSON 格式,无 markdown fence,无解释:",
    '{"headline":"一句标题(含赛道名)","bullets":["剪辑手法...","BGM Top1...","热点事件..."],"actionable":"基于数据的可执行建议(中文,< 60 字)","sourceWeek":"<week>"}',
    "",
    "约束:",
    "- bullets 0-3 条,每条 < 30 字,聚焦本周最显著的事实",
    "- actionable 一句话,引用 userFormat,不要泛泛而谈",
    "- sourceWeek 必须等于 input.week",
    "- 不要 hallucinate 数据中不存在的 hashtag / BGM / 事件",
  ].join("\n");
}

function buildUserPrompt(input: GenerateBannerLlmInput): string {
  return JSON.stringify({
    userFormat: input.userFormat,
    userTopic: input.userTopic ?? null,
    week: input.week,
    insight: input.insight,
  });
}

type AnthropicContentBlock = Anthropic.Message["content"][number];

function extractText(content: readonly AnthropicContentBlock[]): string | null {
  // Join all text blocks — Haiku is unlikely to split JSON across blocks but
  // future model behavior (or thinking blocks interleaved with text) makes
  // single-block extraction brittle. Joining preserves whole-response JSON.
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && block.text) parts.push(block.text);
  }
  if (parts.length === 0) return null;
  return parts.join("\n");
}

function parseJsonOutput(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("LLM_TIMEOUT")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
