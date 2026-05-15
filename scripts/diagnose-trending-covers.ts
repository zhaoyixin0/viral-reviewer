/**
 * Phase 1 诊断脚本 (W3 → W2, 2026-05-15)
 *
 * 目标:定位 trending 看板封面图缺失/破图的根因。
 *
 * 流程:
 *   1. 读 Vercel Blob 最新 snapshot (绕开 server-only 模块,直接 list+fetch)
 *      - 没有 BLOB_READ_WRITE_TOKEN → fallback 本地 data/scraped/enriched-*.json
 *   2. 按平台分桶统计 cover 字段:
 *      - 空字符串率
 *      - 长度异常率 (< 10 字符 或不含 "http")
 *   3. HEAD 采样前 N (default 50) 个非空 cover:
 *      - concurrency limited pool (default 5)
 *      - 真实浏览器 UA
 *      - 两轮:第一轮无 Referer,第二轮带平台 Referer (验证防盗链)
 *      - 分桶: 2xx / 3xx / 403 / 404 / network error
 *   4. dump 前 5 条 cover === "" 的 normalized item
 *   5. (可选 --with-raw) 调 Apify 拉 5 条 TT + 5 条 IG raw item,dump 原始字段
 *   6. 写 markdown 报告
 *
 * 不改 production 代码 (normalize.ts / TrendingCard.tsx / snapshot-store.ts),
 * 仅诊断脚本本身。
 */

import { list } from "@vercel/blob";
import { z } from "zod";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────────

type CliArgs = {
  sample: number;
  concurrency: number;
  withRaw: boolean;
  out: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    sample: 50,
    concurrency: 5,
    withRaw: false,
    out: "docs/diagnose-trending-covers-2026-05-15.md",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--with-raw") args.withRaw = true;
    else if (a === "--sample") args.sample = Number(argv[++i] ?? args.sample);
    else if (a === "--concurrency")
      args.concurrency = Number(argv[++i] ?? args.concurrency);
    else if (a === "--out") args.out = argv[++i] ?? args.out;
  }
  return args;
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot reader (绕开 server-only,直接读 Blob;无 token → 本地 dump fallback)
// ─────────────────────────────────────────────────────────────────────────────

const NormalizedVideoSchema = z
  .object({
    id: z.string(),
    platform: z.enum(["tiktok", "instagram"]),
    url: z.string(),
    cover: z.string(),
    title: z.string().optional().default(""),
    topic: z.string().optional().default(""),
  })
  .passthrough();

type NormalizedVideo = z.infer<typeof NormalizedVideoSchema>;

type SnapshotSource = {
  origin: "blob" | "local";
  week: string;
  capturedAt: string;
  videos: NormalizedVideo[];
};

type BlobProbe = {
  tokenSet: boolean;
  trendingBlobCount: number;
  latestPathname: string | null;
};

async function probeBlob(): Promise<BlobProbe> {
  const tokenSet = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  if (!tokenSet) return { tokenSet: false, trendingBlobCount: 0, latestPathname: null };
  try {
    const { blobs } = await list({ prefix: "trending/", limit: 52 });
    const sorted = [...blobs].sort((a, b) =>
      b.pathname.localeCompare(a.pathname),
    );
    return {
      tokenSet: true,
      trendingBlobCount: blobs.length,
      latestPathname: sorted[0]?.pathname ?? null,
    };
  } catch {
    return { tokenSet: true, trendingBlobCount: 0, latestPathname: null };
  }
}

async function readLatestSnapshotFromBlob(): Promise<SnapshotSource | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const { blobs } = await list({ prefix: "trending/", limit: 52 });
  if (blobs.length === 0) return null;
  const sorted = [...blobs].sort((a, b) =>
    b.pathname.localeCompare(a.pathname),
  );
  const latest = sorted[0];
  const res = await fetch(latest.url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Blob fetch failed: ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  const videos = (json.videos as unknown[]) ?? [];
  const parsed = videos
    .map((v) => NormalizedVideoSchema.safeParse(v))
    .filter((r) => r.success)
    .map((r) => (r as { data: NormalizedVideo }).data);
  return {
    origin: "blob",
    week: String(json.week ?? "unknown"),
    capturedAt: String(json.capturedAt ?? "unknown"),
    videos: parsed,
  };
}

