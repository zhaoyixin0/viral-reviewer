import type { CandidateScore, TechniqueIndex } from "./types";

/**
 * 用 ReadonlyArray<unknown> 而非具体形状：函数只看 `.length`，调用方传入的
 * `MaterialPotential.potential.*` 字段形状演化不会破坏这里。
 */
export type DesiredFromPotential = {
  pushInOpportunities: ReadonlyArray<unknown>;
  matchCutCandidates: ReadonlyArray<unknown>;
  sceneTransitionCandidates: ReadonlyArray<unknown>;
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
 * 多视频版本：把 N 个 MaterialPotential 的维度聚合成单一 desired tag list（去重）。
 *
 * 规则：任一视频在某维度有候选，desired tag 就上 —— 用户的"素材池整体期望"。
 * 不改 `potentialToDesiredTags` 单视频签名，老 caller / 测试不受影响。
 */
export function potentialsToDesiredTags(
  potentials: ReadonlyArray<DesiredFromPotential>,
): string[] {
  const acc = new Set<string>();
  for (const p of potentials) {
    for (const tag of potentialToDesiredTags(p)) acc.add(tag);
  }
  return [...acc];
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
