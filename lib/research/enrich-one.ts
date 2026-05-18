import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ViralVideo } from "@/lib/review-engine/types";

const ENRICH_SYSTEM = `你是 TikTok 内容分析师。给定一条真实视频的元数据（标题、描述、tags、时长、BGM），快速判断它的：
- playStyle（玩法）：从下列选 1 个 — 前后对比、卡点变装、Tutorial 步骤、List 列表、POV 剧情、Day in the life、First time 反应、Prank 整蛊、声音玩梗、时间反差、价格对比、权威叙事、情感叙事、翻车反差、速览快剪、其他
- visualStyle（视觉风格）：从下列选 1 个 — Cinematic 大片感、手持 vlog 感、电影感影调、高饱和霓虹、Top-down 俯拍美食、暖色家庭感、复古胶片感、其他
- hook（开场钩子）：用一句话描述视频前 0-3 秒最可能的开场方式（基于标题与描述推测）

仅返回 JSON：{"playStyle":"...","visualStyle":"...","hook":"..."}`;

let client: Anthropic | null = null;
function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function enrichOneVideo(v: ViralVideo): Promise<ViralVideo> {
  try {
    const r = await getClient().messages.create({
      model: process.env.ENRICH_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system: ENRICH_SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify(
            {
              title: v.title,
              description: v.description,
              topic: v.topic,
              tags: v.tags,
              duration: v.duration,
              bgm: v.bgm,
              platform: v.platform,
            },
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
      playStyle?: string;
      visualStyle?: string;
      hook?: string;
    };
    return {
      ...v,
      playStyle: parsed.playStyle ?? v.playStyle,
      visualStyle: parsed.visualStyle ?? v.visualStyle,
      hook: parsed.hook ?? v.hook,
    };
  } catch {
    return v;
  }
}

export async function enrichBatch(
  videos: ViralVideo[],
  opts: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<ViralVideo[]> {
  const concurrency = opts.concurrency ?? 5;
  const out: ViralVideo[] = [];
  for (let i = 0; i < videos.length; i += concurrency) {
    if (opts.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const batch = videos.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((v) => enrichOneVideo(v)));
    out.push(...results);
  }
  return out;
}
