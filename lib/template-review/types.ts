import type { ViralVideo } from "@/lib/review-engine/types";
import type { DivergenceMethodId } from "./divergence-methods";

// ===== 场景 A：审核脑暴 =====

export type TemplateAuditInput = {
  /** 特效模板/脑暴的概念名 */
  effectName: string;
  /** 玩法描述（用户自定义，简短） */
  playStyle?: string;
  /** 视觉风格描述 */
  visualStyle?: string;
  /** 技术依赖（底模 / LoRA / 云特效 / 算法等） */
  techStack?: string;
  /** 完整脑暴文档原文 */
  document: string;
};

export type TemplateAuditDimension =
  | "创新性"
  | "传播潜力"
  | "交互易用性"
  | "技术可行性"
  | "性能稳定性"
  | "合规风险"
  | "市场验证度";

export type TemplateAuditScore = {
  dimension: TemplateAuditDimension;
  score: 1 | 2 | 3 | 4 | 5;
  reason: string;
};

export type TemplateAuditVerdict = {
  level: "recommended" | "conditional" | "not_recommended";
  headline: string;
  topRisks: string[];
};

export type TemplateAuditMarketSignal = {
  /** 同方向已有爆款数（基于检索结果） */
  similarViralCount: number;
  /** 这些爆款的平均播放量 */
  avgViews: number;
  /** 主流玩法分布（来自检索结果） */
  dominantPlayStyles: { name: string; weight: number }[];
  /** 还没被占据的"空缺方向"（LLM 推断） */
  marketGaps: string[];
  /** 已经过气的方向（LLM 推断） */
  fadingTrends: string[];
};

export type TemplateCapabilityRequirement = {
  category: "底模" | "LoRA / 风格" | "云特效" | "算法 / Vision" | "音视频后处理" | "其他";
  capability: string;
  /** 已有 / 需新建 / 部分支持 */
  readiness: "ready" | "partial" | "missing";
  note: string;
};

export type TemplateSuggestion = {
  title: string;
  issue: string;
  impact: string;
  fix: string;
  benchmark: string;
};

export type TemplateInterrogation = {
  category: string;
  question: string;
};

export type TemplateAction = {
  what: string;
  how: string;
  why: string;
  who: string;
};

export type TemplateAuditResult = {
  verdict: TemplateAuditVerdict;
  scores: TemplateAuditScore[];
  marketSignal: TemplateAuditMarketSignal;
  capabilities: TemplateCapabilityRequirement[];
  suggestions: TemplateSuggestion[];
  interrogation: TemplateInterrogation[];
  actions: TemplateAction[];
  /** 具体引用的同类爆款 */
  referenceVideos: ViralVideo[];
};

// ===== 场景 B：探索方向 =====

export type ExploreFilter = {
  /** 题材筛选（可选） */
  topic?: string;
  /** 玩法筛选（可选） */
  playStyle?: string;
  /** 平台筛选（可选） */
  platform?: "tiktok" | "instagram";
  /** 自由文本约束（"我们团队擅长 AI 渲染"等） */
  context?: string;
};

export type DirectionRecommendation = {
  /** 赛道名 */
  trackName: string;
  /** 一句话定位 */
  positioning: string;
  /** 当前市场容量描述 */
  marketSize: string;
  /** 主流玩法分布 */
  dominantPlayStyles: string[];
  /** 主流视觉风格 */
  dominantVisualStyles: string[];
  /** 推荐做的具体特效模板形态（细粒度） */
  suggestedTemplate: {
    name: string;
    coreCapability: string;
    differentiator: string;
  };
  /** 数据来源标注 */
  source: "data_driven" | "llm_inferred";
  /** 风险点 */
  risks: string[];
  /** 引用的爆款样本（最多 3 条） */
  references: ViralVideo[];
};

export type ExploreResult = {
  /** 整体大盘观察 */
  overview: string;
  /** 推荐赛道 */
  recommendations: DirectionRecommendation[];
  /** 应该规避的方向 */
  avoidDirections: { name: string; reason: string }[];
};

// ===== 场景 C：脑爆生成 (Generator v0.3) =====

export type PlaybookType = "A" | "B" | "C";

export type BrainstormGoal = {
  name: string;
  weight?: number;
};

export type BrainstormMethodSelection =
  | { mode: "single"; methodId: DivergenceMethodId }
  | {
      mode: "compare";
      methodA: DivergenceMethodId;
      methodB: DivergenceMethodId;
    };

export type BrainstormInput = {
  capabilities: string[];
  playbookTypes: PlaybookType[];
  goals: BrainstormGoal[];
  scene: string;
  userProblem: string;
  briefSummary?: string;
  method: BrainstormMethodSelection;
};

export type BrainstormIdea = {
  highlight: string;
  core_play: string;
  output_form: string;
  context_signals: string;
  user_intent_gap: string;
  user_motivation: string;
  interaction_flow: string;
  ai_necessity: string;
  goal_fit: string;
  playbook_mix: string;
  capabilities_used: string[];
  consumption_hook: string;
  interaction_motivation: string;
  risk: string;
  market_reference: string;
};

export type BrainstormRuleCheck = {
  passed: boolean;
  violations: string[];
};

export type BrainstormSingleResult = {
  mode: "single";
  methodId: DivergenceMethodId;
  ideas: BrainstormIdea[];
  ruleCheck: BrainstormRuleCheck;
  diversityWarning?: string;
  referenceVideos: ViralVideo[];
};

export type BrainstormCompareResult = {
  mode: "compare";
  methodA: {
    id: DivergenceMethodId;
    ideas: BrainstormIdea[];
    ruleCheck: BrainstormRuleCheck;
  };
  methodB: {
    id: DivergenceMethodId;
    ideas: BrainstormIdea[];
    ruleCheck: BrainstormRuleCheck;
  };
  compareSummary: string;
  recommendedMethod: DivergenceMethodId;
  diversityWarning?: string;
  referenceVideos: ViralVideo[];
};

export type BrainstormResult = BrainstormSingleResult | BrainstormCompareResult;
