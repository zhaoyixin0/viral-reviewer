import "server-only";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { CutPlanSchema, type CutPlan } from "@/lib/cut-plan/schema";
import { loadTechniqueIndex } from "@/lib/technique-index/load-index";
import { scoreCandidates } from "@/lib/technique-index/similarity";
import { retrieveSimilarVideos } from "@/lib/review-engine/retrieval";
import type { ReviewInputVideo, ViralVideo } from "@/lib/review-engine/types";
import { createLogger } from "@/lib/observability/structured-log";

const log = createLogger({ module: "sample-references/index" });

const ENRICHED_DIR = "data/enriched-cutplans";
const FALLBACK_DIR = "lib/sample-references/cutplans";
const FALLBACK_FILES = [
  "transformation-match-cut.json",
  "vlog-pull-out-aerial.json",
] as const;

export type LiveFallbackInput = {
  audience?: string;
  scene?: string;
  draft?: string;
  videoFeatures?: ReviewInputVideo["videoFeatures"];
};

export type ReferenceFilter = {
  userFormat?: string;
  userTopic?: string;
  /** P2 新增：用户期望的技法 tag（来自 potential → desiredTags 映射） */
  desiredTechniques?: string[];
  /**
   * P3 新增：当本地池召回不够时，启用 review-engine 的实时抓取兜底。
   * 提供 audience/scene/draft/videoFeatures 让 review-engine 的 topic
   * inference 能用，没提供则跳过实时抓取。
   */
  liveFallback?: LiveFallbackInput;
  limit?: number;
};

export type ReferenceSource =
  | "sample"
  | "database"
  | "technique-cluster"
  | "live-metadata"
  | "mixed";

export type ReferenceLoadResult = {
  cutPlans: CutPlan[];
  source: ReferenceSource;
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
      log.warn("skip file", { file: f, err: e });
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

/**
 * 把实时抓取的 ViralVideo metadata 包装成 minimal CutPlan stub，让下游
 * match-engine 能直接消费（match-engine 不会 crash on empty actions / 占位
 * density）。这条 stub 的 density.overall 设 60（比真富化的 70+ 低一档），
 * 避免它在 mixed 召回里抢真实富化数据的 top 位。
 */
export function viralVideoToCutPlanStub(v: ViralVideo, fallbackFormat: string): CutPlan {
  const safeId =
    v.id || `live-${v.url.replace(/[^a-z0-9]/gi, "").slice(-16)}` || "live-unknown";
  return {
    videoId: safeId,
    durationSec: v.duration > 0 ? v.duration : 30,
    fps: 30,
    videoFormat: v.videoFormat ?? fallbackFormat ?? "ugc_native",
    videoFormatConfidence: v.videoFormatConfidence ?? 0.5,
    actions: [],
    bgm: null,
    dimensions: {
      pacing: {
        shotCount: 0,
        avgShotDurationSec: 0,
        cutDensityPerSec: 0,
        rhythmProfile: "",
        keyTwistAt: null,
      },
      camera: {
        dominantMovements: [],
        shotSizeDistribution: {
          extreme_close_up: 0,
          close_up: 0,
          medium: 0,
          wide: 0,
          extreme_wide: 0,
        },
        transitionPatterns: [],
      },
      audiovisual: {
        bgmPattern: v.bgm ?? "",
        bgmSyncTightness: "",
        subtitleStyle: "",
        colorGrade: v.visualStyle ?? "",
      },
      structure: {
        hookFormat: v.hook ?? "",
        openingShot: "",
        endingShot: "",
        cta: "",
        payoffAt: null,
      },
    },
    density: {
      editing: 50,
      transition: 30,
      effect: 20,
      bgmSync: 50,
      overall: 60,
    },
    meta: {
      model: "live-metadata-stub",
      analyzedAt: new Date().toISOString(),
      sourceUrl: v.url,
    },
  };
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
  let formatMatched = false;
  if (filter.userFormat) {
    const matched = filterByFormat(plans, filter.userFormat);
    if (matched.length >= limit) {
      pool = matched;
      formatMatched = true;
    }
  }

  const top = pool
    .slice()
    .sort((a, b) => (b.density.overall ?? 0) - (a.density.overall ?? 0))
    .slice(0, limit);

  // Path C: 实时抓取兜底（P3）
  // 触发条件：用户提供了 liveFallback 上下文，且本地池没能给出至少 ceil(limit/2)
  // 条同 format 的命中（说明本地池对该题材/形态覆盖不足）
  const lowCoverage = !formatMatched || top.length < Math.ceil(limit / 2);
  if (filter.liveFallback && lowCoverage) {
    try {
      const live = await retrieveSimilarVideos({
        topic: filter.userTopic,
        audience: filter.liveFallback.audience,
        scene: filter.liveFallback.scene,
        draft: filter.liveFallback.draft,
        videoFeatures: filter.liveFallback.videoFeatures,
        topK: limit + 2,
      });

      if (live.videos.length > 0) {
        const need = Math.max(0, limit - top.length);
        const stubs = live.videos
          .slice(0, need + 2)
          .map((v) => viralVideoToCutPlanStub(v, filter.userFormat ?? "ugc_native"));
        // 真实富化数据优先（top 在前），stub 追加补足
        const merged = [...top, ...stubs].slice(0, limit);
        const liveCount = merged.length - top.length;
        return {
          cutPlans: merged,
          source: top.length > 0 ? "mixed" : "live-metadata",
          notice:
            top.length > 0
              ? `本地富化池命中 ${top.length} 条；实时抓取 ${liveCount} 条 metadata 补充（深度数据未跑富化）`
              : `本地池未命中，实时抓取 ${liveCount} 条 metadata 作 fallback（深度数据未跑富化）`,
        };
      }
    } catch (e) {
      log.warn("live fallback failed", { err: e });
    }
  }

  return {
    cutPlans: top,
    source,
    notice:
      source === "database"
        ? `从富化爆款池中按 format=${filter.userFormat ?? "any"} 召回 ${top.length} 条`
        : `Demo 数据池：${top.length} 条手工样本（富化未跑或失败）`,
  };
}
