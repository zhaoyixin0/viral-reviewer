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
 * Opus 4.7 · 双向技法匹配引擎（多视频版）
 *
 * 输入：
 *   - userPotentials: (MaterialPotential | null)[]，按上传全集索引（I6 契约），
 *     失败位置为 null
 *   - userVideoIds: string[]，同长，与 userPotentials 共享索引基准
 *   - failedVideoIndexes: number[]，分析失败的 superset index
 *   - referenceCutPlans: CutPlan[]
 *
 * 输出：TechniqueMatchingResult，包含跨爆款 reports / topPriorityActions /
 * globalDoNots / recommendedBgms / assemblyTimeline（多视频编排时间线）。
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
  /** 按上传全集索引（I6 基准）。失败位置 null，与 userVideoIds 同长。 */
  userPotentials: (MaterialPotential | null)[];
  /** 按上传全集索引的视频 id，与 userPotentials 同长。 */
  userVideoIds: string[];
  /** 分析失败的 superset index 列表（Opus prompt 里硬性禁止引用）。 */
  failedVideoIndexes: number[];
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

/**
 * assemblyTimeline 后处理：保护 Opus 输出不让畸形 clip 把整次 parse 弄崩。
 *
 *   1. drop sourceVideoIndex 越界或引用了 failedVideoIndexes 的 clip
 *   2. drop sourceStartSec >= sourceEndSec 的畸形 clip（schema refine 会 reject）
 *   3. clamp sourceEndSec 到对应素材的 base.durationSec
 *   4. 反查回填 sourceVideoId（按 userVideoIds[index]）
 *   5. 重排 order 为最终下标
 *   6. 首 clip 的 incomingTransition 强制 null
 *
 * 命名安全：所有新字段都避开 walk() 的重写键（I2 契约），不会被 normalizeTimeCode
 * 误改成 {sec, frame} 对象。
 */
function sanitizeAssemblyTimeline(
  raw: Record<string, unknown>,
  userPotentials: (MaterialPotential | null)[],
  userVideoIds: string[],
  failedVideoIndexes: ReadonlyArray<number>,
): void {
  const at = raw.assemblyTimeline;
  if (!at || typeof at !== "object") return;
  const timeline = at as Record<string, unknown>;
  if (!Array.isArray(timeline.clips)) return;

  const N = userPotentials.length;
  const failed = new Set(failedVideoIndexes);
  const durationByIndex = userPotentials.map((p) => p?.base.durationSec ?? 0);

  type Clip = Record<string, unknown>;
  const clips = timeline.clips as Clip[];

  const survivors: Clip[] = [];
  for (const clip of clips) {
    const idx = clip.sourceVideoIndex;
    if (typeof idx !== "number" || !Number.isInteger(idx)) continue;
    if (idx < 0 || idx >= N) continue;
    if (failed.has(idx)) continue;
    if (userPotentials[idx] === null) continue;

    let start =
      typeof clip.sourceStartSec === "number" ? clip.sourceStartSec : NaN;
    let end =
      typeof clip.sourceEndSec === "number" ? clip.sourceEndSec : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start < 0) start = 0;
    const maxDur = durationByIndex[idx];
    if (maxDur > 0 && end > maxDur) end = maxDur;
    if (end <= start) continue;

    clip.sourceStartSec = start;
    clip.sourceEndSec = end;
    clip.sourceVideoId = userVideoIds[idx];
    survivors.push(clip);
  }

  survivors.forEach((c, order) => {
    c.order = order;
  });
  if (survivors.length > 0) {
    survivors[0].incomingTransition = null;
  }

  timeline.clips = survivors;

  // 同步 estimatedDurationSec（Opus 给的可能跟 clamp 后对不上）
  if (survivors.length > 0) {
    const total = survivors.reduce((acc, c) => {
      const start = c.sourceStartSec as number;
      const end = c.sourceEndSec as number;
      return acc + (end - start);
    }, 0);
    timeline.estimatedDurationSec = Number(total.toFixed(3));
  }
}

export async function matchTechniques(
  input: MatchEngineInput,
): Promise<TechniqueMatchingResult> {
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-7";

  const { userPotentials, userVideoIds, failedVideoIndexes } = input;
  if (userPotentials.length !== userVideoIds.length) {
    throw new Error(
      `userPotentials.length (${userPotentials.length}) !== userVideoIds.length (${userVideoIds.length})`,
    );
  }
  const primary = userPotentials.find(
    (p): p is MaterialPotential => p !== null,
  );
  if (!primary) {
    throw new Error("matchTechniques 需要至少一个成功的 MaterialPotential");
  }

  // payload 里给每个成功 potential 注入 superset index（Opus 编排时用作主键）
  const indexedPotentials = userPotentials
    .map((p, i) =>
      p === null ? null : { index: i, ...compactPotential(p) },
    )
    .filter(<T>(x: T | null): x is T => x !== null);

  const payload = {
    totalMaterials: userPotentials.length,
    successfulCount: indexedPotentials.length,
    failedVideoIndexes,
    userVideoIds,
    userPotentials: indexedPotentials,
    referenceCutPlans: input.referenceCutPlans.map(compactCutPlan),
    userIntent: input.userIntent ?? null,
  };

  const r = await getClient().messages.create({
    model,
    // N=6 + 5 爆款 reports + assemblyTimeline + recommendedBgms 在 16384 经常爆
    // tokens；32000 给 assemblyTimeline 足够喘息空间（plan §Task 5 探测点）。
    max_tokens: 32000,
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

  const raw = JSON.parse(cleaned) as Record<string, unknown>;

  // 注入 meta + 用户 videoIds（兼容旧 userVideoId 字段：取首个成功）
  raw.userVideoId = primary.videoId;
  raw.userVideoIds = userVideoIds;
  raw.meta = {
    model,
    analyzedAt: new Date().toISOString(),
    referenceCount: input.referenceCutPlans.length,
  };

  // assemblyTimeline 后处理（在 walk 之前做：walk 不会动这些字段，但清理逻辑
  // 用的还是裸秒 number，先做不会受 walk 干扰）
  sanitizeAssemblyTimeline(
    raw,
    userPotentials,
    userVideoIds,
    failedVideoIndexes,
  );

  // 时间戳归一化：补 frame 字段。fps 用 primary potential，因为
  // userVideoAt / sourceAt 等是技法层的时间戳，参考首素材 fps 即可
  const userFps = primary.base.fps;
  const normAt = (node: unknown): unknown => {
    if (node && typeof node === "object") {
      const obj = node as { sec?: number; frame?: number };
      if (typeof obj.sec === "number") {
        return normalizeTimeCode({ sec: obj.sec, frame: obj.frame }, userFps);
      }
    }
    return node;
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
      join(dir, `match-raw-${primary.videoId}-${ts}.json`),
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
