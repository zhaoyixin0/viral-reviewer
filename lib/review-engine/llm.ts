import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { REVIEW_SYSTEM_PROMPT } from "./system-prompt";
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

function buildUserPayload(args: {
  input: ReviewInput;
  videos: ViralVideo[];
  formula: ViralFormula;
  matched: boolean;
}) {
  return JSON.stringify(
    {
      userInput: args.input,
      benchmark: {
        topicMatched: args.matched,
        topicMatchNote: args.matched
          ? "下方 viralVideos 是同题材真实 top-K，可以作为直接对标。"
          : `数据库中没有"${args.input.topic}"的同题材样本，下方 viralVideos 是平台跨题材的高互动爆款，仅作通用规律参考。请基于 ground truth 中的算法逻辑、钩子原理、身份认同、彩蛋设计等通用规律给出建议，不要硬套这些视频的具体玩法。`,
        viralVideos: args.videos.map((v) => ({
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
        })),
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
