import type { CandidateScore, TechniqueIndex } from "./types";

export type DesiredFromPotential = {
  pushInOpportunities: Array<{ at: { sec: number }; reason: string }>;
  matchCutCandidates: Array<{
    pairId: string;
    from: { sec: number };
    to: { sec: number };
    reason: string;
  }>;
  sceneTransitionCandidates: Array<{ at: { sec: number }; reason: string }>;
};

/**
 * 把用户视频的 Potential 维度映射成 "desired technique tag list"。
 * 例：用户视频探到 3 个 push-in 机会 → 用户期望对标"使用 push-in 的爆款"。
 */
export function potentialToDesiredTags(potential: DesiredFromPotential): string[] {
  const tags: string[] = [];
  if (potential.pushInOpportunities.length > 0) tags.push("camera-move:push-in");
  if (potential.matchCutCandidates.length > 0) tags.push("cut:match-cut");
  if (potential.sceneTransitionCandidates.length > 0) tags.push("transition:whip-pan");
  return tags;
}

/**
 * 给索引里每条候选打分：matched tag 数量越多分越高。
 */
export function scoreCandidates(
  index: TechniqueIndex,
  desiredTags: string[],
): CandidateScore[] {
  if (desiredTags.length === 0) return [];

  const counter = new Map<string, { matched: string[]; score: number }>();
  for (const tag of desiredTags) {
    const videoIds = index.byTechnique[tag] ?? [];
    for (const id of videoIds) {
      const entry = counter.get(id) ?? { matched: [], score: 0 };
      entry.matched.push(tag);
      entry.score++;
      counter.set(id, entry);
    }
  }

  return [...counter.entries()]
    .map(([videoId, { matched, score }]) => ({
      videoId,
      matchedTags: matched,
      score,
    }))
    .sort((a, b) => b.score - a.score || a.videoId.localeCompare(b.videoId));
}
