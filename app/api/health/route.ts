import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Cloud Run startup/liveness probe 必须每次实时返回（不能被 ISR / static
// 缓存覆盖），否则容器内部不健康但平台仍认为 ready。
export const dynamic = "force-dynamic";

/**
 * P5.2.2 — Cloud Run startup + liveness probe endpoint。
 *
 * 设计约束（per W3 P5.2 verdict f7d46bb J1 + scope §2.3 J1）：
 * - sync handler 零 await，最低 latency
 * - 不查 DB / Storage / 上游 service（cold start 期外部依赖未 ready 也要返 200）
 * - 显式 Cache-Control: no-store 防 CDN / Cloud Run 边缘缓存
 * - `version` 字段返 GHA deploy.yml 注入的 GIT_SHA，便于审计 image 对应 commit
 */
export function GET() {
  return NextResponse.json(
    { ok: true, version: process.env.GIT_SHA ?? "dev" },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
