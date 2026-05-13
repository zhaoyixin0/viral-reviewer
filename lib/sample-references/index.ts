import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { CutPlanSchema, type CutPlan } from "@/lib/cut-plan/schema";
import { loadTechniqueIndex } from "@/lib/technique-index/load-index";
import { scoreCandidates } from "@/lib/technique-index/similarity";

const ENRICHED_DIR = "data/enriched-cutplans";
const FALLBACK_DIR = "lib/sample-references/cutplans";
const FALLBACK_FILES = [
  "transformation-match-cut.json",
  "vlog-pull-out-aerial.json",
] as const;

export type ReferenceFilter = {
  userFormat?: string;
  userTopic?: string;
  /** P2 新增：用户期望的技法 tag（来自 potential → desiredTags 映射） */
  desiredTechniques?: string[];
  limit?: number;
};

export type ReferenceLoadResult = {
  cutPlans: CutPlan[];
  source: "sample" | "database" | "technique-cluster";
  notice?: string;
};

let cache: { plans: CutPlan[]; map: Map<string, CutPlan>; source: "sample" | "database" } | null = null;
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

async function getCache(): Promise<{ plans: CutPlan[]; map: Map<string, CutPlan>; source: "sample" | "database" }> {
  if (cache && Date.now() - cacheTime < CACHE_TTL_MS) return cache;
  const enriched = await loadEnriched();
  let plans: CutPlan[];
  let source: "sample" | "database";
  if (enriched.length >= 10) {
    plans = enriched;
    source = "database";
  } else {
    plans = [...enriched, ...(await loadFallback())];
    source = "sample";
  }
  const map = new Map<string, CutPlan>();
  for (const p of plans) map.set(p.videoId, p);
  cache = { plans, map, source };
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
  const { plans, map, source } = await getCache();
  const limit = filter.limit ?? 5;

  // Path A: technique-cluster 召回（P2 优先路径）
  if (filter.desiredTechniques && filter.desiredTechniques.length > 0) {
    const idx = await loadTechniqueIndex();
    if (idx) {
      const scored = scoreCandidates(idx, filter.desiredTechniques);
      const matched: CutPlan[] = [];
      for (const c of scored) {
        const p = map.get(c.videoId);
        if (p) matched.push(p);
        if (matched.length >= limit) break;
      }
      if (matched.length >= Math.min(3, limit)) {
        return {
          cutPlans: matched,
          source: "technique-cluster",
          notice: `技法簇召回：按 ${filter.desiredTechniques.join(", ")} 命中 ${matched.length} 条爆款`,
        };
      }
    }
  }

  // Path B: format 召回（P1 baseline）
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
