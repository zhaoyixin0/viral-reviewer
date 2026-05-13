import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { CutPlanSchema, type CutPlan } from "@/lib/cut-plan/schema";

/**
 * Phase 6 后：从 data/enriched-cutplans/ 加载真实富化爆款池。
 *
 * 兼容回退：若 enriched-cutplans 为空（未跑富化），退回 lib/sample-references/cutplans/ 的 2 条 demo。
 */

const ENRICHED_DIR = "data/enriched-cutplans";
const FALLBACK_DIR = "lib/sample-references/cutplans";
const FALLBACK_FILES = [
  "transformation-match-cut.json",
  "vlog-pull-out-aerial.json",
] as const;

export type ReferenceFilter = {
  userFormat?: string;
  userTopic?: string;
  limit?: number;
};

export type ReferenceLoadResult = {
  cutPlans: CutPlan[];
  source: "sample" | "database";
  notice?: string;
};

let cache: { plans: CutPlan[]; source: "sample" | "database" } | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60 * 1000;

async function loadEnriched(): Promise<CutPlan[]> {
  const dir = join(process.cwd(), ENRICHED_DIR);
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const results: CutPlan[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(join(dir, f), "utf-8");
      results.push(CutPlanSchema.parse(JSON.parse(raw)));
    } catch (e) {
      console.warn(`[sample-references] skip ${f}: ${(e as Error).message}`);
    }
  }
  return results;
}

async function loadFallback(): Promise<CutPlan[]> {
  const dir = join(process.cwd(), FALLBACK_DIR);
  const results: CutPlan[] = [];
  for (const name of FALLBACK_FILES) {
    try {
      const raw = await readFile(join(dir, name), "utf-8");
      results.push(CutPlanSchema.parse(JSON.parse(raw)));
    } catch {
      /* missing fallback is fine */
    }
  }
  return results;
}

async function getCache(): Promise<{ plans: CutPlan[]; source: "sample" | "database" }> {
  if (cache && Date.now() - cacheTime < CACHE_TTL_MS) return cache;
  const enriched = await loadEnriched();
  if (enriched.length >= 10) {
    cache = { plans: enriched, source: "database" };
  } else {
    const fallback = await loadFallback();
    cache = { plans: [...enriched, ...fallback], source: "sample" };
  }
  cacheTime = Date.now();
  return cache;
}

function filterByFormat(plans: CutPlan[], format: string): CutPlan[] {
  const f = format.toLowerCase().trim();
  return plans.filter((p) => p.videoFormat.toLowerCase().startsWith(f));
}

export async function loadReferenceCutPlans(
  filter: ReferenceFilter = {},
): Promise<ReferenceLoadResult> {
  const { plans, source } = await getCache();
  const limit = filter.limit ?? 5;

  let pool = plans;
  if (filter.userFormat) {
    const matched = filterByFormat(plans, filter.userFormat);
    if (matched.length >= limit) pool = matched;
  }

  const top = pool
    .slice()
    .sort((a, b) => (b.density.overall ?? 0) - (a.density.overall ?? 0))
    .slice(0, limit);

  return {
    cutPlans: top,
    source,
    notice:
      source === "database"
        ? `从富化爆款池中按 format=${filter.userFormat ?? "any"} 召回 ${top.length} 条`
        : `Demo 数据池：${top.length} 条手工样本（富化未跑或失败）`,
  };
}
