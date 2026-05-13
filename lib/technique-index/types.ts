/**
 * Technique tag 命名空间：
 *   每个维度独立 tag list，避免 "push-in"（camera）和 "match-cut"（cut）混淆。
 *   tag 字符串采用 kebab-case，从 CutPlan.actions[].kind/type 标准化而来。
 */
export type TechniqueTags = {
  /** 来自 CutAction.toShotSize 变化 / kind=="cut" 的特殊语义（match-cut 等） */
  cuts: string[];
  /** 来自 TransitionAction.type（normalize 后） */
  transitions: string[];
  /** 来自 CameraMoveAction.type */
  cameraMoves: string[];
  /** 来自 SpeedChangeAction（freeze / ramp-up / slow-mo / ...） */
  speedChanges: string[];
  /** 来自 EffectAction.type */
  effects: string[];
  /** 来自 SubtitleAction.style.animation（kinetic / static / ...） */
  subtitleStyles: string[];
  /** 来自 BgmMarker.kind（beat / drop / vocal_phrase / ...） */
  audioSyncAnchors: string[];
  /** 来自 StructureDimension.hookFormat */
  hookFormats: string[];
};

export type TechniqueIndex = {
  /** 索引版本，方便日后破坏性升级 */
  version: 1;
  /** 生成时间戳（ISO） */
  generatedAt: string;
  /** 入索引的视频数 */
  videoCount: number;
  /** 反向：tag → 命中的 videoId list（按 density.overall 降序） */
  byTechnique: Record<string, string[]>;
  /** 正向：videoId → 它有哪些 tag（方便从用户匹配结果反查） */
  videoTags: Record<string, TechniqueTags>;
};

/** 用于「召回时给候选打分」：候选 video 的 tag 跟用户 desired tag 的命中数 */
export type CandidateScore = {
  videoId: string;
  matchedTags: string[];
  score: number;
};
