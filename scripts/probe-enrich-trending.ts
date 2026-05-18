/**
 * L3+ T3 probe script (plan §4.2 acceptance gate).
 *
 * Runs fetchTrendingSnapshot end-to-end locally (no cron, no GCS write) and
 * dumps the resulting snapshot JSON to stdout. Used by W4 + W3 to manually
 * verify the L3+ insight pipeline against real Apify + Gemini calls before
 * Cloud Scheduler picks it up for the first cron run after deploy.
 *
 * Usage:
 *   npm run probe:enrich-trending
 *   npm run probe:enrich-trending -- --skip-llm-events
 *   npm run probe:enrich-trending -- --skip-enrichment
 *
 * Env required:
 *   APIFY_TOKEN, ANTHROPIC_API_KEY (Haiku enrich + topic classify),
 *   GOOGLE_API_KEY (Gemini CutPlan + Gemini Pro event overlay).
 *
 * Output: pretty JSON to stdout; warnings + errors to stderr via the same
 * Cloud-Logging-shaped structured logger used in production code.
 */

import { fetchTrendingSnapshot } from "@/lib/trending/fetch";

function parseFlags(argv: string[]): {
  skipLLMEventDetection: boolean;
  skipEnrichment: boolean;
} {
  return {
    skipLLMEventDetection: argv.includes("--skip-llm-events"),
    skipEnrichment: argv.includes("--skip-enrichment"),
  };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  process.stderr.write(
    `[probe-enrich-trending] starting · flags=${JSON.stringify(flags)}\n`,
  );
  const t0 = Date.now();

  const snapshot = await fetchTrendingSnapshot(flags);

  const elapsedMs = Date.now() - t0;
  process.stderr.write(
    `[probe-enrich-trending] done in ${elapsedMs}ms · schemaVersion=${snapshot.schemaVersion} · videos=${snapshot.videos.length} · trendingHashtags=${snapshot.trendingHashtags.length} · insight=${snapshot.insight ? "present" : "absent"}\n`,
  );

  process.stdout.write(JSON.stringify(snapshot, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(
    `[probe-enrich-trending] FATAL ${err instanceof Error ? err.message : String(err)}\n`,
  );
  if (err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
