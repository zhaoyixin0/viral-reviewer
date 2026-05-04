import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { buildBrainstormSystemPrompt } from "./brainstorm-prompt";
import {
  DIVERGENCE_METHODS_BY_ID,
  type DivergenceMethodId,
} from "./divergence-methods";
import type {
  BrainstormInput,
  BrainstormIdea,
  BrainstormRuleCheck,
} from "./types";
import type { ViralVideo } from "@/lib/review-engine/types";

let client: Anthropic | null = null;
function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

function extractFirstJSONObject(text: string): string | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function buildUserPayload(args: {
  input: BrainstormInput;
  viralVideos: ViralVideo[];
  topicMatched: boolean;
}): string {
  return JSON.stringify(
    {
      inputs: {
        capabilities: args.input.capabilities,
        playbookTypes: args.input.playbookTypes,
        goals: args.input.goals,
        scene: args.input.scene,
        userProblem: args.input.userProblem,
      },
      briefSummary: args.input.briefSummary || "",
      benchmark: {
        topicMatched: args.topicMatched,
        viralVideos: args.viralVideos.map((v) => ({
          platform: v.platform,
          author: v.authorHandle,
          views: v.views,
          likes: v.likes,
          duration: v.duration,
          title: v.title,
          playStyle: v.playStyle,
          visualStyle: v.visualStyle,
          hook: v.hook,
          bgm: v.bgm,
          tags: v.tags,
        })),
      },
    },
    null,
    2,
  );
}

function isIdea(x: unknown): x is BrainstormIdea {
  if (!x || typeof x !== "object") return false;
  const i = x as Record<string, unknown>;
  return (
    typeof i.highlight === "string" &&
    typeof i.core_play === "string" &&
    typeof i.output_form === "string" &&
    typeof i.context_signals === "string" &&
    typeof i.user_intent_gap === "string" &&
    typeof i.user_motivation === "string" &&
    typeof i.interaction_flow === "string" &&
    typeof i.ai_necessity === "string" &&
    typeof i.goal_fit === "string" &&
    typeof i.playbook_mix === "string" &&
    Array.isArray(i.capabilities_used) &&
    typeof i.consumption_hook === "string" &&
    typeof i.interaction_motivation === "string" &&
    typeof i.risk === "string" &&
    typeof i.market_reference === "string"
  );
}

export type BrainstormGenerationOutput = {
  ideas: BrainstormIdea[];
  ruleCheck: BrainstormRuleCheck;
};

export async function generateBrainstormSingle(args: {
  input: BrainstormInput;
  methodId: DivergenceMethodId;
  viralVideos: ViralVideo[];
  topicMatched: boolean;
}): Promise<BrainstormGenerationOutput> {
  const systemPrompt = buildBrainstormSystemPrompt({
    methodId: args.methodId,
    capabilityIds: args.input.capabilities,
  });
  const userPayload = buildUserPayload(args);

  const response = await getClient().messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-opus-4-7",
    max_tokens: 16384,
    system: systemPrompt,
    messages: [{ role: "user", content: userPayload }],
  });

  const block = response.content[0];
  const text = block?.type === "text" ? block.text : "";
  const json = extractFirstJSONObject(text);
  if (!json) {
    throw new Error(
      `Generator LLM output: no balanced JSON object found (got ${text.length} chars)`,
    );
  }
  const parsed = JSON.parse(json) as Record<string, unknown>;

  const rawIdeas = Array.isArray(parsed.ideas) ? parsed.ideas : [];
  const ideas = rawIdeas.filter(isIdea);

  let ruleCheck: BrainstormRuleCheck = { passed: true, violations: [] };
  if (parsed.rule_check && typeof parsed.rule_check === "object") {
    const rc = parsed.rule_check as Record<string, unknown>;
    ruleCheck = {
      passed: typeof rc.passed === "boolean" ? rc.passed : ideas.length > 0,
      violations: Array.isArray(rc.violations)
        ? rc.violations.filter((v: unknown): v is string => typeof v === "string")
        : [],
    };
  }

  return { ideas, ruleCheck };
}

