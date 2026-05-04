import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import pdf from "pdf-parse/lib/pdf-parse.js";

export type PlaybookType = "A" | "B" | "C";

export type ExtractedGoal = {
  name: string;
  weight?: number;
};

export type ExtractedBrief = {
  capabilities: string[];
  playbookTypes: PlaybookType[];
  goals: ExtractedGoal[];
  scene: string;
  userProblem: string;
  briefSummary: string;
  confidence: number;
};

export type BriefExtractError =
  | { kind: "too_many_pages"; pages: number }
  | { kind: "empty_text"; pages: number }
  | { kind: "parse_failed"; message: string }
  | { kind: "llm_failed"; message: string };

export class BriefExtractException extends Error {
  readonly detail: BriefExtractError;
  constructor(detail: BriefExtractError) {
    super(detail.kind);
    this.detail = detail;
  }
}

const MAX_PAGES = 30;
const MIN_TEXT_LENGTH = 50;
const BRIEF_SUMMARY_MAX_CHARS = 1500;
const LLM_INPUT_MAX_CHARS = 8000;

type ParsedPDF = {
  rawText: string;
  pages: number;
};

async function parsePDF(buffer: Buffer): Promise<ParsedPDF> {
  let result;
  try {
    result = await pdf(buffer);
  } catch (e) {
    throw new BriefExtractException({
      kind: "parse_failed",
      message: (e as Error).message,
    });
  }
  const pages = result.numpages ?? 0;
  if (pages > MAX_PAGES) {
    throw new BriefExtractException({ kind: "too_many_pages", pages });
  }
  const rawText = (result.text ?? "").trim();
  if (rawText.length < MIN_TEXT_LENGTH) {
    throw new BriefExtractException({ kind: "empty_text", pages });
  }
  return { rawText, pages };
}

const TITLE_WORDS = [
  "目标",
  "场景",
  "用户",
  "痛点",
  "能力",
  "玩法",
  "问题",
  "需求",
  "策略",
  "机制",
  "钩子",
  "假设",
  "数据",
  "结论",
];

function scoreParagraph(p: string): number {
  if (!p || p.length < 15) return -1;
  let s = 0;
  if (/\d/.test(p)) s += 1;
  if (/[%％]|万|亿|M\b|K\b/.test(p)) s += 1;
  if (/[""''「」]/.test(p)) s += 1;
  for (const w of TITLE_WORDS) {
    if (p.includes(w)) {
      s += 2;
      break;
    }
  }
  if (p.length >= 30 && p.length <= 400) s += 1;
  return s;
}

