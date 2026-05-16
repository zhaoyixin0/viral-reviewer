import "server-only";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import type { ViralVideo } from "@/lib/review-engine/types";
import { SEED_VIDEOS } from "@/data/seed/viral-videos";
import { createLogger } from "@/lib/observability/structured-log";

const log = createLogger({ module: "data/load-videos" });

let cache: ViralVideo[] | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * 视频库加载策略（优先级）：
 *   1. data/scraped/enriched-*.json（最新优先）— 真实抓取 + LLM 富化
 *   2. data/scraped/tiktok-*.json + instagram-*.json — 真实抓取但未富化
 *   3. SEED_VIDEOS — 手工策展 fallback
 */
export async function loadVideos(): Promise<ViralVideo[]> {
  if (cache && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cache;
  }

  const dir = join(process.cwd(), "data", "scraped");
  let result: ViralVideo[] = [];

  try {
    const files = await readdir(dir);

    const enriched = files
      .filter((f) => f.startsWith("enriched-") && f.endsWith(".json"))
      .sort()
      .reverse();

    if (enriched.length > 0) {
      const latest = enriched[0];
      const raw = await readFile(join(dir, latest), "utf-8");
      result = JSON.parse(raw) as ViralVideo[];
      console.log(`[load-videos] loaded ${result.length} from ${latest}`);
    } else {
      const ttFiles = files
        .filter((f) => f.startsWith("tiktok-") && f.endsWith(".json"))
        .sort()
        .reverse();
      const igFiles = files
        .filter((f) => f.startsWith("instagram-") && f.endsWith(".json"))
        .sort()
        .reverse();

      for (const f of [ttFiles[0], igFiles[0]].filter(Boolean) as string[]) {
        const raw = await readFile(join(dir, f), "utf-8");
        const data = JSON.parse(raw) as ViralVideo[];
        result.push(...data);
      }

      if (result.length > 0) {
        console.log(
          `[load-videos] loaded ${result.length} from raw scraped (no enrichment yet)`,
        );
      }
    }
  } catch (e) {
    log.warn("scraped dir unreadable", { dir, err: e });
  }

  if (result.length === 0) {
    console.log(`[load-videos] using SEED_VIDEOS fallback (${SEED_VIDEOS.length} videos)`);
    result = SEED_VIDEOS;
  }

  cache = result;
  cacheTime = Date.now();
  return result;
}

export function clearVideoCache() {
  cache = null;
  cacheTime = 0;
}
