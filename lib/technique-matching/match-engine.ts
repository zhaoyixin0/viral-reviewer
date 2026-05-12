import Anthropic from "@anthropic-ai/sdk";
import {
  TechniqueMatchingResultSchema,
  type TechniqueMatchingResult,
} from "./types";
import { TECHNIQUE_MATCH_SYSTEM_PROMPT } from "./match-prompt";
import { normalizeTimeCode } from "@/lib/cut-plan/time-code";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";
import type { CutPlan } from "@/lib/cut-plan/schema";

/**
 * Opus 4.7 · 双向技法匹配引擎
 *
 * 输入：用户 MaterialPotential + N 条爆款 CutPlan
 * 输出：每条爆款的 TechniqueMatchReport + 跨爆款 topPriorityActions
 */

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
    client = new Anthropic({ apiKey });
  }
  return client;
}

export type MatchEngineInput = {
  userPotential: MaterialPotential;
  referenceCutPlans: CutPlan[];
  /** 用户描述的意图（用于权衡 priority） */
  userIntent?: string;
};

/**
 * 压缩 CutPlan 给 LLM（保留关键字段，去掉冗余 frame 字段以省 token）
 */
function compactCutPlan(cp: CutPlan) {
  return {
    videoId: cp.videoId,
    durationSec: cp.durationSec,
    fps: cp.fps,
    videoFormat: cp.videoFormat,
    videoFormatConfidence: cp.videoFormatConfidence,
    actions: cp.actions.map((a) => {
      const base = {
        kind: a.kind,
        at: { sec: a.at.sec },
      };
      return { ...a, ...base };
    }),
    bgm: cp.bgm,
    dimensions: cp.dimensions,
    density: cp.density,
    sourceUrl: cp.meta?.sourceUrl,
  };
}

function compactPotential(mp: MaterialPotential) {
  return {
    videoId: mp.videoId,
    detectedFormat: mp.detectedFormat,
    detectedFormatConfidence: mp.detectedFormatConfidence,
    base: compactCutPlan(mp.base),
    potential: mp.potential,
    adaptabilitySummary: mp.adaptabilitySummary,
  };
}

export async function matchTechniques(
  input: MatchEngineInput,
): Promise<TechniqueMatchingResult> {
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-7";

  const payload = {
    userPotential: compactPotential(input.userPotential),
    referenceCutPlans: input.referenceCutPlans.map(compactCutPlan),
    userIntent: input.userIntent ?? null,
  };

  const r = await getClient().messages.create({
    model,
    max_tokens: 16384,
    system: TECHNIQUE_MATCH_SYSTEM_PROMPT,
    messages: [
      { role: "user", content: JSON.stringify(payload, null, 2) },
    ],
  });

  const block = r.content[0];
  const text = block?.type === "text" ? block.text : "";
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");

  const raw = JSON.parse(cleaned);

  // 注入 meta + 用户 videoId
  raw.userVideoId = input.userPotential.videoId;
  raw.meta = {
    model,
    analyzedAt: new Date().toISOString(),
    referenceCount: input.referenceCutPlans.length,
  };

  // 时间戳归一化（补 frame 字段，与之前两个模块一致）
  const userFps = input.userPotential.base.fps;
  const normAt = (raw: unknown): unknown => {
    if (raw && typeof raw === "object") {
      const at = raw as { sec?: number; frame?: number };
      if (typeof at.sec === "number") {
        return normalizeTimeCode({ sec: at.sec, frame: at.frame }, userFps);
      }
    }
    return raw;
  };
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const obj = node as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (
        (k === "at" ||
          k === "userVideoAt" ||
          k === "sourceAt" ||
          k === "fromAt" ||
          k === "toAt") &&
        obj[k] &&
        typeof obj[k] === "object"
      ) {
        obj[k] = normAt(obj[k]);
      } else if (typeof obj[k] === "object") {
        walk(obj[k]);
      }
    }
  };
  walk(raw);

  try {
    return TechniqueMatchingResultSchema.parse(raw);
  } catch (e) {
    const { writeFile, mkdir } = await import("fs/promises");
    const { join } = await import("path");
    const dir = join(process.cwd(), "data", "probes", "_debug");
    await mkdir(dir, { recursive: true });
    const ts = Date.now();
    await writeFile(
      join(dir, `match-raw-${input.userPotential.videoId}-${ts}.json`),
      JSON.stringify(raw, null, 2),
      "utf-8",
    );
    if (e && typeof e === "object" && "issues" in e) {
      const issues = (e as { issues: unknown[] }).issues;
      console.error(`[match-engine] Zod issues (first 10):`);
      for (const i of issues.slice(0, 10)) {
        const issue = i as {
          path?: unknown[];
          message?: string;
          received?: unknown;
        };
        console.error(
          `  - path=${JSON.stringify(issue.path)} msg="${issue.message}" received=${JSON.stringify(issue.received)}`,
        );
      }
    }
    throw e;
  }
}