const TITLE_LINE_PATTERN =
  /^([一二三四五六七八九十百千]+[、.])|^(\d+[.、)）])|^[#＃]+\s|[：:]\s*$/;

/**
 * 把 PDF rawText 切成段落。
 * PDF 文本里换行往往是 textframe 视觉换行，不是语义段落。
 * 策略：先按双换行切；如果切出的块太少 / 太大，再按"标题行"做二次切分。
 */
function splitParagraphs(rawText: string): string[] {
  const initial = rawText
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const tooFewOrTooBig =
    initial.length < 5 || initial.some((b) => b.length > 1200);

  if (!tooFewOrTooBig) {
    return initial.map((p) => p.replace(/\s+/g, " "));
  }

  const lines = rawText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    const isTitle = line.length < 40 && TITLE_LINE_PATTERN.test(line);
    if (isTitle && current.length > 0) {
      blocks.push(current.join(" "));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current.join(" "));

  return blocks.map((b) => b.replace(/\s+/g, " ")).filter((b) => b.length > 0);
}

/**
 * 取含数字 / 标题词 / 用户原话的段落，按文档顺序拼接到 1500 字以内。
 * 不调 LLM — 避免多一次 API 来回。
 */
function pickBriefSummary(rawText: string): string {
  const paragraphs = splitParagraphs(rawText);
  if (paragraphs.length === 0) return "";

  const ranked = paragraphs
    .map((p, idx) => ({ p, idx, score: scoreParagraph(p) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const selected = new Set<number>();
  let total = 0;
  for (const item of ranked) {
    const chunk =
      item.p.length > 400 ? item.p.slice(0, 400) + "…" : item.p;
    if (total + chunk.length > BRIEF_SUMMARY_MAX_CHARS) continue;
    selected.add(item.idx);
    total += chunk.length;
    if (total >= BRIEF_SUMMARY_MAX_CHARS * 0.9) break;
  }

  // Fallback: 一段都没选中（如全是无标题词的纯描述），取前 1500 字
  if (selected.size === 0) {
    return paragraphs.join("\n\n").slice(0, BRIEF_SUMMARY_MAX_CHARS);
  }

  const orderedIndices = [...selected].sort((a, b) => a - b);
  return orderedIndices
    .map((i) => {
      const p = paragraphs[i];
      return p.length > 400 ? p.slice(0, 400) + "…" : p;
    })
    .join("\n\n");
}

const EXTRACT_SYSTEM_PROMPT = `你是 TikTok 内部 PM 团队的脑暴文档结构化助手。
读一份特效/玩法立项 brief 文档，抽出 4 件套 + 痛点字段。

## 输出 JSON（不要 markdown 包裹，直接给 JSON 对象）

{
  "capabilities": ["能力名1", "能力名2"],
  "playbookTypes": ["A" | "B" | "C"],
  "goals": [{ "name": "目标名", "weight": 0-1 可选 }],
  "scene": "一句话场景描述",
  "userProblem": "一句话用户痛点",
  "confidence": 0-1
}

## 字段定义

- capabilities: 文档提到的 AI / 特效 / 工具能力（如"AI 换脸""动作捕捉""贴纸"等）
- playbookTypes: A=内容玩法, B=功能链路, C=机制玩法（按文档语义判断，可多选）
- goals: 文档明确提到的目标（如"传播""留存""付费""人设沉淀""功能拉新"），weight 是文档强调程度的主观估计
- scene: 场景（如"feed 流""直播间""DM 私信""profile 主页""社交聊天"）
- userProblem: 用户当前的核心痛点 / 未被满足的需求
- confidence: 0-1，0.9+ 表示文档清晰且字段明确，0.5-0.7 表示需用户复核，<0.5 表示文档结构松散

## 抽取规则

- 如果某字段文档没明确提到，留空数组或空字符串，不要编造
- capabilities 是文档原文用词，不要翻译或归纳
- scene / userProblem 必须是一句话（不超过 80 字）`;

/**
 * 从 LLM 输出中提取第一个完整 JSON 对象。
 * 跳过字符串内的 { } 干扰；遇到第一个深度归零即返回。
 */
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

async function llmExtract(rawText: string): Promise<{
  capabilities: string[];
  playbookTypes: PlaybookType[];
  goals: ExtractedGoal[];
  scene: string;
  userProblem: string;
  confidence: number;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new BriefExtractException({
      kind: "llm_failed",
      message: "ANTHROPIC_API_KEY not configured",
    });
  }
  const client = new Anthropic({ apiKey });
  const truncated =
    rawText.length > LLM_INPUT_MAX_CHARS
      ? rawText.slice(0, LLM_INPUT_MAX_CHARS) + "\n[…文档过长已截断]"
      : rawText;
  let response;
  try {
    response = await client.messages.create({
      model: process.env.ANTHROPIC_HAIKU_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: EXTRACT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: truncated }],
    });
  } catch (e) {
    throw new BriefExtractException({
      kind: "llm_failed",
      message: (e as Error).message,
    });
  }
  const block = response.content[0];
  const text = block?.type === "text" ? block.text : "";
  const jsonObject = extractFirstJSONObject(text);
  if (!jsonObject) {
    throw new BriefExtractException({
      kind: "llm_failed",
      message: `No balanced JSON object found in LLM output (got ${text.length} chars)`,
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonObject);
  } catch (e) {
    throw new BriefExtractException({
      kind: "llm_failed",
      message: `JSON parse failed: ${(e as Error).message}`,
    });
  }
  return {
    capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities : [],
    playbookTypes: Array.isArray(parsed.playbookTypes)
      ? (parsed.playbookTypes.filter((t: unknown): t is PlaybookType =>
          t === "A" || t === "B" || t === "C",
        ) as PlaybookType[])
      : [],
    goals: Array.isArray(parsed.goals)
      ? parsed.goals.filter(
          (g: unknown): g is ExtractedGoal =>
            typeof g === "object" && g !== null && typeof (g as ExtractedGoal).name === "string",
        )
      : [],
    scene: typeof parsed.scene === "string" ? parsed.scene : "",
    userProblem: typeof parsed.userProblem === "string" ? parsed.userProblem : "",
    confidence:
      typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
  };
}

export async function extractBriefFromPDF(buffer: Buffer): Promise<ExtractedBrief> {
  const { rawText } = await parsePDF(buffer);
  const briefSummary = pickBriefSummary(rawText);
  const extracted = await llmExtract(rawText);
  return {
    ...extracted,
    briefSummary,
  };
}
