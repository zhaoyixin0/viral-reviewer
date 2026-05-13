import type { CutPlan } from "@/lib/cut-plan/schema";
import type { TechniqueIndex, TechniqueTags } from "./types";
import { extractTechniqueTags } from "./extract-tags";

const DIMENSION_PREFIXES: Record<keyof TechniqueTags, string> = {
  cuts: "cut",
  transitions: "transition",
  cameraMoves: "camera-move",
  speedChanges: "speed-change",
  effects: "effect",
  subtitleStyles: "subtitle",
  audioSyncAnchors: "audio-sync",
  hookFormats: "hook",
};

export function buildTechniqueIndex(plans: CutPlan[]): TechniqueIndex {
  const byTechnique = new Map<string, { videoId: string; score: number }[]>();
  const videoTags: Record<string, TechniqueTags> = {};

  for (const plan of plans) {
    const tags = extractTechniqueTags(plan);
    videoTags[plan.videoId] = tags;

    for (const dim of Object.keys(DIMENSION_PREFIXES) as (keyof TechniqueTags)[]) {
      const prefix = DIMENSION_PREFIXES[dim];
      for (const tag of tags[dim]) {
        if (!tag) continue;
        const key = `${prefix}:${tag}`;
        const list = byTechnique.get(key) ?? [];
        list.push({ videoId: plan.videoId, score: plan.density.overall ?? 0 });
        byTechnique.set(key, list);
      }
    }
  }

  const sortedByTechnique: Record<string, string[]> = {};
  for (const [k, list] of byTechnique) {
    sortedByTechnique[k] = list
      .sort((a, b) => b.score - a.score)
      .map((x) => x.videoId);
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    videoCount: plans.length,
    byTechnique: sortedByTechnique,
    videoTags,
  };
}
