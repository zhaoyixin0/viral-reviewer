/**
 * Run: npm run enrich
 *
 * 读取 data/scraped/tiktok-*.json + instagram-*.json，
 * 用 Claude Opus（或 GPT-4o）给每条视频补全 playStyle / visualStyle / hook 字段，
 * 输出到 data/scraped/enriched-{date}.json
 */
import { readFile, writeFile, readdir } from "fs/promises";
import { join } from "path";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ViralVideo } from "../lib/review-engine/types";

const ENRICH_SYSTEM = `你是 TikTok 内部产品分析师。给定一个真实视频的元数据（标题、描述、tags、时长、BGM），快速判断它的：
- playStyle（玩法）：从下列选 1 个 — 前后对比、卡点变装、Tutorial 步骤、List 列表、POV 剧情、Day in the life、First time 反应、Prank 整蛊、声音玩梗、时间反差、价格对比、权威叙事、情感叙事、翻车反差、速览快剪、预算挑战、对比叙事、拟人化叙事、其他
- visualStyle（视觉风格）：从下列选 1 个 — Cinematic 大片感、手持 vlog 感、电影感影调、高饱和霓虹、Top-down 俯拍美食、暖色家庭感、复古胶片感、其他
- hook（开场钩子）：用一句话描述视频前 0-3 秒最可能的开场方式（基于标题与描述推测）

仅返回有效 JSON，不要 markdown：{"playStyle":"...","visualStyle":"...","hook":"..."}`;

type Provider =
  | { kind: "anthropic"; client: Anthropic; model: string }
  | { kind: "openai"; client: OpenAI; model: string };

function pickProvider(): Provider {
  // enrich 是单字段分类任务，默认用 Haiku 4.5（性价比高、速度快）
  // 用户可在 .env.local 设 ENRICH_MODEL 覆盖
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      kind: "anthropic",
      client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
      model: process.env.ENRICH_MODEL || "claude-haiku-4-5-20251001",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      kind: "openai",
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    };
  }
  throw new Error(
    "Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY set in .env.local",
  );
}

async function enrichOne(v: ViralVideo, provider: Provider): Promise<ViralVideo> {
  const payload = JSON.stringify(
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
  );

  try {
    let text = "";
    if (provider.kind === "anthropic") {
      const r = await provider.client.messages.create({
        model: provider.model,
        max_tokens: 200,
        system: ENRICH_SYSTEM,
        messages: [{ role: "user", content: payload }],
      });
      const b = r.content[0];
      text = b?.type === "text" ? b.text : "";
    } else {
      const r = await provider.client.chat.completions.create({
        model: provider.model,
        max_tokens: 200,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: ENRICH_SYSTEM },
          { role: "user", content: payload },
        ],
      });
      text = r.choices[0]?.message?.content ?? "";
    }
    const clean = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "");
    const parsed = JSON.parse(clean) as {
      playStyle: string;
      visualStyle: string;
      hook: string;
    };
    return {
      ...v,
      playStyle: parsed.playStyle ?? v.playStyle,
      visualStyle: parsed.visualStyle ?? v.visualStyle,
      hook: parsed.hook ?? v.hook,
    };
  } catch (e) {
    console.error(`  ✗ ${v.id} enrich failed:`, (e as Error).message);
    return v;
  }
}

async function loadAllScraped(dir: string): Promise<ViralVideo[]> {
  const files = await readdir(dir);
  const sources = files.filter(
    (f) =>
      (f.startsWith("tiktok-") || f.startsWith("instagram-")) &&
      f.endsWith(".json") &&
      !f.startsWith("enriched-"),
  );
  const all: ViralVideo[] = [];
  for (const f of sources) {
    const raw = await readFile(join(dir, f), "utf-8");
    const data = JSON.parse(raw) as ViralVideo[];
    console.log(`  · ${f}: ${data.length} 条`);
    all.push(...data);
  }
  return all;
}

async function main() {
  const provider = pickProvider();
  console.log(`[enrich] using ${provider.kind} / ${provider.model}\n`);

  const dir = join(process.cwd(), "data", "scraped");
  console.log("[enrich] loading scraped data:");
  const all = await loadAllScraped(dir);
  console.log(`[enrich] total ${all.length} videos\n`);

  const concurrency = 5;
  const enriched: ViralVideo[] = [];

  console.log(`[enrich] enriching with concurrency=${concurrency}...`);
  for (let i = 0; i < all.length; i += concurrency) {
    const batch = all.slice(i, i + concurrency);
    const out = await Promise.all(batch.map((v) => enrichOne(v, provider)));
    enriched.push(...out);
    process.stdout.write(`  ${enriched.length}/${all.length}\r`);
  }
  console.log(`\n[enrich] done. ${enriched.length} videos enriched.`);

  const outFile = join(
    dir,
    `enriched-${new Date().toISOString().slice(0, 10)}.json`,
  );
  await writeFile(outFile, JSON.stringify(enriched, null, 2), "utf-8");
  console.log(`[enrich] wrote → ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
