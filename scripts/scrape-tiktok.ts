/**
 * Run: npm run scrape:tiktok
 *
 * Pulls top videos from TikTok for each topic in TOPICS_TO_SCRAPE
 * and writes the merged result to data/scraped/tiktok-<date>.json.
 *
 * Cost note: each Apify run charges by compute units; default ~$0.50 / 100 videos.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { scrapeTikTokByHashtag } from "@/lib/apify/scrapers";

const TOPICS_TO_SCRAPE: { topic: string; hashtags: string[] }[] = [
  {
    topic: "早餐健身",
    hashtags: ["fitness", "highprotein", "mealprep"],
  },
  { topic: "变装秀", hashtags: ["transition", "outfitchange", "glowup"] },
  { topic: "宠物日常", hashtags: ["dogprank", "funnydog", "cattok"] },
  { topic: "旅行 vlog", hashtags: ["travel", "tokyo", "bali"] },
  { topic: "料理教程", hashtags: ["cooking", "recipe", "tutorial"] },
  { topic: "办公室搞笑", hashtags: ["officelife", "wfh", "intern"] },
];

async function main() {
  console.log("[scrape-tiktok] starting...");

  const results = [];
  for (const t of TOPICS_TO_SCRAPE) {
    console.log(`  · 抓取题材: ${t.topic} (${t.hashtags.join(", ")})`);
    try {
      const videos = await scrapeTikTokByHashtag({
        hashtags: t.hashtags,
        topic: t.topic,
        resultsPerPage: 10,
      });
      console.log(`    → 拿到 ${videos.length} 条视频`);
      results.push(...videos);
    } catch (e) {
      console.error(`    ✗ 失败: ${(e as Error).message}`);
    }
  }

  const outDir = join(process.cwd(), "data", "scraped");
  await mkdir(outDir, { recursive: true });
  const outFile = join(
    outDir,
    `tiktok-${new Date().toISOString().slice(0, 10)}.json`,
  );
  await writeFile(outFile, JSON.stringify(results, null, 2), "utf-8");

  console.log(`[scrape-tiktok] done. ${results.length} videos → ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
