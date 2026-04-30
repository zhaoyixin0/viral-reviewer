/**
 * Run: npm run scrape:instagram
 *
 * Same idea as scrape-tiktok.ts but for Instagram Reels via Apify
 * instagram-hashtag-scraper actor.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { scrapeInstagramByHashtag } from "@/lib/apify/scrapers";

const TOPICS_TO_SCRAPE: { topic: string; hashtags: string[] }[] = [
  { topic: "早餐健身", hashtags: ["proteinbreakfast", "mealprepideas"] },
  { topic: "变装秀", hashtags: ["transitionreel", "outfitcheck"] },
  { topic: "宠物日常", hashtags: ["dogsofinstagram", "catsofinstagram"] },
  { topic: "旅行 vlog", hashtags: ["travelreels", "wanderlust"] },
  { topic: "料理教程", hashtags: ["cookingreels", "easyrecipes"] },
  { topic: "办公室搞笑", hashtags: ["corporatehumor", "officelife"] },
];

async function main() {
  console.log("[scrape-instagram] starting...");

  const results = [];
  for (const t of TOPICS_TO_SCRAPE) {
    console.log(`  · 抓取题材: ${t.topic} (${t.hashtags.join(", ")})`);
    try {
      const videos = await scrapeInstagramByHashtag({
        hashtags: t.hashtags,
        topic: t.topic,
        resultsLimit: 10,
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
    `instagram-${new Date().toISOString().slice(0, 10)}.json`,
  );
  await writeFile(outFile, JSON.stringify(results, null, 2), "utf-8");

  console.log(`[scrape-instagram] done. ${results.length} videos → ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
