import { readFile } from "fs/promises";
import { join } from "path";
import { CutPlanSchema, type CutPlan } from "@/lib/cut-plan/schema";

/**
 * Phase 4 临时方案：从 lib/sample-references/cutplans/ 加载 2 条已富化的 CutPlan
 *
 * Phase 6 完成（批量富化 299 条爆款）后，把这个模块换成调用
 * retrieveSimilarVideos(filter) 并按 videoFormat / topic / density 多维匹配。
 *
 * 接口签名保持稳定：传 filter，返回 CutPlan[]，让 /api/technique-match 无需改动。
 */

const SAMPLE_FILES = [
  "transformation-match-cut.json",
  "vlog-pull-out-aerial.json",
] as const;

export type ReferenceFilter = {
  /** 用户视频形态（vlog / tutorial / transformation / ...） */
  userFormat?: string;
  /** 用户题材 */
  userTopic?: string;
  /** 最多返回多少条爆款 */
  limit?: number;
};

export type ReferenceLoadResult = {
  cutPlans: CutPlan[];
  /** 数据来源标识：sample（Phase 4 demo）/ database（Phase 6 真实库） */
  source: "sample" | "database";
  notice?: string;
};

let cache: CutPlan[] | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60 * 1000;

async function loadSamples(): Promise<CutPlan[]> {
  if (cache && Date.now() - cacheTime < CACHE_TTL_MS) return cache;

  const dir = join(process.cwd(), "lib", "sample-references", "cutplans");
  const cutPlans: CutPlan[] = [];

  for (const name of SAMPLE_FILES) {
    try {
      const raw = await readFile(join(dir, name), "utf-8");
      const parsed = JSON.parse(raw);
      cutPlans.push(CutPlanSchema.parse(parsed));
    } catch (e) {
      console.warn(
        `[sample-references] failed to load ${name}:`,
        (e as Error).message,
      );
    }
  }

  cache = cutPlans;
  cacheTime = Date.now();
  return cutPlans;
}

export async function loadReferenceCutPlans(
  _filter: ReferenceFilter = {},
): Promise<ReferenceLoadResult> {
  const all = await loadSamples();
  return {
    cutPlans: all,
    source: "sample",
    notice:
      "Demo 数据池：仅 2 条手工挑选的爆款样本（vlog + transformation）。Phase 6 完成后会按用户题材+形态自动匹配 5-10 条真实库爆款。",
  };
}
