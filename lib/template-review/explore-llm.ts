import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { TEMPLATE_EXPLORE_SYSTEM_PROMPT } from "./explore-prompt";
import type { ExploreFilter, ExploreResult } from "./types";
import type { ViralVideo } from "@/lib/review-engine/types";

let client: Anthropic | null = null;
function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

type Bucket = {
  count: number;
  avgViews: number;
  topVideos: ViralVideo[];
};

function bucketBy(
  videos: ViralVideo[],
  key: (v: ViralVideo) => string,
): Record<string, Bucket> {
  const map = new Map<string, ViralVideo[]>();
  for (const v of videos) {
    const k = key(v);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(v);
  }
  const out: Record<string, Bucket> = {};
  for (const [k, arr] of map) {
    const top = [...arr].sort((a, b) => b.views - a.views).slice(0, 3);
    const avg =
      arr.reduce((s, v) => s + v.views, 0) / Math.max(arr.length, 1);
    out[k] = { count: arr.length, avgViews: Math.round(avg), topVideos: top };
  }
  return out;
}

export async function generateExploreWithLLM(args: {
  filter: ExploreFilter;
  videos: ViralVideo[];
}): Promise<ExploreResult> {
  const { filter, videos } = args;

  const filtered = videos.filter((v) => {
    if (filter.topic && v.topic !== filter.topic) return false;
    if (filter.playStyle && v.playStyle !== filter.playStyle) return false;
    if (filter.platform && v.platform !== filter.platform) return false;
    return true;
  });

  const corpus = {
    totalVideos: filtered.length,
    byTopic: bucketBy(filtered, (v) => v.topic),
    byPlayStyle: bucketBy(filtered, (v) => v.playStyle),
    byVisualStyle: bucketBy(filtered, (v) => v.visualStyle),
    byPlatform: {
      tiktok: filtered.filter((v) => v.platform === "tiktok").length,
      instagram: filtered.filter((v) => v.platform === "instagram").length,
    },
  };

  const payload = { filter, corpus };

  const r = await getClient().messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-opus-4-7",
    max_tokens: 16384,
    system: TEMPLATE_EXPLORE_SYSTEM_PROMPT,
    messages: [
      { role: "user", content: JSON.stringify(payload, null, 2) },
    ],
  });

  const block = r.content[0];
  const text = block?.type === "text" ? block.text : "";
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");

  const parsed = JSON.parse(clean) as ExploreResult;
  return parsed;
}
