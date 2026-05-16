import "server-only";
import { put, head, list, del } from "@/lib/storage";
import { getIsoWeek } from "@/lib/utils/iso-week";
import type { TrendingSnapshot } from "./types";
import { TrendingSnapshotSchema } from "./types";
import { createLogger } from "@/lib/observability/structured-log";

const log = createLogger({ module: "trending/snapshot-store" });

const PREFIX = "trending";

/** trending/snapshot-2026-W20.json —— 独立 namespace,与 topic-cache/ 分开。 */
export function snapshotKey(week: string): string {
  return `${PREFIX}/snapshot-${week}.json`;
}

/** 读指定周的快照;不存在 / 无 token / 出错都返回 null。 */
export async function readSnapshot(
  week: string,
): Promise<TrendingSnapshot | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const meta = await head(snapshotKey(week));
    if (!meta?.url) return null;
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    const parsed = TrendingSnapshotSchema.safeParse(json);
    if (!parsed.success) {
      log.warn("readSnapshot: invalid snapshot JSON, ignoring", { week });
      return null;
    }
    return parsed.data as unknown as TrendingSnapshot;
  } catch {
    return null;
  }
}

/**
 * 读最新两周快照(按 week 字符串降序,ISO week 格式可直接字典序排)。
 * 看板 + velocity.ts 用。最新 = current,次新 = previous。
 */
export async function readLatestTwoSnapshots(): Promise<{
  current: TrendingSnapshot | null;
  previous: TrendingSnapshot | null;
}> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { current: null, previous: null };
  }
  try {
    const { blobs } = await list({ prefix: `${PREFIX}/`, limit: 52 });
    const sorted = [...blobs].sort((a, b) =>
      b.pathname.localeCompare(a.pathname),
    );
    const fetchBlob = async (
      url: string | undefined,
    ): Promise<TrendingSnapshot | null> => {
      if (!url) return null;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      const json = await res.json();
      const parsed = TrendingSnapshotSchema.safeParse(json);
      if (!parsed.success) {
        log.warn("readLatestTwoSnapshots: invalid snapshot JSON, ignoring");
        return null;
      }
      return parsed.data as unknown as TrendingSnapshot;
    };
    const [current, previous] = await Promise.all([
      fetchBlob(sorted[0]?.url),
      fetchBlob(sorted[1]?.url),
    ]);
    return { current, previous };
  } catch {
    return { current: null, previous: null };
  }
}

/** 写本周快照。失败重试 1 次,仍失败则 log 退出(快照幂等,下周重抓)。 */
export async function writeSnapshot(snapshot: TrendingSnapshot): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  const key = snapshotKey(snapshot.week);
  const body = JSON.stringify(snapshot);
  const opts = {
    access: "public" as const,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  };
  try {
    await put(key, body, opts);
  } catch (e) {
    log.warn("write failed, retrying once", { week: snapshot.week, err: e });
    try {
      await put(key, body, opts);
    } catch (e2) {
      log.error("write failed after retry", { week: snapshot.week, err: e2 });
    }
  }
}

/**
 * 只保留最新 keepWeeks 周快照,其余删除。
 * keepWeeks=8 —— velocity 只需 2 周,留 8 周是为未来"🔥 TOP 连续 N 周"规则
 * 攒 velocity history(spec Section 4.4 / architect L2)。
 */
export async function pruneOldSnapshots(keepWeeks = 8): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    const { blobs } = await list({ prefix: `${PREFIX}/`, limit: 52 });
    const sorted = [...blobs].sort((a, b) =>
      b.pathname.localeCompare(a.pathname),
    );
    const stale = sorted.slice(keepWeeks);
    if (stale.length === 0) return;
    await del(stale.map((b) => b.url));
  } catch (e) {
    log.error("prune failed", { keepWeeks, err: e });
  }
}

/** 当前 ISO 周,fetch.ts 写快照时用。 */
export function currentWeek(): string {
  return getIsoWeek();
}
