export type VerdictLevel = "recommended" | "conditional" | "not_recommended";

export type ReviewVerdict = {
  level: VerdictLevel;
  headline: string;
  topRisks: string[];
};

export type ReviewDimension =
  | "钩子强度"
  | "身份认同"
  | "节奏密度"
  | "算法友好度"
  | "视觉质感"
  | "传播性";

export type ReviewScore = {
  dimension: ReviewDimension;
  score: 1 | 2 | 3 | 4 | 5;
  reason: string;
};

export type ViralFormula = {
  topic: string;
  playStyles: { name: string; weight: number }[];
  visualStyles: { name: string; weight: number }[];
  hookPattern: string;
  avgDuration: string;
  bgmStyle: string;
};

export type TimelineSegment = {
  range: string;
  label: string;
  shots: string;
  transition: string;
  bgm: string;
  subtitles: string;
  tip: string;
};

export type Suggestion = {
  title: string;
  issue: string;
  impact: string;
  fix: string;
  benchmark: string;
};

export type Interrogation = {
  category: string;
  question: string;
};

export type ActionItem = {
  what: string;
  how: string;
  why: string;
  who: string;
};

export type ReviewResult = {
  verdict: ReviewVerdict;
  scores: ReviewScore[];
  viralFormula: ViralFormula;
  timeline: TimelineSegment[];
  suggestions: Suggestion[];
  interrogation: Interrogation[];
  actions: ActionItem[];
};

export type ReviewInputText = {
  type: "text";
  topic: string;
  audience: string;
  scene: string;
  draft?: string;
};

export type ReviewInputVideo = {
  type: "video";
  topic: string;
  audience: string;
  scene: string;
  videoFeatures: {
    duration: number;
    frameSamples: { timestamp: number; description: string }[];
    transcript: string;
    detectedHook: string;
    detectedPlayStyle: string;
    detectedVisualStyle: string;
  };
};

export type ReviewInput = ReviewInputText | ReviewInputVideo;

export type ViralVideo = {
  id: string;
  platform: "tiktok" | "instagram";
  url: string;
  cover: string;
  title: string;
  description: string;
  topic: string;
  tags: string[];
  views: number;
  likes: number;
  comments: number;
  shares: number;
  duration: number;
  playStyle: string;
  visualStyle: string;
  hook: string;
  bgm: string;
  authorHandle: string;
  publishedAt: string;

  // ===== Phase 1+ 扩展字段（可选，向后兼容现有 enriched JSON） =====

  /**
   * 视频形态（B+C 方案的 C 部分）
   * vlog / tutorial / transformation / skit / comedy / listicle / review /
   * pov / interview / edit / ugc_native / other
   * 跨题材的形态维度，retrieval 可独立筛选。
   */
  videoFormat?: string;
  videoFormatConfidence?: number;

  /**
   * 技法密度评分（0-100），用于 technique 模式筛选
   * 用于区分"靠技术火"（高分进入剪辑参考池）vs"靠内容火"（低分仅做内容标杆）
   */
  density?: {
    editing: number;
    transition: number;
    effect: number;
    bgmSync: number;
    overall: number;
  };

  /**
   * 完整 CutPlan IR（Gemini 解析结果）
   * 富化时可选填，文件可能较大（每条 ~5-15KB），仅在 technique-matching 流程读取
   */
  cutPlanRef?: string; // 指向 data/scraped/cutplans/<id>.json 的引用，避免主 JSON 膨胀
};
