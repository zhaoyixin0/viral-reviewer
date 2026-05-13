/**
 * Run: npx tsx --env-file=.env.local scripts/enrich-cutplans-batch.ts
 *
 * 读 data/rescrape-2026-05-13.json + data/raw-mp4s/*.mp4
 * 跑批量 Gemini 富化，输出 data/enriched-cutplans/{videoId}.json
 *
 * 支持断点续跑：已存在的 cutplan 文件自动 skip。
 *
 * 命令行参数:
 *   --limit <N>  只跑前 N 条（preflight 用）
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { runEnrichmentBatch } from "@/lib/enrichment/batch-runner";
import type { EnrichmentJob } from "@/lib/enrichment/types";

type Item = {
  id: string;
  platform: string;
  topic: string;
  duration: number;
  videoUrl: string | null;
};

function parseLimit(): number | null {
  const idx = process.argv.indexOf("--limit");
  if (idx === -1) return null;
  const v = Number(process.argv[idx + 1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

async function main() {
  const limit = parseLimit();
  const inPath = join(process.cwd(), "data", "rescrape-2026-05-13.json");
  const raw = await readFile(inPath, "utf-8");
  const items = JSON.parse(raw) as Item[];

  const jobs: EnrichmentJob[] = [];
  for (const v of items) {
    const mp4 = join(process.cwd(), "data", "raw-mp4s", `${v.id}.mp4`);
    const stats = await stat(mp4).catch(() => null);
    if (!stats || stats.size < 1024) continue;
    jobs.push({
      videoId: v.id,
      videoPath: mp4,
      platform: v.platform,
      topic: v.topic,
      durationSec: v.duration,
    });
  }
  const limited = limit ? jobs.slice(0, limit) : jobs;
  console.log(
    `[enrich] ${limited.length} jobs queued (skipping ${items.length - jobs.length} missing mp4s${limit ? `, limit=${limit}` : ""})`,
  );

  const startedAt = Date.now();
  const summary = await runEnrichmentBatch(limited, {
    concurrency: 5,
    errorsOutPath: "data/enrichment-errors.json",
    onProgress: (p, last) => {
      if (last) {
        const tag = last.ok ? "OK " : `FAIL[${last.stage}]`;
        const detail = last.ok
          ? `${(last.elapsedMs / 1000).toFixed(1)}s`
          : last.reason.slice(0, 60);
        process.stdout.write(
          `  [${p.done}/${p.total}] ${tag} ${last.videoId} ${detail}\n`,
        );
      }
    },
  });

  const elapsed = ((Date.now() - startedAt) / 1000 / 60).toFixed(1);
  console.log(
    `\n[enrich] done in ${elapsed}min: ok=${summary.ok}, failed=${summary.failed}, skipped=${summary.skipped}`,
  );
  if (summary.failed > 0) {
    console.log("[enrich] errors written to data/enrichment-errors.json");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
