import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { TemplateAuditInput } from "./types";

const SYSTEM = `你是 TikTok 内部产品分析师。给定一份特效模板脑暴文档，抽取以下结构化信息：

- topic：脑暴对应的内容题材（如：早餐健身、宠物日常、美食探店、变装秀）
- playStyle：核心玩法（从下列选 1 个 — 前后对比、卡点变装、Tutorial 步骤、List 列表、POV 剧情、Day in the life、First time 反应、Prank 整蛊、声音玩梗、时间反差、价格对比、权威叙事、情感叙事、翻车反差、速览快剪、其他）
- visualStyle：视觉风格（从下列选 1 个 — Cinematic 大片感、手持 vlog 感、电影感影调、高饱和霓虹、Top-down 俯拍美食、暖色家庭感、复古胶片感、其他）
- hashtags：5-6 个真实流行的 TikTok / IG hashtag（不带 #）

返回严格 JSON：{"topic": "...", "playStyle": "...", "visualStyle": "...", "hashtags": ["..."]}`;

let client: Anthropic | null = null;
function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export type ExtractedConcept = {
  topic: string;
  playStyle: string;
  visualStyle: string;
  hashtags: string[];
};

export async function extractTemplateConcept(
  input: TemplateAuditInput,
): Promise<ExtractedConcept> {
  const payload = {
    effectName: input.effectName,
    playStyle: input.playStyle,
    visualStyle: input.visualStyle,
    techStack: input.techStack,
    document: input.document.slice(0, 3000), // 防止过长
  };

  const r = await getClient().messages.create({
    model: process.env.HASHTAG_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
  });
  const block = r.content[0];
  const text = block?.type === "text" ? block.text : "";
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  const parsed = JSON.parse(clean) as Partial<ExtractedConcept>;

  return {
    topic: parsed.topic ?? input.effectName,
    playStyle: parsed.playStyle ?? input.playStyle ?? "其他",
    visualStyle: parsed.visualStyle ?? input.visualStyle ?? "其他",
    hashtags: Array.isArray(parsed.hashtags)
      ? parsed.hashtags
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.replace(/^#/, "").toLowerCase())
          .filter(Boolean)
          .slice(0, 6)
      : [],
  };
}
