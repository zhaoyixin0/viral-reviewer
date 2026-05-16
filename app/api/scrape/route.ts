import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  scrapeInstagramByHashtag,
  scrapeTikTokByHashtag,
} from "@/lib/apify/scrapers";
import {
  createRateLimiter,
  withRateLimit,
  clientIp,
  WRITE_HEAVY,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

const PRESET_HASHTAGS: Record<string, { tt: string[]; ig: string[] }> = {
  早餐健身: { tt: ["fitness", "highprotein"], ig: ["proteinbreakfast"] },
  变装秀: { tt: ["transition", "glowup"], ig: ["transitionreel"] },
  宠物日常: { tt: ["dogprank", "funnydog"], ig: ["dogsofinstagram"] },
  "旅行 vlog": { tt: ["travel", "tokyo"], ig: ["travelreels"] },
  料理教程: { tt: ["cooking", "recipe"], ig: ["cookingreels"] },
  办公室搞笑: { tt: ["officelife", "wfh"], ig: ["corporatehumor"] },
};

const RequestSchema = z.object({
  topic: z.string().min(1),
  platforms: z
    .array(z.enum(["tiktok", "instagram"]))
    .optional()
    .default(["tiktok", "instagram"]),
  limit: z.number().int().min(1).max(30).optional().default(10),
});

// P3 #3 phase 2: WRITE_HEAVY (5/10m fixed) —— Apify scrape 计费 API，
// 严控频次防止刷库。
const RATE_LIMITER = createRateLimiter({
  identifier: "scrape",
  ...WRITE_HEAVY,
});

async function impl(req: NextRequest) {
  if (!process.env.APIFY_TOKEN) {
    return NextResponse.json(
      { error: "apify_token_missing" },
      { status: 503 },
    );
  }

  const json = await req.json();
  const parsed = RequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { topic, platforms, limit } = parsed.data;
  const preset = PRESET_HASHTAGS[topic];
  if (!preset) {
    return NextResponse.json(
      {
        error: "unknown_topic",
        message: `Topic "${topic}" not in preset list. Add to PRESET_HASHTAGS.`,
      },
      { status: 400 },
    );
  }

  const out: Record<string, unknown> = { topic };

  if (platforms.includes("tiktok")) {
    try {
      out.tiktok = await scrapeTikTokByHashtag({
        hashtags: preset.tt,
        topic,
        resultsPerPage: limit,
      });
    } catch (e) {
      out.tiktokError = (e as Error).message;
    }
  }

  if (platforms.includes("instagram")) {
    try {
      out.instagram = await scrapeInstagramByHashtag({
        hashtags: preset.ig,
        topic,
        resultsLimit: limit,
      });
    } catch (e) {
      out.instagramError = (e as Error).message;
    }
  }

  return NextResponse.json(out);
}

export const POST = withRateLimit(RATE_LIMITER, clientIp, impl);
