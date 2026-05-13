import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  BatchProgress,
  EnrichmentJob,
  EnrichmentResult,
  EnrichmentFailure,
} from "./types";
import { isAlreadyEnriched, runCutPlanJob } from "./cutplan-job";

export type BatchOptions = {
  concurrency?: number;
  onProgress?: (p: BatchProgress, last: EnrichmentResult | null) => void;
  errorsOutPath?: string;
};

export async function runEnrichmentBatch(
  jobs: EnrichmentJob[],
  opts: BatchOptions = {},
): Promise<{ ok: number; failed: number; skipped: number }> {
  const { concurrency = 5, onProgress, errorsOutPath } = opts;
  const progress: BatchProgress = {
    total: jobs.length,
    done: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
  };
  const failures: EnrichmentFailure[] = [];

  let cursor = 0;
  const inflight: Promise<void>[] = [];

  const next = async (): Promise<void> => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const skip = await isAlreadyEnriched(job.videoId);
      if (skip) {
        progress.skipped++;
        progress.done++;
        onProgress?.(progress, null);
        continue;
      }
      const result = await runCutPlanJob(job);
      progress.done++;
      if (result.ok) progress.ok++;
      else {
        progress.failed++;
        failures.push(result);
      }
      onProgress?.(progress, result);
    }
  };

  for (let i = 0; i < concurrency; i++) inflight.push(next());
  await Promise.all(inflight);

  if (errorsOutPath && failures.length > 0) {
    await writeFile(
      join(process.cwd(), errorsOutPath),
      JSON.stringify(failures, null, 2),
      "utf-8",
    );
  }

  return { ok: progress.ok, failed: progress.failed, skipped: progress.skipped };
}
