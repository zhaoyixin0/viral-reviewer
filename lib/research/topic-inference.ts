import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ReviewInputVideo } from "@/lib/review-engine/types";

/**
 * LLM 题材推断：
 *   - 看用户全部上下文（文字 + 受众 + 场景 + 草稿，或视频特征）
 *   - 优先归一化到本地爆款库已有题材（提高命中率）
 *   - 若确实是新题材，给出简洁的中文题材名（用于后续爬虫搜索）
 */

const SYSTEM = `你是 TikTok / Instagram Reels 内容分类师。
给定用户描述的视频信息（题材文字 / 受众 / 场景 / 草稿，或视频抽帧+转录得到的特征），
你需要判断这条视频本质属于哪个题材。

【任务】
1. 仔细看用户的全部上下文，理解视频真正在讲什么
2. 如果用户的题材语义上属于"已有题材库"中的某一项（即便用词不同），归一化为该已有题材
3. 如果确实是新题材，给出一个简洁的中文题材名（2-6 字，能用于搜索）

【归一化示例】
- "健身早餐" / "蛋白早餐" / "增肌餐" / "减脂餐" → "早餐健身"
- "狗狗日常" / "猫咪 vlog" / "萌宠搞笑" / "撸猫" → "宠物日常"
- "穿搭变装" / "outfit transition" / "GRWM 变装" → "变装秀"
- "城市漫游" / "出差日常" / "city walk" / "旅游攻略" → "旅行 vlog"
- "做菜教学" / "recipe" / "烘焙" / "菜谱" → "料理教程"
- "打工日常" / "上班搞笑" / "wfh" / "实习日记" → "办公室搞笑"
- 都不像 → 输出新题材（如"摄影教程"、"读书博主"、"穿搭测评"、"AI 工具"等）

【严格规则】
- 必须在 libraryTopics 列表里找到合适归一目标时才设 isFromLibrary=true
- 用户描述模糊或矛盾，以多数信号为准
- 视频模式下，frameDescriptions / detectedPlayStyle / transcript 比用户填的 topic 更可信
- 不要输出英文题材名（除非用户输入完全是英文且无法翻译）

返回严格 JSON，不要 markdown 包裹：
{
  "canonicalTopic": "...",
  "isFromLibrary": true | false,
  "reasoning": "一句话解释为什么这么归类"
}`;

let client: Anthropic | null = null;
function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export type InferredTopic = {
  canonicalTopic: string;
  isFromLibrary: boolean;
  reasoning?: string;
};

export type TopicInferenceInput = {
  userTopic?: string;
  audience?: string;
  scene?: string;
  draft?: string;
  videoFeatures?: ReviewInputVideo["videoFeatures"];
  libraryTopics: string[];
};

export async function inferTopic(
  input: TopicInferenceInput,
): Promise<InferredTopic> {
  const payload = {
    libraryTopics: input.libraryTopics,
    userContext: {
      topic: input.userTopic?.trim() || undefined,
      audience: input.audience?.trim() || undefined,
      scene: input.scene?.trim() || undefined,
      draft: input.draft?.slice(0, 1500) || undefined,
      videoFeatures: input.videoFeatures
        ? {
            duration: input.videoFeatures.duration,
            detectedHook: input.videoFeatures.detectedHook,
            detectedPlayStyle: input.videoFeatures.detectedPlayStyle,
            detectedVisualStyle: input.videoFeatures.detectedVisualStyle,
            transcript: input.videoFeatures.transcript.slice(0, 600),
            frameDescriptions: input.videoFeatures.frameSamples
              .map((f) => f.description)
              .filter(Boolean)
              .slice(0, 8),
          }
        : undefined,
    },
  };

  const r = await getClient().messages.create({
    model: process.env.TOPIC_INFERENCE_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
  });

  const block = r.content[0];
  const text = block?.type === "text" ? block.text : "";
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");

  const parsed = JSON.parse(clean) as Partial<InferredTopic>;
  const canonical = (parsed.canonicalTopic ?? "").trim();
  if (!canonical) {
    throw new Error("topic inference returned empty canonicalTopic");
  }

  // 防幻觉：以实际库匹配为准，避免 LLM 声称 isFromLibrary 但题材实际不在库内
  const actuallyInLibrary = input.libraryTopics.includes(canonical);
  return {
    canonicalTopic: canonical,
    isFromLibrary: actuallyInLibrary && parsed.isFromLibrary !== false,
    reasoning:
      typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
  };
}