async function readLocalSnapshotFallback(): Promise<SnapshotSource | null> {
  try {
    const files = await readdir("data/scraped");
    const enriched = files.filter(
      (f) => f.startsWith("enriched-") && f.endsWith(".json"),
    );
    if (enriched.length === 0) return null;
    enriched.sort((a, b) => b.localeCompare(a));
    const latest = enriched[0];
    const buf = await readFile(join("data/scraped", latest), "utf8");
    const arr = JSON.parse(buf) as unknown[];
    const parsed = arr
      .map((v) => NormalizedVideoSchema.safeParse(v))
      .filter((r) => r.success)
      .map((r) => (r as { data: NormalizedVideo }).data);
    const weekMatch = latest.match(/enriched-(\d{4}-\d{2}-\d{2})\.json/);
    return {
      origin: "local",
      week: weekMatch?.[1] ?? "unknown",
      capturedAt: weekMatch?.[1] ?? "unknown",
      videos: parsed,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 字段统计
// ─────────────────────────────────────────────────────────────────────────────

type CoverStats = {
  total: number;
  emptyCount: number;
  shortOrMalformedCount: number;
  validCount: number;
};

function statsFor(videos: NormalizedVideo[]): CoverStats {
  let emptyCount = 0;
  let shortOrMalformedCount = 0;
  let validCount = 0;
  for (const v of videos) {
    if (v.cover === "") emptyCount++;
    else if (v.cover.length < 10 || !v.cover.includes("http"))
      shortOrMalformedCount++;
    else validCount++;
  }
  return {
    total: videos.length,
    emptyCount,
    shortOrMalformedCount,
    validCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HEAD 采样 (concurrency-limited pool)
// ─────────────────────────────────────────────────────────────────────────────

const REAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type HeadResult = {
  url: string;
  platform: "tiktok" | "instagram";
  method: "HEAD" | "GET";
  withReferer: boolean;
  status: number | "network_error";
  bucket: "2xx" | "3xx" | "403" | "404" | "5xx" | "other" | "network_error";
  elapsedMs: number;
};

function bucketFor(status: number | "network_error"): HeadResult["bucket"] {
  if (status === "network_error") return "network_error";
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status === 403) return "403";
  if (status === 404) return "404";
  if (status >= 500) return "5xx";
  return "other";
}

async function probeOne(
  url: string,
  platform: "tiktok" | "instagram",
  method: "HEAD" | "GET",
  withReferer: boolean,
): Promise<HeadResult> {
  const headers: Record<string, string> = { "User-Agent": REAL_UA };
  if (withReferer) {
    headers["Referer"] =
      platform === "tiktok"
        ? "https://www.tiktok.com/"
        : "https://www.instagram.com/";
  }
  // GET 用 Range 头只拉前 1024 字节,避免下整图浪费带宽
  if (method === "GET") headers["Range"] = "bytes=0-1023";
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method, headers, redirect: "manual" });
    return {
      url,
      platform,
      method,
      withReferer,
      status: res.status,
      bucket: bucketFor(res.status),
      elapsedMs: Date.now() - t0,
    };
  } catch {
    return {
      url,
      platform,
      method,
      withReferer,
      status: "network_error",
      bucket: "network_error",
      elapsedMs: Date.now() - t0,
    };
  }
}

async function pool<T, R>(
  inputs: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(inputs.length);
  let idx = 0;
  async function runWorker() {
    while (true) {
      const i = idx++;
      if (i >= inputs.length) return;
      out[i] = await worker(inputs[i], i);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, inputs.length) },
    runWorker,
  );
  await Promise.all(workers);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 可选: 跑 Apify 拉 raw items (--with-raw)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchRawItems(): Promise<{
  tiktok: Record<string, unknown>[];
  instagram: Record<string, unknown>[];
}> {
  const { getApifyClient } = await import("@/lib/apify/client");
  const client = getApifyClient();
  const tt = await client
    .actor("clockworks/tiktok-scraper")
    .call({
      hashtags: ["food"],
      resultsPerPage: 5,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
    });
  const { items: ttItems } = await client
    .dataset(tt.defaultDatasetId)
    .listItems();
  const ig = await client
    .actor("apify/instagram-hashtag-scraper")
    .call({ hashtags: ["food"], resultsLimit: 5 });
  const { items: igItems } = await client
    .dataset(ig.defaultDatasetId)
    .listItems();
  return {
    tiktok: ttItems as Record<string, unknown>[],
    instagram: igItems as Record<string, unknown>[],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 报告生成
// ─────────────────────────────────────────────────────────────────────────────

function platformOf(videos: NormalizedVideo[], p: "tiktok" | "instagram") {
  return videos.filter((v) => v.platform === p);
}

function fmtPct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

type Report = {
  snapshot: SnapshotSource;
  blobProbe: BlobProbe;
  ttStats: CoverStats;
  igStats: CoverStats;
  headResults: HeadResult[];
  emptyCoverSamples: NormalizedVideo[];
  rawItems?: { tiktok: Record<string, unknown>[]; instagram: Record<string, unknown>[] };
};

function buildBucketTable(results: HeadResult[]): string {
  const buckets: HeadResult["bucket"][] = [
    "2xx",
    "3xx",
    "403",
    "404",
    "5xx",
    "other",
    "network_error",
  ];
  type Key = "tt_head_noref" | "tt_head_ref" | "tt_get_ref" | "ig_head_noref" | "ig_head_ref" | "ig_get_ref";
  const empty = (): Record<HeadResult["bucket"], number> => ({
    "2xx": 0, "3xx": 0, "403": 0, "404": 0, "5xx": 0, other: 0, network_error: 0,
  });
  const grouped: Record<Key, Record<HeadResult["bucket"], number>> = {
    tt_head_noref: empty(), tt_head_ref: empty(), tt_get_ref: empty(),
    ig_head_noref: empty(), ig_head_ref: empty(), ig_get_ref: empty(),
  };
  for (const r of results) {
    const p = r.platform === "tiktok" ? "tt" : "ig";
    const m = r.method.toLowerCase();
    const ref = r.withReferer ? "ref" : "noref";
    const key = `${p}_${m}_${ref}` as Key;
    if (grouped[key]) grouped[key][r.bucket]++;
  }
  const labels: Record<Key, string> = {
    tt_head_noref: "TikTok / HEAD / 无 Referer",
    tt_head_ref: "TikTok / HEAD / 带 Referer",
    tt_get_ref: "TikTok / GET / 带 Referer (Range 0-1023)",
    ig_head_noref: "Instagram / HEAD / 无 Referer",
    ig_head_ref: "Instagram / HEAD / 带 Referer",
    ig_get_ref: "Instagram / GET / 带 Referer (Range 0-1023)",
  };
  const header = `| 平台 / 方法 / Referer | ${buckets.join(" | ")} | 总样本 |`;
  const sep = `|---|${buckets.map(() => "---").join("|")}|---|`;
  const rows = (Object.keys(labels) as Key[]).map((k) => {
    const g = grouped[k];
    const total = buckets.reduce((s, b) => s + g[b], 0);
    const cells = buckets.map((b) => String(g[b])).join(" | ");
    return `| ${labels[k]} | ${cells} | ${total} |`;
  });
  return [header, sep, ...rows].join("\n");
}

function rankCauses(report: Report): string {
  const tt = report.ttStats;
  const ig = report.igStats;
  const total = tt.total + ig.total;
  const emptyRate = (tt.emptyCount + ig.emptyCount) / Math.max(1, total);

  const headNoRef = report.headResults.filter(
    (r) => r.method === "HEAD" && !r.withReferer,
  );
  const headRef = report.headResults.filter(
    (r) => r.method === "HEAD" && r.withReferer,
  );
  const getRef = report.headResults.filter(
    (r) => r.method === "GET" && r.withReferer,
  );
  const head2xx = headNoRef.filter((r) => r.bucket === "2xx").length;
  const headRef2xx = headRef.filter((r) => r.bucket === "2xx").length;
  const getRef2xx = getRef.filter((r) => r.bucket === "2xx").length;
  const head403 = headNoRef.filter((r) => r.bucket === "403").length;
  const head404 = headNoRef.filter((r) => r.bucket === "404").length;

  const causes: Array<{ name: string; score: number; reason: string }> = [];

  causes.push({
    name: "snapshot 不存在 (Vercel Blob 内 0 条 trending/*)",
    score: report.blobProbe.tokenSet && report.blobProbe.trendingBlobCount === 0 ? 0.95 : 0,
    reason: `BLOB_READ_WRITE_TOKEN 已配置=${report.blobProbe.tokenSet}, trending/ 下 blob 数=${report.blobProbe.trendingBlobCount}`,
  });

  causes.push({
    name: "CDN URL 过期 / 鉴权失败 (404 / 403 不可恢复)",
    score:
      (head403 + head404) / Math.max(1, headNoRef.length) *
      (getRef2xx === 0 ? 1 : 0.3),
    reason: `HEAD 无 Referer 403=${head403} 404=${head404} (共 ${headNoRef.length}); GET 带 Referer 2xx=${getRef2xx} (共 ${getRef.length}) — GET 也无法救活意味着是鉴权而非反 HEAD 协议层`,
  });

  causes.push({
    name: "防盗链 (Referer 阻挡,带 Referer 即可救活)",
    score:
      ((headRef2xx - head2xx) + (getRef2xx - head2xx)) /
      Math.max(1, headNoRef.length * 2),
    reason: `HEAD 无 Referer 2xx=${head2xx}, HEAD 带 Referer 2xx=${headRef2xx}, GET 带 Referer 2xx=${getRef2xx} — 是否带 Referer 复活`,
  });

  causes.push({
    name: "Apify scraper schema 升级,normalize fallback 落空",
    score: emptyRate > 0.2 ? 0.9 : emptyRate > 0.05 ? 0.4 : 0.05,
    reason: `空 cover 整体率 = ${fmtPct(tt.emptyCount + ig.emptyCount, total)}`,
  });

  causes.push({
    name: "部分 item 真无封面 (long-tail UGC)",
    score: emptyRate <= 0.1 && emptyRate > 0 ? 0.6 : 0.2,
    reason: `空 cover 率小但非零 = ${fmtPct(tt.emptyCount + ig.emptyCount, total)}`,
  });

  causes.sort((a, b) => b.score - a.score);
  return causes
    .map(
      (c, i) =>
        `${i + 1}. **${c.name}** — score=${c.score.toFixed(2)} (${c.reason})`,
    )
    .join("\n");
}

function diagnosticConclusion(report: Report): string {
  const bp = report.blobProbe;
  const head = report.headResults;
  const noref = head.filter((r) => r.method === "HEAD" && !r.withReferer);
  const headRef = head.filter((r) => r.method === "HEAD" && r.withReferer);
  const getRef = head.filter((r) => r.method === "GET" && r.withReferer);
  const noref2xx = noref.filter((r) => r.bucket === "2xx").length;
  const headRef2xx = headRef.filter((r) => r.bucket === "2xx").length;
  const getRef2xx = getRef.filter((r) => r.bucket === "2xx").length;
  const noref403 = noref.filter((r) => r.bucket === "403").length;
  const noref404 = noref.filter((r) => r.bucket === "404").length;
  const totalEmpty = report.ttStats.emptyCount + report.igStats.emptyCount;
  const totalCount = report.ttStats.total + report.igStats.total;
  const noBlob = bp.tokenSet && bp.trendingBlobCount === 0;
  const allBlockedHead = noref403 + noref404 === noref.length && noref.length > 0;
  const refererDidNotSave =
    allBlockedHead && headRef2xx === 0 && getRef2xx === 0;
  const fieldsMissing = totalEmpty / Math.max(1, totalCount) > 0.05;

  const conclusions: string[] = [];
  if (noBlob) {
    conclusions.push(
      "**根因 1 (上游)**: Vercel Blob 中 trending/* prefix 下 **0 条 snapshot** —— prod /trending 端点 readLatestTwoSnapshots 必返回 {current: null, previous: null},看板呈空状态。这本身就是用户看到「封面缺失」的最大可能原因 —— 实际上**整个看板没数据**,不是「卡片有但封面没」。修法: 跑一次 fetchTrendingSnapshot + writeSnapshot (手动 / cron / 启动种子),让 Blob 有第一份本周快照。",
    );
  }
  if (allBlockedHead && refererDidNotSave) {
    conclusions.push(
      `**根因 2 (历史 dump 现状)**: 本地 fallback dump (\`${report.snapshot.week}\`) 里 cover URL **${noref403 + noref404} / ${noref.length}** 个全部返回 4xx (HEAD/GET 都试过、带/不带 Referer 都试过)。 这是**典型 signed-URL 过期**: TikTok / Instagram CDN URL 都带 token (\`_nc_ohc\` / \`oe\` / 类似查询参数),TTL 几天到几周。 距 dump 日期已 ~${Math.round((Date.now() - new Date(report.snapshot.week).getTime()) / 86400000)} 天。Cover 字段都在 (空率 ${fmtPct(totalEmpty, totalCount)}),问题在 URL 本身已死。`,
    );
  }
  if (fieldsMissing) {
    conclusions.push(
      `**根因 3 (字段层)**: 空 cover 率 ${fmtPct(totalEmpty, totalCount)} (> 5%) —— 部分 Apify item 在 normalize 阶段 fallback chain 全 miss,可能 schema 升级。需要 \`--with-raw\` 跑一次确认 raw 字段。`,
    );
  }
  if (allBlockedHead && refererDidNotSave) {
    conclusions.push(
      "**Phase 2 推荐顺序**: (a) 先让 Blob 攒到当周新 snapshot (上游必修); (b) UI 加 `<img onError>` 兜底占位,无论后端何时修都不破样式; (c) 可选: snapshot-store 加 stale-cover 检测,cron 触发重抓老 snapshot 的死 URL。",
    );
  } else if (noBlob) {
    conclusions.push(
      "**Phase 2 推荐顺序**: (a) 先种 Blob; (b) 种完后重跑本脚本看实际 prod cover URL 健康度,再决定要不要加 UI fallback。",
    );
  }
  if (conclusions.length === 0) {
    conclusions.push("无显著异常信号 —— 数据健康,问题可能在更细的子集 (按 topic / 时间窗) 才出现,需要扩 sample 复测。");
  }
  return conclusions.map((c) => `- ${c}`).join("\n\n");
}

function buildReport(report: Report): string {
  const { snapshot, ttStats, igStats, emptyCoverSamples, rawItems } = report;
  const total = ttStats.total + igStats.total;

  const bp = report.blobProbe;
  return [
    `# Trending 封面缺失诊断报告 2026-05-15`,
    ``,
    `> Phase 1 诊断脚本 (W3 → W2 任务) 自动生成 · 不改 production 代码`,
    ``,
    `## 数据源`,
    ``,
    `- **Vercel Blob 探测** —— BLOB_READ_WRITE_TOKEN 已配置=${bp.tokenSet}, \`trending/*\` 下 blob 数=${bp.trendingBlobCount}, 最新=${bp.latestPathname ?? "_无_"}`,
    `- snapshot origin: \`${snapshot.origin}\` (${snapshot.origin === "blob" ? "Vercel Blob" : "本地 data/scraped fallback —— 因 Blob 为空"})`,
    `- snapshot week: \`${snapshot.week}\``,
    `- snapshot capturedAt: \`${snapshot.capturedAt}\``,
    `- 视频总数: ${total} (TT=${ttStats.total} + IG=${igStats.total})`,
    ``,
    `## 诊断结论 (TL;DR)`,
    ``,
    diagnosticConclusion(report),
    ``,
    `## 1. 字段统计 (cover 空率 + 异常率)`,
    ``,
    `| 平台 | 总数 | 空字符串 (率) | 长度异常 (率) | 有效 (率) |`,
    `|---|---|---|---|---|`,
    `| TikTok | ${ttStats.total} | ${ttStats.emptyCount} (${fmtPct(ttStats.emptyCount, ttStats.total)}) | ${ttStats.shortOrMalformedCount} (${fmtPct(ttStats.shortOrMalformedCount, ttStats.total)}) | ${ttStats.validCount} (${fmtPct(ttStats.validCount, ttStats.total)}) |`,
    `| Instagram | ${igStats.total} | ${igStats.emptyCount} (${fmtPct(igStats.emptyCount, igStats.total)}) | ${igStats.shortOrMalformedCount} (${fmtPct(igStats.shortOrMalformedCount, igStats.total)}) | ${igStats.validCount} (${fmtPct(igStats.validCount, igStats.total)}) |`,
    ``,
    `**长度异常**定义: 非空但长度 < 10 或不含 \`http\`。`,
    ``,
    `## 2. HEAD/GET 采样结果 (浏览器 UA · concurrency=5)`,
    ``,
    `- redirect: \`manual\` (3xx 不自动跟随)`,
    `- **三轮**: HEAD 无 Referer / HEAD 带平台 Referer / GET (Range bytes=0-1023) 带 Referer`,
    `- GET 那一轮是为了排除"CDN 反 HEAD 协议但 GET 正常"的假阴性`,
    ``,
    buildBucketTable(report.headResults),
    ``,
    `## 3. 前 5 条 cover === "" 的 normalized item`,
    ``,
    emptyCoverSamples.length === 0
      ? "_无空 cover item — 跳过_"
      : emptyCoverSamples
          .slice(0, 5)
          .map(
            (v) =>
              `- \`${v.id}\` (${v.platform}) topic=${v.topic || "—"}\n  - url: ${v.url}\n  - title: ${(v.title ?? "").slice(0, 80)}`,
          )
          .join("\n"),
    ``,
    rawItems
      ? `## 4. 原始 Apify raw item (前 5 条/平台 · --with-raw)`
      : `## 4. 原始 Apify raw item`,
    ``,
    rawItems
      ? [
          `### TikTok raw (clockworks/tiktok-scraper, hashtags=["food"], 5 条)`,
          "",
          rawItems.tiktok
            .slice(0, 5)
            .map(
              (r, i) =>
                `#### TT raw #${i + 1}\n\n\`\`\`json\n${JSON.stringify(r, null, 2).slice(0, 4000)}\n\`\`\``,
            )
            .join("\n\n"),
          "",
          `### Instagram raw (apify/instagram-hashtag-scraper, hashtags=["food"], 5 条)`,
          "",
          rawItems.instagram
            .slice(0, 5)
            .map(
              (r, i) =>
                `#### IG raw #${i + 1}\n\n\`\`\`json\n${JSON.stringify(r, null, 2).slice(0, 4000)}\n\`\`\``,
            )
            .join("\n\n"),
        ].join("\n")
      : "_未跑 \`--with-raw\` —— snapshot 已经过 normalize,raw item 不在 snapshot 中。如需 raw 字段确认,跑 \`tsx --env-file=.env.local scripts/diagnose-trending-covers.ts --with-raw\` (会消耗 Apify quota,约 10 条)。_",
    ``,
    `## 5. 根因 ranking (启发式打分)`,
    ``,
    rankCauses(report),
    ``,
    `## 6. 推荐修法 (phase 2 候选,W3 决策)`,
    ``,
    `- **如果空 cover 率 > 10%** → 扩 \`lib/apify/normalize.ts\` fallback chain (例如 IG 看 \`thumbnailUrl\` 之外的字段;TT 看 \`videoMeta.originCover\` / \`videoMeta.dynamicCover\`),并加 \`tests/apify/normalize.test.ts\` 新字段映射 case。`,
    `- **如果带 Referer 2xx 显著上升** → \`components/trending/TrendingCard.tsx\` \`<img>\` 加 \`referrerPolicy="no-referrer"\`,全局退一步规避防盗链。`,
    `- **如果 HEAD 大量 404 / 403 即使带 Referer** → CDN URL 过期 → \`<img onError>\` 显示占位 (与现有"无封面"统一样式),并可选 cron 异步重抓 stale snapshot。`,
    `- **如果空 cover 率 < 5% 且 HEAD 几乎全 2xx** → 实属 long-tail UGC + 浏览器破图标 → 同样 \`onError\` 占位即可,无需后端改动。`,
    ``,
    `## 附录:脚本运行参数`,
    ``,
    `- sample size: ${report.headResults.length / 3} 个 URL × 3 轮 = ${report.headResults.length} 个请求`,
    `- 真实 UA: \`${REAL_UA}\``,
    ``,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log("[diagnose-trending-covers] args:", args);

  const blobProbe = await probeBlob();
  console.log("[diagnose-trending-covers] Blob 探测:", blobProbe);

  let snapshot = await readLatestSnapshotFromBlob();
  if (!snapshot) {
    console.warn(
      "[diagnose-trending-covers] Blob 不可用 (无 token 或 trending/ 下 0 条),回退本地 data/scraped",
    );
    snapshot = await readLocalSnapshotFallback();
  }
  if (!snapshot) {
    throw new Error(
      "无可用 snapshot:Blob 为空且 data/scraped/enriched-*.json 不存在",
    );
  }
  console.log(
    `[diagnose-trending-covers] snapshot origin=${snapshot.origin} week=${snapshot.week} videos=${snapshot.videos.length}`,
  );

  const ttVideos = platformOf(snapshot.videos, "tiktok");
  const igVideos = platformOf(snapshot.videos, "instagram");
  const ttStats = statsFor(ttVideos);
  const igStats = statsFor(igVideos);
  console.log("[diagnose-trending-covers] TT stats:", ttStats);
  console.log("[diagnose-trending-covers] IG stats:", igStats);

  const nonEmpty = snapshot.videos.filter((v) => v.cover !== "");
  // 平台间均匀采样,各取一半
  const halfTT = ttVideos
    .filter((v) => v.cover !== "")
    .slice(0, Math.ceil(args.sample / 2));
  const halfIG = igVideos
    .filter((v) => v.cover !== "")
    .slice(0, Math.floor(args.sample / 2));
  const sample = [...halfTT, ...halfIG].slice(0, args.sample);
  if (sample.length === 0 && nonEmpty.length > 0) {
    sample.push(...nonEmpty.slice(0, args.sample));
  }
  console.log(
    `[diagnose-trending-covers] HEAD 采样 ${sample.length} 个 URL × 2 轮`,
  );

  type Task = {
    url: string;
    platform: "tiktok" | "instagram";
    method: "HEAD" | "GET";
    withReferer: boolean;
  };
  const tasks: Task[] = [];
  for (const v of sample) {
    tasks.push({ url: v.cover, platform: v.platform, method: "HEAD", withReferer: false });
    tasks.push({ url: v.cover, platform: v.platform, method: "HEAD", withReferer: true });
    tasks.push({ url: v.cover, platform: v.platform, method: "GET", withReferer: true });
  }
  const headResults = await pool(tasks, args.concurrency, (t) =>
    probeOne(t.url, t.platform, t.method, t.withReferer),
  );
  console.log(
    `[diagnose-trending-covers] 探测完成,${headResults.length} 个结果 (3 轮)`,
  );

  const emptyCoverSamples = snapshot.videos.filter((v) => v.cover === "").slice(0, 5);

  let rawItems: Report["rawItems"];
  if (args.withRaw) {
    console.log("[diagnose-trending-covers] --with-raw 启动,调 Apify 拉 raw items (消耗 quota)");
    rawItems = await fetchRawItems();
    console.log(
      `[diagnose-trending-covers] raw items 拉回 TT=${rawItems.tiktok.length} IG=${rawItems.instagram.length}`,
    );
  }

  const report: Report = {
    snapshot,
    blobProbe,
    ttStats,
    igStats,
    headResults,
    emptyCoverSamples,
    rawItems,
  };
  const md = buildReport(report);
  await writeFile(args.out, md, "utf8");
  console.log(`[diagnose-trending-covers] 报告写入: ${args.out}`);
}

main().catch((e) => {
  console.error("[diagnose-trending-covers] failed:", e);
  process.exit(1);
});
