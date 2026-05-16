import { NextResponse } from "next/server";
import { fetchTrendingSnapshot } from "@/lib/trending/fetch";
import {
  writeSnapshot,
  pruneOldSnapshots,
} from "@/lib/trending/snapshot-store";

export const runtime = "nodejs";

const KEEP_WEEKS = 8;

/**
 * 双认证(architect H1):
 * - Vercel Cron 自动带 Authorization: Bearer ${CRON_SECRET}
 * - 手动触发(调试 / 套餐不支持 cron 的降级入口)带 Bearer ${ADMIN_TRIGGER_SECRET}
 * 任一通过即可。
 */
function isAuthorized(request: Request): boolean {
  const auth = request.headers.get("authorization");
  if (!auth) return false;
  const cronSecret = process.env.CRON_SECRET;
  const adminSecret = process.env.ADMIN_TRIGGER_SECRET;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  if (adminSecret && auth === `Bearer ${adminSecret}`) return true;
  return false;
}

// P3 hardening #1：POST body 不消费任何字段（认证只走 Authorization Bearer header），
// 因此豁免 Zod body schema —— 没有可校验的 input surface。新增任何 body 字段消费
// 都必须先在此路由内补 Zod schema 校验。
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let snapshot;
  try {
    snapshot = await fetchTrendingSnapshot();
  } catch (e) {
    // 两个平台都失败 → fetchTrendingSnapshot throw → 不写空快照
    console.error("[cron/trending] fetch failed:", (e as Error).message);
    return NextResponse.json(
      { error: "fetch_failed", message: (e as Error).message },
      { status: 502 },
    );
  }

  await writeSnapshot(snapshot);
  await pruneOldSnapshots(KEEP_WEEKS);

  return NextResponse.json({
    ok: true,
    week: snapshot.week,
    partial: snapshot.meta.partial,
    videoCount: snapshot.videos.length,
  });
}