const COMPARE_SUMMARY_SYSTEM_PROMPT = `你是发散方法对比评审员。
拿到两批基于同一题目、用不同发散方法产出的 idea，你要给一段 200-400 字的对比总结。

## 输出 JSON（不要 markdown 包裹）

{
  "summary": "对比总结正文（必须明确推荐其中一个方法，不允许写"两者各有优劣"等和稀泥措辞）",
  "recommended": "methodA 或 methodB（必填，必须是其中之一）"
}

## 写作要求

1. 先 30 字内点出"两个方法在这道题上的气质差异"
2. 再分别讲每个方法的最强 idea + 最弱 idea
3. 最后明确推荐哪一个方法 + 理由（基于 idea 的可立项度 / 用户动机扎根度 / 与 brief 契合度）
4. 推荐字段必须填具体的 methodA / methodB 名称（id），不允许写 "两者并行" / "都行" / "看具体场景"`;

export async function generateCompareSummary(args: {
  input: BrainstormInput;
  ideasA: BrainstormIdea[];
  ideasB: BrainstormIdea[];
  methodAId: DivergenceMethodId;
  methodBId: DivergenceMethodId;
}): Promise<{ summary: string; recommended: DivergenceMethodId }> {
  const methodAName = DIVERGENCE_METHODS_BY_ID[args.methodAId].name;
  const methodBName = DIVERGENCE_METHODS_BY_ID[args.methodBId].name;
  const payload = JSON.stringify(
    {
      task: {
        scene: args.input.scene,
        userProblem: args.input.userProblem,
        briefSummary: args.input.briefSummary || "",
      },
      methodA: {
        id: args.methodAId,
        name: methodAName,
        ideas: args.ideasA.map((i) => ({
          highlight: i.highlight,
          core_play: i.core_play,
          ai_necessity: i.ai_necessity,
          risk: i.risk,
        })),
      },
      methodB: {
        id: args.methodBId,
        name: methodBName,
        ideas: args.ideasB.map((i) => ({
          highlight: i.highlight,
          core_play: i.core_play,
          ai_necessity: i.ai_necessity,
          risk: i.risk,
        })),
      },
    },
    null,
    2,
  );

  const response = await getClient().messages.create({
    model:
      process.env.ANTHROPIC_HAIKU_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: COMPARE_SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: payload }],
  });

  const block = response.content[0];
  const text = block?.type === "text" ? block.text : "";
  const json = extractFirstJSONObject(text);
  if (!json) {
    return {
      summary: "对比总结生成失败 — 请重试或改用单方法模式。",
      recommended: args.methodAId,
    };
  }
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const summary =
    typeof parsed.summary === "string" && parsed.summary.length > 0
      ? parsed.summary
      : "对比总结输出格式异常。";
  const recRaw = parsed.recommended;
  const recommended: DivergenceMethodId =
    recRaw === args.methodBId ? args.methodBId : args.methodAId;
  return { summary, recommended };
}

const NON_TOKEN_CHARS = /[^a-z0-9一-龥]/g;

function bigrams(s: string): Set<string> {
  const cleaned = s.toLowerCase().replace(NON_TOKEN_CHARS, "");
  const out = new Set<string>();
  for (let i = 0; i < cleaned.length - 1; i++) {
    out.add(cleaned.slice(i, i + 2));
  }
  return out;
}

function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

const DIVERSITY_THRESHOLD = 0.4;
const DIVERSITY_PAIR_RATIO = 0.3;

export function detectDiversityWarning(
  ideas: BrainstormIdea[],
): string | undefined {
  if (ideas.length < 2) return undefined;
  const grams = ideas.map((i) =>
    bigrams(`${i.highlight} ${i.core_play} ${i.user_motivation}`),
  );
  const similarPairs: { a: number; b: number; sim: number }[] = [];
  for (let i = 0; i < grams.length; i++) {
    for (let j = i + 1; j < grams.length; j++) {
      const sim = jaccardSim(grams[i], grams[j]);
      if (sim > DIVERSITY_THRESHOLD) {
        similarPairs.push({ a: i, b: j, sim: Number(sim.toFixed(2)) });
      }
    }
  }
  const totalPairs = (ideas.length * (ideas.length - 1)) / 2;
  if (similarPairs.length / totalPairs > DIVERSITY_PAIR_RATIO) {
    const top = similarPairs
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 3)
      .map(
        (p) =>
          `idea#${p.a + 1} ↔ idea#${p.b + 1}（相似度 ${p.sim}）`,
      )
      .join("、");
    return `本次 ${ideas.length} 条 idea 中检测到 ${similarPairs.length}/${totalPairs} 对趋同（bigram jaccard > ${DIVERSITY_THRESHOLD}）。最相似的：${top}。建议换发散方法或调整能力组合后重出。`;
  }
  return undefined;
}
