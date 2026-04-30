import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `你是一名 TikTok / Instagram Reels 数据分析师。
给你一个用户描述的视频题材（可能是中文或英文，可能宽泛或具体），
你需要输出 5-6 个最适合在 TikTok 和 Instagram **实际能搜到大量爆款**的 hashtag。

要求：
- 必须是真实存在且活跃的 hashtag（不要拼凑生造）
- 优先英文 hashtag（更国际化、抓取覆盖更广）
- 兼顾大流量泛标签（如 foodie）+ 题材精准标签（如 hiddengem）
- 不要带 # 号
- 不要带空格

返回严格 JSON，不要 markdown 包裹：{"hashtags": ["tag1", "tag2", ...]}`;

let client: Anthropic | null = null;
function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function generateHashtagsForTopic(
  topic: string,
): Promise<string[]> {
  const r = await getClient().messages.create({
    model: process.env.HASHTAG_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: 200,
    system: SYSTEM,
    messages: [{ role: "user", content: `题材：${topic}` }],
  });
  const block = r.content[0];
  const text = block?.type === "text" ? block.text : "";
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  const parsed = JSON.parse(clean) as { hashtags?: unknown };
  if (!Array.isArray(parsed.hashtags)) {
    throw new Error("hashtag generator returned no hashtags array");
  }
  return parsed.hashtags
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(/^#/, "").replace(/\s+/g, "").toLowerCase())
    .filter(Boolean)
    .slice(0, 6);
}
