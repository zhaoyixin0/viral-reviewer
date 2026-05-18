import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ViralVideo } from "@/lib/review-engine/types";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

function systemPrompt(libraryTopics: string[]): string {
  return `你是短视频题材分类器。给定一条视频的标题/描述/tags,判断它的题材。

已知题材库(优先归一化到下列之一,机制同 inferTopic):
${libraryTopics.map((t) => `- ${t}`).join("\n")}

若都不匹配,可输出一个新的简短题材词。
同时给出 0-1 的置信度 —— 描述信息越模糊、越拿不准,置信度越低。

仅返回 JSON:{"topic":"...","confidence":0.0-1.0}`;
}

/**
 * 给一批 trending 视频打题材标签。
 * - topic 字符串写入 v.topic(干净字符串,不掺哨兵值)
 * - 置信度写入独立字段 v.topicConfidence(0-1)
 * - 分类失败 / JSON 损坏 → 不写 topicConfidence(undefined),topic 保留原值
 *   retrieval.ts 会把 undefined 视为 0,按阈值过滤自然跳过。
 *
 * @param videos 待分类视频
 * @param libraryTopics 本地库已知题材列表,作 hint 传入(来自 loadVideos 的 distinct topics)
 */
export async function classifyTopics(
  videos: ViralVideo[],
  libraryTopics: string[],
  opts: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<ViralVideo[]> {
  const concurrency = opts.concurrency ?? 5;
  const system = systemPrompt(libraryTopics);
  const model = process.env.ENRICH_MODEL || "claude-haiku-4-5-20251001";

  async function classifyOne(v: ViralVideo): Promise<ViralVideo> {
    try {
      const r = await getClient().messages.create({
        model,
        max_tokens: 100,
        system,
        messages: [
          {
            role: "user",
            content: JSON.stringify(
              { title: v.title, description: v.description, tags: v.tags },
              null,
              2,
            ),
          },
        ],
      });
      const block = r.content[0];
      const text = block?.type === "text" ? block.text : "";
      const clean = text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/, "");
      const parsed = JSON.parse(clean) as {
        topic?: string;
        confidence?: number;
      };
      if (typeof parsed.topic !== "string" || typeof parsed.confidence !== "number") {
        return v;
      }
      const confidence = Math.max(0, Math.min(1, parsed.confidence));
      return { ...v, topic: parsed.topic, topicConfidence: confidence };
    } catch {
      return v;
    }
  }

  const out: ViralVideo[] = [];
  for (let i = 0; i < videos.length; i += concurrency) {
    if (opts.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const batch = videos.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((v) => classifyOne(v)));
    out.push(...results);
  }
  return out;
}
