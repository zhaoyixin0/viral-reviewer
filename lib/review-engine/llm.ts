import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { REVIEW_SYSTEM_PROMPT } from "./system-prompt";
import { similarityScore, type VideoSignature } from "./retrieval";
import type {
  ReviewInput,
  ReviewResult,
  ViralFormula,
  ViralVideo,
} from "./types";

export type LLMProvider = "anthropic" | "openai";

export type LLMSelection = {
  provider: LLMProvider;
  modelId: string;
};

/**
 * 选择可用的 LLM。优先级：Anthropic Claude Opus 4.7 > OpenAI gpt-4o > null。
 */
export function selectModel(): LLMSelection | null {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      modelId: process.env.ANTHROPIC_MODEL || "claude-opus-4-7",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      modelId: process.env.OPENAI_MODEL || "gpt-4o",
    };
  }
  return null;
}

let anthropicClient: Anthropic | null = null;
function getAnthropic() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

let openaiClient: OpenAI | null = null;
function getOpenAI() {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

export function buildVideoSignature(
  input: ReviewInput,
): VideoSignature | undefined {
  if (input.type === "text") {
    if (input.draft && input.draft.trim()) {
      return { hook: input.draft.slice(0, 120) };
    }
    return undefined;
  }
  const f = input.videoFeatures;
  return {
    playStyle: f.detectedPlayStyle,
    visualStyle: f.detectedVisualStyle,
    hook: f.detectedHook,
    duration: f.duration,
  };
}

type SignatureSummary = {
  topic: string;
  audience: string;
  scene: string;
  playStyle?: string;
  visualStyle?: string;
  hook?: string;
  duration?: number;
  transcriptHighlight?: string;
  draftHighlight?: string;
};

function buildSignatureSummary(
  input: ReviewInput,
  sig: VideoSignature | undefined,
): SignatureSummary {
  return {
    topic: input.topic,
    audience: input.audience,
    scene: input.scene,
    playStyle: sig?.playStyle,
    visualStyle: sig?.visualStyle,
    hook: sig?.hook,
    duration: sig?.duration,
    transcriptHighlight:
      input.type === "video"
        ? input.videoFeatures.transcript.slice(0, 280) || undefined
        : undefined,
    draftHighlight:
      input.type === "text" ? input.draft?.slice(0, 280) : undefined,
  };
}

type AnnotatedVideo = {
  matchTag?: "closest" | "contrast";
  matchScore?: number;
  platform: ViralVideo["platform"];
  title: string;
  description: string;
  topic: string;
  tags: string[];
  views: number;
  likes: number;
  duration: number;
  playStyle: string;
  visualStyle: string;
  hook: string;
  bgm: string;
  author: string;
};

function annotateMatch(
  videos: ViralVideo[],
  sig: VideoSignature | undefined,
): AnnotatedVideo[] {
  const hasSig = !!(
    sig &&
    (sig.playStyle || sig.visualStyle || sig.hook || sig.duration)
  );

  const baseProjection = (v: ViralVideo): AnnotatedVideo => ({
    platform: v.platform,
    title: v.title,
    description: v.description,
    topic: v.topic,
    tags: v.tags,
    views: v.views,
    likes: v.likes,
    duration: v.duration,
    playStyle: v.playStyle,
    visualStyle: v.visualStyle,
    hook: v.hook,
    bgm: v.bgm,
    author: v.authorHandle,
  });

  if (!hasSig) return videos.map(baseProjection);

  const scored = videos.map((v) => ({
    v,
    sim: similarityScore(v, sig as VideoSignature),
  }));
  const sorted = [...scored].sort((a, b) => b.sim - a.sim);
  const half = Math.ceil(sorted.length / 2);
  const closestIds = new Set(sorted.slice(0, half).map((x) => x.v.id));
  const simById = new Map(scored.map((s) => [s.v.id, s.sim]));

  return videos.map((v) => ({
    ...baseProjection(v),
    matchTag: closestIds.has(v.id) ? "closest" : "contrast",
    matchScore: Number((simById.get(v.id) ?? 0).toFixed(3)),
  }));
}

function buildUserPayload(args: {
  input: ReviewInput;
  videos: ViralVideo[];
  formula: ViralFormula;
  matched: boolean;
}) {
  const sig = buildVideoSignature(args.input);
  return JSON.stringify(
    {
      userInput: args.input,
      videoSignature: buildSignatureSummary(args.input, sig),
      benchmark: {
        topicMatched: args.matched,
        topicMatchNote: args.matched
          ? "下方 viralVideos 是同题材真实 top-K，已根据这条视频的风格分成 closest（最像，正面对标）和 contrast（最不像，反差/破局对标）两类。请按 system prompt 的差异化定位流程使用。"
          : `数据库中没有"${args.input.topic}"的同题材样本，下方 viralVideos 是平台跨题材的高互动爆款，仅作通用规律参考。请基于 ground truth 中的算法逻辑、钩子原理、身份认同、彩蛋设计等通用规律给出建议，不要硬套这些视频的具体玩法。`,
        viralVideos: annotateMatch(args.videos, sig),
        commonalities: args.formula,
      },
    },
    null,
    2,
  );
}

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
}

/**
 * 调用 LLM 生成评审结果。期望返回严格 JSON。
 */
export async function generateReviewWithLLM(args: {
  input: ReviewInput;
  videos: ViralVideo[];
  formula: ViralFormula;
  matched: boolean;
  selection: LLMSelection;
}): Promise<ReviewResult> {
  const userPayload = buildUserPayload(args);

  if (args.selection.provider === "anthropic") {
    const client = getAnthropic();
    const response = await client.messages.create({
      model: args.selection.modelId,
      max_tokens: 16384,
      system: REVIEW_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPayload }],
    });
    const block = response.content[0];
    const text = block?.type === "text" ? block.text : "";
    return JSON.parse(stripCodeFence(text)) as ReviewResult;
  }

  // OpenAI
  const client = getOpenAI();
  const completion = await client.chat.completions.create({
    model: args.selection.modelId,
    max_tokens: 8192,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: REVIEW_SYSTEM_PROMPT },
      { role: "user", content: userPayload },
    ],
  });
  const text = completion.choices[0]?.message?.content ?? "";
  return JSON.parse(stripCodeFence(text)) as ReviewResult;
}
