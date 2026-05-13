import "server-only";
import { stat, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ZodError } from "zod";
import { probeVideoMeta } from "@/lib/video/ffprobe-meta";
import { analyzeMaterialPotential } from "@/lib/video/analyze-potential";
import { CutPlanSchema } from "@/lib/cut-plan/schema";
import type { EnrichmentJob, EnrichmentResult } from "./types";

const OUT_DIR = "data/enriched-cutplans";

export async function isAlreadyEnriched(videoId: string): Promise<boolean> {
  try {
    const s = await stat(join(process.cwd(), OUT_DIR, `${videoId}.json`));
    return s.isFile() && s.size > 100;
  } catch {
    return false;
  }
}

export async function loadEnrichedCutPlan(videoId: string) {
  const path = join(process.cwd(), OUT_DIR, `${videoId}.json`);
  const raw = await readFile(path, "utf-8");
  return CutPlanSchema.parse(JSON.parse(raw));
}

export async function runCutPlanJob(
  job: EnrichmentJob,
): Promise<EnrichmentResult> {
  const start = Date.now();
  let meta;
  try {
    meta = await probeVideoMeta(job.videoPath);
  } catch (e) {
    return {
      ok: false,
      videoId: job.videoId,
      reason: (e as Error).message,
      stage: "ffprobe",
    };
  }

  let analyzed;
  try {
    analyzed = await analyzeMaterialPotential({
      videoPath: job.videoPath,
      videoId: job.videoId,
      meta,
      hints: { userTopic: job.topic },
    });
  } catch (e) {
    return {
      ok: false,
      videoId: job.videoId,
      reason: (e as Error).message,
      stage: "gemini",
    };
  }

  // analyzeMaterialPotential returns MaterialPotential; the CutPlan IR is in .base
  try {
    const validated = CutPlanSchema.parse(analyzed.base);
    const outPath = join(process.cwd(), OUT_DIR, `${job.videoId}.json`);
    await writeFile(outPath, JSON.stringify(validated, null, 2), "utf-8");
    return {
      ok: true,
      videoId: job.videoId,
      cutPlan: validated,
      elapsedMs: Date.now() - start,
    };
  } catch (e) {
    return {
      ok: false,
      videoId: job.videoId,
      reason: (e as Error).message,
      stage: e instanceof ZodError ? "schema" : "write",
    };
  }
}
