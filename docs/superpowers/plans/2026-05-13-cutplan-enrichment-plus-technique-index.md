# P1+P2 实施计划 · 批量富化爆款 CutPlan + Technique 反向索引

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 299 条爆款（180 TT + 119 IG）从「元数据级」升级为「CutPlan IR 原子级」+ 建 technique 反向索引，让 `/technique-match` 的对标池从 2 条手工样本扩到 299 条真材实料，并支持「按剪辑技法簇」召回。

**Architecture:**
- **P1（pipeline 类，非 TDD）**：rescrape 拿 videoUrl → 下载 mp4 → 复用 `analyze-potential.ts` 单条富化逻辑 + 包一层批量 runner（并发 5、断点续跑、错误隔离）→ CutPlan JSON 落 `data/enriched-cutplans/` → 改 `lib/sample-references/index.ts` 从此处读
- **P2（纯函数 + 集成层，TDD）**：从每条 CutPlan.actions 用纯规则抽 `TechniqueTags` → 全库构建反向索引 `data/technique-index.json` → retrieval 加 technique-cluster 召回路径
- **测试框架**：vitest（轻量、tsx 兼容、首次引入）

**Tech Stack:** TypeScript / tsx / Apify SDK / Google GenAI SDK (Gemini 2.5 Pro) / Zod / vitest

**Gemini 预算估算:** 299 条 × 平均 34s 视频 × Gemini 2.5 Pro = ~$15-20

---

## File Structure（落地的文件）

```
scripts/
  ├ rescrape-with-video-urls.ts     # P1 Task 2 一次性脚本：重跑 Apify 拿 videoUrl
  ├ download-mp4s.ts                # P1 Task 3 一次性脚本：批量下载 mp4
  ├ enrich-cutplans-batch.ts        # P1 Task 5 一次性脚本：批量富化 runner CLI
  └ build-technique-index.ts        # P2 Task 13 一次性脚本：构建反向索引

lib/
  ├ enrichment/
  │   ├ types.ts                    # P1 Task 4 富化任务/进度/错误类型
  │   ├ video-downloader.ts         # P1 Task 3 mp4 fetch + 重试
  │   ├ batch-runner.ts             # P1 Task 4 通用并发 + 断点 + 错误隔离
  │   └ cutplan-job.ts              # P1 Task 4 单任务包装 analyze-potential
  └ technique-index/
      ├ types.ts                    # P2 Task 8 TechniqueTags / TechniqueIndex 类型
      ├ extract-tags.ts             # P2 Task 9 CutPlan → TechniqueTags（纯函数 TDD）
      ├ build-index.ts              # P2 Task 11 CutPlan[] → TechniqueIndex（TDD）
      ├ load-index.ts               # P2 Task 12 读 + 5min cache
      └ similarity.ts               # P2 Task 14 用户 Potential ↔ 候选 tag 相似度（TDD）

data/
  ├ raw-mp4s/                       # gitignored；本地 mp4 工作目录
  ├ rescrape-2026-05-13.json        # P1 Task 2 产物：299 条带 videoUrl 的元数据
  ├ enriched-cutplans/              # 入 git；每条 CutPlan 一个 JSON
  │   └ {videoId}.json
  ├ enrichment-errors.json          # gitignored；失败列表
  └ technique-index.json            # 入 git；反向索引

tests/
  └ technique-index/
      ├ extract-tags.test.ts        # P2 Task 9
      ├ build-index.test.ts         # P2 Task 11
      ├ similarity.test.ts          # P2 Task 14
      └ fixtures/
          └ sample-cutplan.json     # P2 Task 9 测试用 CutPlan

lib/sample-references/
  └ index.ts                        # P1 Task 6 改造：从 enriched-cutplans/ 读
                                    # P2 Task 15 改造：接 technique-cluster 召回

vitest.config.ts                    # P2 Task 8 vitest 配置
package.json                        # P2 Task 8 加 vitest 依赖 + test 脚本
.gitignore                          # P1 Task 1 加 data/raw-mp4s/ + enrichment-errors.json
```

---

## P1 · 批量富化 299 条

### Task 1: gitignore + 数据目录骨架

**Files:**
- Modify: `.gitignore`
- Create: `data/raw-mp4s/.gitkeep`
- Create: `data/enriched-cutplans/.gitkeep`

- [ ] **Step 1: 把工作目录加入 gitignore**

编辑 `.gitignore`，在文件末尾追加：

```gitignore

# P1 enrichment artifacts (large mp4s + transient error logs)
data/raw-mp4s/
data/enrichment-errors.json
data/rescrape-*.json
```

- [ ] **Step 2: 创建空目录占位**

```bash
mkdir -p data/raw-mp4s data/enriched-cutplans
touch data/raw-mp4s/.gitkeep data/enriched-cutplans/.gitkeep
```

- [ ] **Step 3: 提交骨架**

```bash
git add .gitignore data/raw-mp4s/.gitkeep data/enriched-cutplans/.gitkeep
git commit -m "chore(enrichment): scaffold data dirs + gitignore raw mp4s"
```

---

### Task 2: rescrape 拿 videoUrl

**Files:**
- Create: `scripts/rescrape-with-video-urls.ts`
- Read existing: `lib/apify/scrapers.ts`, `lib/apify/normalize.ts`

**目标**：现有 enriched JSON 没存 `videoUrl`。用 Apify 的「按 URL 列表」模式重跑 299 条，拿到带 videoUrl 的版本，写到 `data/rescrape-2026-05-13.json`。

- [ ] **Step 1: 写 rescrape 脚本**

```typescript
// scripts/rescrape-with-video-urls.ts
/**
 * Run: npx tsx --env-file=.env.local scripts/rescrape-with-video-urls.ts
 *
 * 输入 data/scraped/enriched-2026-04-29.json
 * 用 Apify 按 URL 重新抓取，拿到 videoUrl 字段，输出 data/rescrape-2026-05-13.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getApifyClient } from "@/lib/apify/client";
import type { ViralVideo } from "@/lib/review-engine/types";

type EnrichedWithVideoUrl = ViralVideo & { videoUrl: string | null };

async function rescrapeTikTok(urls: string[]): Promise<Map<string, string>> {
  const client = getApifyClient();
  const run = await client.actor("clockworks/tiktok-scraper").call({
    postURLs: urls,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const map = new Map<string, string>();
  for (const raw of items as Record<string, unknown>[]) {
    const id = (raw.id ?? raw.videoId) as string | undefined;
    const videoUrl =
      ((raw.videoMeta as Record<string, unknown> | undefined)?.downloadAddr as
        | string
        | undefined) ??
      ((raw.video as Record<string, unknown> | undefined)?.playAddr as
        | string
        | undefined) ??
      (raw.videoUrl as string | undefined) ??
      null;
    if (id && videoUrl) map.set(`tt-${id}`, videoUrl);
  }
  return map;
}

async function rescrapeInstagram(urls: string[]): Promise<Map<string, string>> {
  const client = getApifyClient();
  const run = await client.actor("apify/instagram-scraper").call({
    directUrls: urls,
    resultsType: "posts",
    resultsLimit: urls.length,
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const map = new Map<string, string>();
  for (const raw of items as Record<string, unknown>[]) {
    const shortcode = (raw.shortCode ?? raw.shortcode ?? raw.code) as
      | string
      | undefined;
    const videoUrl = (raw.videoUrl ?? raw.video_url) as string | undefined;
    if (shortcode && videoUrl) map.set(`ig-${shortcode}`, videoUrl);
  }
  return map;
}

async function main() {
  const inPath = join(process.cwd(), "data", "scraped", "enriched-2026-04-29.json");
  const raw = await readFile(inPath, "utf-8");
  const videos = JSON.parse(raw) as ViralVideo[];
  console.log(`[rescrape] loaded ${videos.length} videos`);

  const ttVideos = videos.filter((v) => v.platform === "tiktok");
  const igVideos = videos.filter((v) => v.platform === "instagram");

  console.log(`[rescrape] tiktok: ${ttVideos.length}, instagram: ${igVideos.length}`);

  const ttMap = await rescrapeTikTok(ttVideos.map((v) => v.url));
  console.log(`[rescrape] tiktok videoUrl found: ${ttMap.size}/${ttVideos.length}`);
  const igMap = await rescrapeInstagram(igVideos.map((v) => v.url));
  console.log(`[rescrape] instagram videoUrl found: ${igMap.size}/${igVideos.length}`);

  const merged: EnrichedWithVideoUrl[] = videos.map((v) => ({
    ...v,
    videoUrl: (v.platform === "tiktok" ? ttMap.get(v.id) : igMap.get(v.id)) ?? null,
  }));

  const withUrl = merged.filter((v) => v.videoUrl).length;
  console.log(`[rescrape] total with videoUrl: ${withUrl}/${merged.length}`);

  const outPath = join(process.cwd(), "data", "rescrape-2026-05-13.json");
  await writeFile(outPath, JSON.stringify(merged, null, 2), "utf-8");
  console.log(`[rescrape] wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: 添加 npm script**

编辑 `package.json` 的 `scripts` 段，在 `"probe:match"` 后面加：

```json
"rescrape:with-urls": "tsx --env-file=.env.local scripts/rescrape-with-video-urls.ts",
```

- [ ] **Step 3: 跑 rescrape**

```bash
npm run rescrape:with-urls
```

Expected: 控制台打印 `total with videoUrl: 270+/299`（容忍 <10% 失败，IG 可能稍多），生成 `data/rescrape-2026-05-13.json`。

预计耗时：5-10 min（Apify 跑 299 条 URL）；预计费用：~$1.50。

- [ ] **Step 4: 验证产物**

```bash
node -e "const d = require('./data/rescrape-2026-05-13.json'); const ok = d.filter(v => v.videoUrl); console.log('with videoUrl:', ok.length, '/', d.length); console.log('sample:', ok[0].videoUrl?.slice(0, 80));"
```

Expected: 输出 `with videoUrl: 270+/299` + 一条以 `http` 开头的 URL。

- [ ] **Step 5: 提交脚本（产物已 gitignore）**

```bash
git add scripts/rescrape-with-video-urls.ts package.json
git commit -m "feat(enrichment): rescrape script to fetch videoUrl for 299 viral samples"
```

---

### Task 3: mp4 批量下载器（yt-dlp 走页面 URL 解析）

**Files:**
- Modify: `package.json` (add `youtube-dl-exec` dependency)
- Create: `lib/enrichment/video-downloader.ts`
- Create: `scripts/download-mp4s.ts`

**背景（plan 调整说明）**：原计划假设 Apify 返回 CDN mp4 stream URL，但实际拿到的是页面 URL（`https://www.tiktok.com/@xx/video/123`、`https://www.instagram.com/p/xxx/`）。需要 yt-dlp 解析页面 → mp4。`youtube-dl-exec` 是包装 yt-dlp 的 npm 包，postinstall 时自动下二进制。

- [ ] **Step 1: 装 youtube-dl-exec**

```bash
npm install youtube-dl-exec
```

Expected: 装好后 node_modules 里有 `youtube-dl-exec`，并且自带 yt-dlp.exe 二进制（Windows）或 yt-dlp（Linux/Mac）。安装期间会有一次 postinstall 拉二进制（5-15 MB）。

- [ ] **Step 2: 写 downloader 模块**

```typescript
// lib/enrichment/video-downloader.ts
import { mkdir, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import youtubeDl from "youtube-dl-exec";

export type DownloadResult =
  | { ok: true; path: string; bytes: number; cached: boolean }
  | { ok: false; reason: string };

/**
 * 用 yt-dlp 把页面 URL（TikTok / Instagram post URL）解析为 mp4 并下载。
 *
 * - 已存在的 mp4 直接复用（断点续跑用）
 * - 失败重试 2 次（yt-dlp 偶尔超时）
 * - 单文件 90s 超时
 */
export async function downloadVideo(
  pageUrl: string,
  outPath: string,
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<DownloadResult> {
  const { retries = 2, timeoutMs = 90_000 } = opts;

  // 缓存命中：已经下过的不重下
  try {
    const existing = await stat(outPath);
    if (existing.size > 1024) {
      return { ok: true, path: outPath, bytes: existing.size, cached: true };
    }
    // tiny file = 之前的失败残留，删了重下
    await unlink(outPath).catch(() => {});
  } catch {
    /* not exists, fall through */
  }

  await mkdir(dirname(outPath), { recursive: true });

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const promise = youtubeDl(pageUrl, {
        output: outPath,
        format: "mp4/best[ext=mp4]/best",
        noWarnings: true,
        noCheckCertificates: true,
        preferFreeFormats: true,
        addHeader: ["referer:https://www.google.com"],
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`yt-dlp timeout ${timeoutMs}ms`)), timeoutMs),
      );
      await Promise.race([promise, timeoutPromise]);

      const s = await stat(outPath).catch(() => null);
      if (!s || s.size < 1024) {
        lastErr = new Error(`yt-dlp output tiny (${s?.size ?? 0} bytes)`);
        await unlink(outPath).catch(() => {});
        continue;
      }
      return { ok: true, path: outPath, bytes: s.size, cached: false };
    } catch (e) {
      lastErr = e;
      await unlink(outPath).catch(() => {});
    }
  }

  return {
    ok: false,
    reason: lastErr instanceof Error ? lastErr.message : String(lastErr),
  };
}
```

- [ ] **Step 3: 写下载脚本**

```typescript
// scripts/download-mp4s.ts
/**
 * Run: npx tsx --env-file=.env.local scripts/download-mp4s.ts
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { downloadVideo } from "@/lib/enrichment/video-downloader";

type Item = { id: string; videoUrl: string | null; platform: string };

const CONCURRENCY = 5;

async function* chunks<T>(arr: T[], size: number) {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

async function main() {
  const inPath = join(process.cwd(), "data", "rescrape-2026-05-13.json");
  const raw = await readFile(inPath, "utf-8");
  const items = (JSON.parse(raw) as Item[]).filter((v) => v.videoUrl);
  console.log(`[download] starting ${items.length} videos`);

  const outDir = join(process.cwd(), "data", "raw-mp4s");

  let done = 0;
  let failed = 0;
  const errors: { id: string; reason: string }[] = [];

  for await (const batch of chunks(items, CONCURRENCY)) {
    const results = await Promise.all(
      batch.map(async (v) => {
        const out = join(outDir, `${v.id}.mp4`);
        return { id: v.id, result: await downloadVideo(v.videoUrl!, out) };
      }),
    );
    for (const { id, result } of results) {
      done++;
      if (result.ok) {
        process.stdout.write(
          `  [${done}/${items.length}] ${id} ${result.cached ? "(cached)" : `${(result.bytes / 1024 / 1024).toFixed(1)} MB`}\n`,
        );
      } else {
        failed++;
        errors.push({ id, reason: result.reason });
        process.stdout.write(`  [${done}/${items.length}] ${id} FAIL: ${result.reason}\n`);
      }
    }
  }

  console.log(`\n[download] done: ${items.length - failed} ok, ${failed} failed`);
  if (errors.length > 0) {
    console.log("[download] errors:", JSON.stringify(errors.slice(0, 10), null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: 添加 npm script**

编辑 `package.json` 的 `scripts`，加：

```json
"download:mp4s": "tsx --env-file=.env.local scripts/download-mp4s.ts",
```

- [ ] **Step 5: yt-dlp 烟雾测试（避免全跑炸）**

```bash
node -e "const d=require('./data/rescrape-2026-05-13.json'); const tt=d.find(v=>v.platform==='tiktok'&&v.videoUrl)?.videoUrl; const ig=d.find(v=>v.platform==='instagram'&&v.videoUrl)?.videoUrl; console.log('tt:',tt); console.log('ig:',ig);"
```

拷贝输出的两个 URL，分别跑：

```bash
npx youtube-dl-exec --version
npx tsx -e "import('./lib/enrichment/video-downloader').then(async m => { const r=await m.downloadVideo('<TT_URL>', 'data/raw-mp4s/_smoke_tt.mp4'); console.log('tt:', r); })"
npx tsx -e "import('./lib/enrichment/video-downloader').then(async m => { const r=await m.downloadVideo('<IG_URL>', 'data/raw-mp4s/_smoke_ig.mp4'); console.log('ig:', r); })"
```

Expected: 两条都返回 `{ ok: true, bytes: >100000, cached: false }`。如果其中一条失败：
- TT 失败 → 报告 BLOCKED（TT 是大头 180 条）
- IG 失败 → 接受，full run 把 IG 当 best-effort，输出 errors 列表

烟雾测试通过后清掉测试文件：
```bash
rm -f data/raw-mp4s/_smoke_tt.mp4 data/raw-mp4s/_smoke_ig.mp4
```

- [ ] **Step 6: 跑全量下载**

```bash
npm run download:mp4s
```

Expected: 控制台输出每条进度，最终 `done: 220+/287 ok`（yt-dlp 对 IG 公开 reel 解析率 70-90%，TT 95%+）。预计耗时：10-20 min（并发 5）。

- [ ] **Step 7: 验证下载结果**

```bash
ls "data/raw-mp4s/" | grep -c "\.mp4$"
node -e "const fs=require('fs'); const files=fs.readdirSync('data/raw-mp4s').filter(f=>f.endsWith('.mp4')); const sizes=files.map(f=>fs.statSync('data/raw-mp4s/'+f).size); console.log('count:', files.length, 'total MB:', (sizes.reduce((a,b)=>a+b,0)/1024/1024).toFixed(0));"
```

Expected: count 220+，total MB 1500-4000。

- [ ] **Step 8: 提交 downloader 模块（mp4 产物已 gitignore）**

```bash
git add lib/enrichment/video-downloader.ts scripts/download-mp4s.ts package.json package-lock.json
git commit -m "feat(enrichment): yt-dlp based mp4 batch downloader for page URLs"
```

---

### Task 4: 富化批量 runner（单条任务包装 + 通用 batch-runner）

**Files:**
- Create: `lib/enrichment/types.ts`
- Create: `lib/enrichment/cutplan-job.ts`
- Create: `lib/enrichment/batch-runner.ts`

- [ ] **Step 1: 共享类型**

```typescript
// lib/enrichment/types.ts
import type { CutPlan } from "@/lib/cut-plan/schema";

export type EnrichmentJob = {
  videoId: string;
  videoPath: string;
  platform: string;
  topic: string;
  durationSec: number;
};

export type EnrichmentSuccess = {
  ok: true;
  videoId: string;
  cutPlan: CutPlan;
  elapsedMs: number;
};

export type EnrichmentFailure = {
  ok: false;
  videoId: string;
  reason: string;
  stage: "ffprobe" | "gemini" | "schema" | "write" | "unknown";
};

export type EnrichmentResult = EnrichmentSuccess | EnrichmentFailure;

export type BatchProgress = {
  total: number;
  done: number;
  ok: number;
  failed: number;
  skipped: number;
};
```

- [ ] **Step 2: 单条富化任务包装**

```typescript
// lib/enrichment/cutplan-job.ts
import { stat, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { probeVideoMeta } from "@/lib/video/ffprobe-meta";
import { analyzeMaterialPotential } from "@/lib/video/analyze-potential";
import { CutPlanSchema } from "@/lib/cut-plan/schema";
import type {
  EnrichmentJob,
  EnrichmentResult,
} from "./types";

const OUT_DIR = "data/enriched-cutplans";

export async function isAlreadyEnriched(videoId: string): Promise<boolean> {
  try {
    const s = await stat(join(process.cwd(), OUT_DIR, `${videoId}.json`));
    return s.isFile() && s.size > 100;
  } catch {
    return false;
  }
}

export async function loadEnrichedCutPlan(videoId: string) {
  const path = join(process.cwd(), OUT_DIR, `${videoId}.json`);
  const raw = await readFile(path, "utf-8");
  return CutPlanSchema.parse(JSON.parse(raw));
}

export async function runCutPlanJob(job: EnrichmentJob): Promise<EnrichmentResult> {
  const start = Date.now();
  let meta;
  try {
    meta = await probeVideoMeta(job.videoPath);
  } catch (e) {
    return {
      ok: false,
      videoId: job.videoId,
      reason: (e as Error).message,
      stage: "ffprobe",
    };
  }

  let analyzed;
  try {
    analyzed = await analyzeMaterialPotential({
      videoPath: job.videoPath,
      videoId: job.videoId,
      meta,
      hints: { userTopic: job.topic },
    });
  } catch (e) {
    return {
      ok: false,
      videoId: job.videoId,
      reason: (e as Error).message,
      stage: "gemini",
    };
  }

  try {
    const validated = CutPlanSchema.parse(analyzed.cutPlan);
    const outPath = join(process.cwd(), OUT_DIR, `${job.videoId}.json`);
    await writeFile(outPath, JSON.stringify(validated, null, 2), "utf-8");
    return {
      ok: true,
      videoId: job.videoId,
      cutPlan: validated,
      elapsedMs: Date.now() - start,
    };
  } catch (e) {
    return {
      ok: false,
      videoId: job.videoId,
      reason: (e as Error).message,
      stage: e instanceof Error && e.name === "ZodError" ? "schema" : "write",
    };
  }
}
```

- [ ] **Step 3: 通用 batch-runner**

```typescript
// lib/enrichment/batch-runner.ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  BatchProgress,
  EnrichmentJob,
  EnrichmentResult,
  EnrichmentFailure,
} from "./types";
import { isAlreadyEnriched, runCutPlanJob } from "./cutplan-job";

export type BatchOptions = {
  concurrency?: number;
  onProgress?: (p: BatchProgress, last: EnrichmentResult | null) => void;
  errorsOutPath?: string;
};

export async function runEnrichmentBatch(
  jobs: EnrichmentJob[],
  opts: BatchOptions = {},
): Promise<{ ok: number; failed: number; skipped: number }> {
  const { concurrency = 5, onProgress, errorsOutPath } = opts;
  const progress: BatchProgress = {
    total: jobs.length,
    done: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
  };
  const failures: EnrichmentFailure[] = [];

  let cursor = 0;
  const inflight: Promise<void>[] = [];

  const next = async (): Promise<void> => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const skip = await isAlreadyEnriched(job.videoId);
      if (skip) {
        progress.skipped++;
        progress.done++;
        onProgress?.(progress, null);
        continue;
      }
      const result = await runCutPlanJob(job);
      progress.done++;
      if (result.ok) progress.ok++;
      else {
        progress.failed++;
        failures.push(result);
      }
      onProgress?.(progress, result);
    }
  };

  for (let i = 0; i < concurrency; i++) inflight.push(next());
  await Promise.all(inflight);

  if (errorsOutPath && failures.length > 0) {
    await writeFile(
      join(process.cwd(), errorsOutPath),
      JSON.stringify(failures, null, 2),
      "utf-8",
    );
  }

  return { ok: progress.ok, failed: progress.failed, skipped: progress.skipped };
}
```

- [ ] **Step 4: 提交 runner 模块**

```bash
git add lib/enrichment/types.ts lib/enrichment/cutplan-job.ts lib/enrichment/batch-runner.ts
git commit -m "feat(enrichment): cutplan job + concurrent batch runner with resume"
```

---

### Task 5: 跑 299 条富化

**Files:**
- Create: `scripts/enrich-cutplans-batch.ts`

- [ ] **Step 1: 写 CLI**

```typescript
// scripts/enrich-cutplans-batch.ts
/**
 * Run: npx tsx --env-file=.env.local scripts/enrich-cutplans-batch.ts
 *
 * 读 data/rescrape-2026-05-13.json + data/raw-mp4s/*.mp4
 * 跑批量 Gemini 富化，输出 data/enriched-cutplans/{videoId}.json
 *
 * 支持断点续跑：已存在的 cutplan 文件自动 skip。
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { runEnrichmentBatch } from "@/lib/enrichment/batch-runner";
import type { EnrichmentJob } from "@/lib/enrichment/types";

type Item = {
  id: string;
  platform: string;
  topic: string;
  duration: number;
  videoUrl: string | null;
};

async function main() {
  const inPath = join(process.cwd(), "data", "rescrape-2026-05-13.json");
  const raw = await readFile(inPath, "utf-8");
  const items = JSON.parse(raw) as Item[];

  const jobs: EnrichmentJob[] = [];
  for (const v of items) {
    const mp4 = join(process.cwd(), "data", "raw-mp4s", `${v.id}.mp4`);
    const stats = await stat(mp4).catch(() => null);
    if (!stats || stats.size < 1024) continue;
    jobs.push({
      videoId: v.id,
      videoPath: mp4,
      platform: v.platform,
      topic: v.topic,
      durationSec: v.duration,
    });
  }
  console.log(`[enrich] ${jobs.length} jobs queued (skipping ${items.length - jobs.length} missing mp4s)`);

  const startedAt = Date.now();
  const summary = await runEnrichmentBatch(jobs, {
    concurrency: 5,
    errorsOutPath: "data/enrichment-errors.json",
    onProgress: (p, last) => {
      if (last) {
        const tag = last.ok ? "OK " : `FAIL[${last.stage}]`;
        const ms = last.ok ? `${(last.elapsedMs / 1000).toFixed(1)}s` : last.reason.slice(0, 60);
        process.stdout.write(
          `  [${p.done}/${p.total}] ${tag} ${last.videoId} ${ms}\n`,
        );
      }
    },
  });

  const elapsed = ((Date.now() - startedAt) / 1000 / 60).toFixed(1);
  console.log(`\n[enrich] done in ${elapsed}min: ok=${summary.ok}, failed=${summary.failed}, skipped=${summary.skipped}`);
  if (summary.failed > 0) {
    console.log(`[enrich] errors written to data/enrichment-errors.json`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: 添加 npm script**

编辑 `package.json` 的 `scripts`，加：

```json
"enrich:cutplans": "tsx --env-file=.env.local scripts/enrich-cutplans-batch.ts",
```

- [ ] **Step 3: 跑富化（一次性）**

```bash
npm run enrich:cutplans
```

Expected: 输出 `done in 50-70min: ok=250+, failed=<30, skipped=0`。预计耗时：50-70 min；预计费用 $15-20。

- [ ] **Step 4: 验证产物**

```bash
ls "data/enriched-cutplans/" | wc -l
node -e "const fs=require('fs'); const f=fs.readdirSync('data/enriched-cutplans').filter(x=>x.endsWith('.json')); console.log('count:', f.length); const sample=JSON.parse(fs.readFileSync('data/enriched-cutplans/'+f[0],'utf-8')); console.log('sample keys:', Object.keys(sample)); console.log('actions count:', sample.actions?.length); console.log('density.overall:', sample.density?.overall);"
```

Expected: count 250+；sample 输出包含 `actions` / `density` / `dimensions` 字段；actions.length > 5。

- [ ] **Step 5: 如有失败，必要时重跑（断点续跑会跳过已成功的）**

如 `enrichment-errors.json` 显示大量同一类型错误（如 `gemini` quota exceeded），等 1h 后再跑 `npm run enrich:cutplans`。schema 类错误需要单独看 prompt。

- [ ] **Step 6: 提交富化产物 + 脚本**

```bash
git add scripts/enrich-cutplans-batch.ts package.json data/enriched-cutplans/
git commit -m "feat(enrichment): batch enrich 250+ viral cutplans via Gemini 2.5 Pro"
```

---

### Task 6: sample-references 切换到真实数据

**Files:**
- Modify: `lib/sample-references/index.ts`（完全重写 `loadSamples`）

- [ ] **Step 1: 改写 loadSamples 从 enriched-cutplans 读**

替换 `lib/sample-references/index.ts` 全部内容：

```typescript
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { CutPlanSchema, type CutPlan } from "@/lib/cut-plan/schema";

/**
 * Phase 6 后：从 data/enriched-cutplans/ 加载真实富化爆款池。
 *
 * 兼容回退：若 enriched-cutplans 为空（未跑富化），退回 lib/sample-references/cutplans/ 的 2 条 demo。
 */

const ENRICHED_DIR = "data/enriched-cutplans";
const FALLBACK_DIR = "lib/sample-references/cutplans";
const FALLBACK_FILES = [
  "transformation-match-cut.json",
  "vlog-pull-out-aerial.json",
] as const;

export type ReferenceFilter = {
  userFormat?: string;
  userTopic?: string;
  limit?: number;
};

export type ReferenceLoadResult = {
  cutPlans: CutPlan[];
  source: "sample" | "database";
  notice?: string;
};

let cache: { plans: CutPlan[]; source: "sample" | "database" } | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60 * 1000;

async function loadEnriched(): Promise<CutPlan[]> {
  const dir = join(process.cwd(), ENRICHED_DIR);
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const results: CutPlan[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(join(dir, f), "utf-8");
      results.push(CutPlanSchema.parse(JSON.parse(raw)));
    } catch (e) {
      console.warn(`[sample-references] skip ${f}: ${(e as Error).message}`);
    }
  }
  return results;
}

async function loadFallback(): Promise<CutPlan[]> {
  const dir = join(process.cwd(), FALLBACK_DIR);
  const results: CutPlan[] = [];
  for (const name of FALLBACK_FILES) {
    try {
      const raw = await readFile(join(dir, name), "utf-8");
      results.push(CutPlanSchema.parse(JSON.parse(raw)));
    } catch {
      /* missing fallback is fine */
    }
  }
  return results;
}

async function getCache(): Promise<{ plans: CutPlan[]; source: "sample" | "database" }> {
  if (cache && Date.now() - cacheTime < CACHE_TTL_MS) return cache;
  const enriched = await loadEnriched();
  if (enriched.length >= 10) {
    cache = { plans: enriched, source: "database" };
  } else {
    const fallback = await loadFallback();
    cache = { plans: [...enriched, ...fallback], source: "sample" };
  }
  cacheTime = Date.now();
  return cache;
}

function filterByFormat(plans: CutPlan[], format: string): CutPlan[] {
  const f = format.toLowerCase().trim();
  return plans.filter((p) => p.videoFormat.toLowerCase().startsWith(f));
}

export async function loadReferenceCutPlans(
  filter: ReferenceFilter = {},
): Promise<ReferenceLoadResult> {
  const { plans, source } = await getCache();
  const limit = filter.limit ?? 5;

  let pool = plans;
  if (filter.userFormat) {
    const matched = filterByFormat(plans, filter.userFormat);
    if (matched.length >= limit) pool = matched;
  }

  const top = pool
    .slice()
    .sort((a, b) => (b.density.overall ?? 0) - (a.density.overall ?? 0))
    .slice(0, limit);

  return {
    cutPlans: top,
    source,
    notice:
      source === "database"
        ? `从富化爆款池中按 format=${filter.userFormat ?? "any"} 召回 ${top.length} 条`
        : `Demo 数据池：${top.length} 条手工样本（富化未跑或失败）`,
  };
}
```

- [ ] **Step 2: 端到端跑一次 /technique-match 验证**

```bash
# 启动 dev server
npm run dev
```

打开浏览器到 `http://localhost:3000/technique-match`，上传一条本地视频（可用 `data/raw-mp4s/` 任意一条），观察：
- Stage `load_refs` 显示 `source=database`
- 召回 5 条 CutPlan
- 整个 pipeline 跑完 < 4min

Expected: 端到端跑通，UI 显示 5 条来自真实库的对标视频拆解。

- [ ] **Step 3: 提交**

```bash
git add lib/sample-references/index.ts
git commit -m "feat(retrieval): switch sample-references to enriched cutplan pool (250+ videos)"
```

---

## P2 · Technique 反向索引

### Task 7: 装 vitest + 测试骨架

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/technique-index/fixtures/sample-cutplan.json`

- [ ] **Step 1: 装 vitest**

```bash
npm install -D vitest @vitest/ui
```

- [ ] **Step 2: 加测试脚本**

编辑 `package.json` 的 `scripts`，在末尾加：

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: 写 vitest 配置**

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 4: 准备测试 fixture**

```bash
# 拷贝一条已富化的样本作为测试 fixture（任选一条）
mkdir -p tests/technique-index/fixtures
node -e "const fs=require('fs'); const f=fs.readdirSync('data/enriched-cutplans').filter(x=>x.endsWith('.json'))[0]; fs.copyFileSync('data/enriched-cutplans/'+f,'tests/technique-index/fixtures/sample-cutplan.json'); console.log('copied:', f);"
```

- [ ] **Step 5: 跑空测试验证装好了**

```bash
npm run test
```

Expected: `No test files found` 但 vitest 启动成功（exit 0 或 1，关键是 vitest 命令存在）。

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json vitest.config.ts tests/technique-index/fixtures/sample-cutplan.json
git commit -m "chore(test): add vitest + technique-index test fixtures"
```

---

### Task 8: TechniqueTags 类型

**Files:**
- Create: `lib/technique-index/types.ts`

- [ ] **Step 1: 写类型**

```typescript
// lib/technique-index/types.ts
/**
 * Technique tag 命名空间：
 *   每个维度独立 tag list，避免 "push-in"（camera）和 "match-cut"（cut）混淆。
 *   tag 字符串采用 kebab-case，从 CutPlan.actions[].kind/type 标准化而来。
 */
export type TechniqueTags = {
  /** 来自 CutAction.toShotSize 变化 / kind=="cut" 的特殊语义（match-cut 等） */
  cuts: string[];
  /** 来自 TransitionAction.type（normalize 后） */
  transitions: string[];
  /** 来自 CameraMoveAction.type */
  cameraMoves: string[];
  /** 来自 SpeedChangeAction（freeze / ramp-up / slow-mo / ...） */
  speedChanges: string[];
  /** 来自 EffectAction.type */
  effects: string[];
  /** 来自 SubtitleAction.style.animation（kinetic / static / ...） */
  subtitleStyles: string[];
  /** 来自 BgmMarker.kind（beat / drop / vocal_phrase / ...） */
  audioSyncAnchors: string[];
  /** 来自 StructureDimension.hookFormat */
  hookFormats: string[];
};

export type TechniqueIndex = {
  /** 索引版本，方便日后破坏性升级 */
  version: 1;
  /** 生成时间戳（ISO） */
  generatedAt: string;
  /** 入索引的视频数 */
  videoCount: number;
  /** 反向：tag → 命中的 videoId list（按 density.overall 降序） */
  byTechnique: Record<string, string[]>;
  /** 正向：videoId → 它有哪些 tag（方便从用户匹配结果反查） */
  videoTags: Record<string, TechniqueTags>;
};

/** 用于「召回时给候选打分」：候选 video 的 tag 跟用户 desired tag 的命中数 */
export type CandidateScore = {
  videoId: string;
  matchedTags: string[];
  score: number;
};
```

- [ ] **Step 2: 提交**

```bash
git add lib/technique-index/types.ts
git commit -m "feat(technique-index): TechniqueTags + TechniqueIndex types"
```

---

### Task 9: extract-tags 纯函数（TDD）

**Files:**
- Create: `tests/technique-index/extract-tags.test.ts`
- Create: `lib/technique-index/extract-tags.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// tests/technique-index/extract-tags.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractTechniqueTags, normalizeTag } from "@/lib/technique-index/extract-tags";
import type { CutPlan } from "@/lib/cut-plan/schema";

const sample = JSON.parse(
  readFileSync(join(__dirname, "fixtures/sample-cutplan.json"), "utf-8"),
) as CutPlan;

describe("normalizeTag", () => {
  it("snake_case → kebab-case", () => {
    expect(normalizeTag("push_in")).toBe("push-in");
    expect(normalizeTag("CROSS_DISSOLVE")).toBe("cross-dissolve");
  });

  it("trims + lowercases", () => {
    expect(normalizeTag("  Whip Pan  ")).toBe("whip-pan");
  });

  it("collapses repeated separators", () => {
    expect(normalizeTag("push__in")).toBe("push-in");
    expect(normalizeTag("push - in")).toBe("push-in");
  });

  it("drops 'other' / empty", () => {
    expect(normalizeTag("other")).toBe("");
    expect(normalizeTag("")).toBe("");
  });
});

describe("extractTechniqueTags", () => {
  it("returns deduped tags from sample cutplan", () => {
    const tags = extractTechniqueTags(sample);
    expect(tags.cuts).toEqual([...new Set(tags.cuts)]);
    expect(tags.transitions).toEqual([...new Set(tags.transitions)]);
    expect(tags.cameraMoves).toEqual([...new Set(tags.cameraMoves)]);
  });

  it("collects cameraMoves from camera_move actions", () => {
    const cutPlan: CutPlan = {
      ...sample,
      actions: [
        { kind: "camera_move", at: { sec: 0 }, type: "push_in", durationSec: 1 },
        { kind: "camera_move", at: { sec: 2 }, type: "Pull-Out", durationSec: 1 },
        { kind: "camera_move", at: { sec: 4 }, type: "static", durationSec: 1 },
      ],
    };
    const tags = extractTechniqueTags(cutPlan);
    expect(tags.cameraMoves).toContain("push-in");
    expect(tags.cameraMoves).toContain("pull-out");
    expect(tags.cameraMoves).toContain("static");
  });

  it("collects match-cut from cut actions with matching shotSize", () => {
    const cutPlan: CutPlan = {
      ...sample,
      actions: [
        {
          kind: "cut",
          at: { sec: 1 },
          fromShotSize: "close_up",
          toShotSize: "close_up",
        },
      ],
    };
    const tags = extractTechniqueTags(cutPlan);
    expect(tags.cuts).toContain("match-cut");
  });

  it("collects transition tags", () => {
    const cutPlan: CutPlan = {
      ...sample,
      actions: [
        { kind: "transition", at: { sec: 1 }, type: "whip_pan", durationFrames: 6 },
        { kind: "transition", at: { sec: 3 }, type: "cross_dissolve", durationFrames: 12 },
      ],
    };
    const tags = extractTechniqueTags(cutPlan);
    expect(tags.transitions).toContain("whip-pan");
    expect(tags.transitions).toContain("cross-dissolve");
  });

  it("collects hookFormat from structure dimension", () => {
    const cutPlan: CutPlan = {
      ...sample,
      dimensions: {
        ...sample.dimensions,
        structure: {
          ...sample.dimensions.structure,
          hookFormat: "before_after",
        },
      },
    };
    const tags = extractTechniqueTags(cutPlan);
    expect(tags.hookFormats).toContain("before-after");
  });

  it("skips 'other' / empty values", () => {
    const cutPlan: CutPlan = {
      ...sample,
      actions: [
        { kind: "camera_move", at: { sec: 0 }, type: "other", durationSec: 0 },
        { kind: "camera_move", at: { sec: 1 }, type: "", durationSec: 0 },
      ],
    };
    const tags = extractTechniqueTags(cutPlan);
    expect(tags.cameraMoves).not.toContain("other");
    expect(tags.cameraMoves).not.toContain("");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm run test -- tests/technique-index/extract-tags.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/technique-index/extract-tags'`.

- [ ] **Step 3: 写最小实现**

```typescript
// lib/technique-index/extract-tags.ts
import type { CutPlan, TimedAction } from "@/lib/cut-plan/schema";
import type { TechniqueTags } from "./types";

export function normalizeTag(raw: string): string {
  if (!raw) return "";
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (t === "other" || t === "unknown" || t === "none") return "";
  return t;
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of arr) {
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function detectCutTags(actions: TimedAction[]): string[] {
  const tags: string[] = [];
  for (const a of actions) {
    if (a.kind !== "cut") continue;
    if (a.fromShotSize && a.toShotSize && a.fromShotSize === a.toShotSize) {
      tags.push("match-cut");
    }
    if (a.fromShotSize && a.toShotSize && a.fromShotSize !== a.toShotSize) {
      const from = a.fromShotSize;
      const to = a.toShotSize;
      if (
        (from === "wide" && to === "close_up") ||
        (from === "close_up" && to === "wide") ||
        (from === "extreme_wide" && to === "extreme_close_up") ||
        (from === "extreme_close_up" && to === "extreme_wide")
      ) {
        tags.push("scale-jump");
      }
    }
  }
  return tags;
}

export function extractTechniqueTags(plan: CutPlan): TechniqueTags {
  const cuts: string[] = detectCutTags(plan.actions);
  const transitions: string[] = [];
  const cameraMoves: string[] = [];
  const speedChanges: string[] = [];
  const effects: string[] = [];
  const subtitleStyles: string[] = [];

  for (const a of plan.actions) {
    if (a.kind === "transition") {
      transitions.push(normalizeTag(a.type));
    } else if (a.kind === "camera_move") {
      cameraMoves.push(normalizeTag(a.type));
    } else if (a.kind === "speed_change") {
      if (a.multiplier === 0) speedChanges.push("freeze");
      else if (a.multiplier > 1) speedChanges.push("ramp-up");
      else if (a.multiplier > 0 && a.multiplier < 1) speedChanges.push("slow-mo");
    } else if (a.kind === "effect") {
      effects.push(normalizeTag(a.type));
    } else if (a.kind === "subtitle") {
      const animation = a.style?.animation;
      if (animation) subtitleStyles.push(normalizeTag(animation));
    }
  }

  const audioSyncAnchors: string[] = [];
  if (plan.bgm?.markers) {
    for (const m of plan.bgm.markers) {
      audioSyncAnchors.push(normalizeTag(m.kind));
    }
  }

  const hookFormats: string[] = [normalizeTag(plan.dimensions.structure.hookFormat)];

  return {
    cuts: dedupe(cuts),
    transitions: dedupe(transitions),
    cameraMoves: dedupe(cameraMoves),
    speedChanges: dedupe(speedChanges),
    effects: dedupe(effects),
    subtitleStyles: dedupe(subtitleStyles),
    audioSyncAnchors: dedupe(audioSyncAnchors),
    hookFormats: dedupe(hookFormats),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npm run test -- tests/technique-index/extract-tags.test.ts
```

Expected: 全部测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add tests/technique-index/extract-tags.test.ts lib/technique-index/extract-tags.ts
git commit -m "feat(technique-index): extract-tags pure function + tests"
```

---

### Task 10: build-index 构建反向索引（TDD）

**Files:**
- Create: `tests/technique-index/build-index.test.ts`
- Create: `lib/technique-index/build-index.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/technique-index/build-index.test.ts
import { describe, it, expect } from "vitest";
import { buildTechniqueIndex } from "@/lib/technique-index/build-index";
import type { CutPlan } from "@/lib/cut-plan/schema";

function makePlan(
  id: string,
  overall: number,
  patch: Partial<CutPlan>,
): CutPlan {
  return {
    videoId: id,
    durationSec: 30,
    fps: 30,
    videoFormat: "vlog",
    videoFormatConfidence: 0.9,
    actions: [],
    dimensions: {
      pacing: {
        shotCount: 5,
        avgShotDurationSec: 6,
        cutDensityPerSec: 0.2,
        rhythmProfile: "medium",
      },
      camera: {
        dominantMovements: [],
        shotSizeDistribution: {
          extreme_close_up: 0,
          close_up: 0,
          medium: 1,
          wide: 0,
          extreme_wide: 0,
        },
        transitionPatterns: [],
      },
      audiovisual: {
        bgmPattern: "steady",
        bgmSyncTightness: "moderate",
        subtitleStyle: "centered_minimal",
      },
      structure: {
        hookFormat: "question",
        openingShot: "",
        endingShot: "",
      },
    },
    density: { editing: 50, transition: 50, effect: 50, bgmSync: 50, overall },
    ...patch,
  };
}

describe("buildTechniqueIndex", () => {
  it("returns empty index for empty input", () => {
    const idx = buildTechniqueIndex([]);
    expect(idx.videoCount).toBe(0);
    expect(idx.byTechnique).toEqual({});
    expect(idx.videoTags).toEqual({});
    expect(idx.version).toBe(1);
  });

  it("builds reverse index from camera_move actions", () => {
    const plans = [
      makePlan("a", 80, {
        actions: [{ kind: "camera_move", at: { sec: 0 }, type: "push_in", durationSec: 1 }],
      }),
      makePlan("b", 90, {
        actions: [{ kind: "camera_move", at: { sec: 0 }, type: "push_in", durationSec: 1 }],
      }),
      makePlan("c", 70, {
        actions: [{ kind: "camera_move", at: { sec: 0 }, type: "pull_out", durationSec: 1 }],
      }),
    ];
    const idx = buildTechniqueIndex(plans);
    expect(idx.videoCount).toBe(3);
    expect(idx.byTechnique["camera-move:push-in"]).toEqual(["b", "a"]);
    expect(idx.byTechnique["camera-move:pull-out"]).toEqual(["c"]);
  });

  it("namespaces tags by dimension", () => {
    const plans = [
      makePlan("a", 50, {
        actions: [
          { kind: "camera_move", at: { sec: 0 }, type: "push_in", durationSec: 1 },
          { kind: "transition", at: { sec: 1 }, type: "push_in", durationFrames: 6 },
        ],
      }),
    ];
    const idx = buildTechniqueIndex(plans);
    expect(idx.byTechnique["camera-move:push-in"]).toEqual(["a"]);
    expect(idx.byTechnique["transition:push-in"]).toEqual(["a"]);
  });

  it("sorts each tag's videoId list by density.overall desc", () => {
    const plans = [
      makePlan("low", 30, {
        actions: [{ kind: "camera_move", at: { sec: 0 }, type: "push_in", durationSec: 1 }],
      }),
      makePlan("high", 95, {
        actions: [{ kind: "camera_move", at: { sec: 0 }, type: "push_in", durationSec: 1 }],
      }),
      makePlan("mid", 60, {
        actions: [{ kind: "camera_move", at: { sec: 0 }, type: "push_in", durationSec: 1 }],
      }),
    ];
    const idx = buildTechniqueIndex(plans);
    expect(idx.byTechnique["camera-move:push-in"]).toEqual(["high", "mid", "low"]);
  });

  it("populates videoTags forward index", () => {
    const plans = [
      makePlan("a", 50, {
        actions: [{ kind: "camera_move", at: { sec: 0 }, type: "push_in", durationSec: 1 }],
      }),
    ];
    const idx = buildTechniqueIndex(plans);
    expect(idx.videoTags["a"].cameraMoves).toContain("push-in");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm run test -- tests/technique-index/build-index.test.ts
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: 写实现**

```typescript
// lib/technique-index/build-index.ts
import type { CutPlan } from "@/lib/cut-plan/schema";
import type { TechniqueIndex, TechniqueTags } from "./types";
import { extractTechniqueTags } from "./extract-tags";

const DIMENSION_PREFIXES: Record<keyof TechniqueTags, string> = {
  cuts: "cut",
  transitions: "transition",
  cameraMoves: "camera-move",
  speedChanges: "speed-change",
  effects: "effect",
  subtitleStyles: "subtitle",
  audioSyncAnchors: "audio-sync",
  hookFormats: "hook",
};

export function buildTechniqueIndex(plans: CutPlan[]): TechniqueIndex {
  const byTechnique = new Map<string, { videoId: string; score: number }[]>();
  const videoTags: Record<string, TechniqueTags> = {};

  for (const plan of plans) {
    const tags = extractTechniqueTags(plan);
    videoTags[plan.videoId] = tags;

    for (const dim of Object.keys(DIMENSION_PREFIXES) as (keyof TechniqueTags)[]) {
      const prefix = DIMENSION_PREFIXES[dim];
      for (const tag of tags[dim]) {
        if (!tag) continue;
        const key = `${prefix}:${tag}`;
        const list = byTechnique.get(key) ?? [];
        list.push({ videoId: plan.videoId, score: plan.density.overall ?? 0 });
        byTechnique.set(key, list);
      }
    }
  }

  const sortedByTechnique: Record<string, string[]> = {};
  for (const [k, list] of byTechnique) {
    sortedByTechnique[k] = list
      .sort((a, b) => b.score - a.score)
      .map((x) => x.videoId);
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    videoCount: plans.length,
    byTechnique: sortedByTechnique,
    videoTags,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npm run test -- tests/technique-index/build-index.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add tests/technique-index/build-index.test.ts lib/technique-index/build-index.ts
git commit -m "feat(technique-index): reverse-index builder + tests"
```

---

### Task 11: load-index loader（cache 层）

**Files:**
- Create: `lib/technique-index/load-index.ts`

- [ ] **Step 1: 写 loader**

```typescript
// lib/technique-index/load-index.ts
import "server-only";
import { readFile } from "fs/promises";
import { join } from "path";
import type { TechniqueIndex } from "./types";

const INDEX_PATH = "data/technique-index.json";
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: TechniqueIndex | null = null;
let cacheTime = 0;

export async function loadTechniqueIndex(): Promise<TechniqueIndex | null> {
  if (cache && Date.now() - cacheTime < CACHE_TTL_MS) return cache;
  try {
    const raw = await readFile(join(process.cwd(), INDEX_PATH), "utf-8");
    cache = JSON.parse(raw) as TechniqueIndex;
    cacheTime = Date.now();
    return cache;
  } catch {
    return null;
  }
}

export function clearTechniqueIndexCache() {
  cache = null;
  cacheTime = 0;
}
```

- [ ] **Step 2: 提交**

```bash
git add lib/technique-index/load-index.ts
git commit -m "feat(technique-index): cached index loader"
```

---

### Task 12: similarity 用户 Potential ↔ 候选 tag 评分（TDD）

**Files:**
- Create: `tests/technique-index/similarity.test.ts`
- Create: `lib/technique-index/similarity.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/technique-index/similarity.test.ts
import { describe, it, expect } from "vitest";
import { potentialToDesiredTags, scoreCandidates } from "@/lib/technique-index/similarity";
import type { TechniqueIndex } from "@/lib/technique-index/types";

const idx: TechniqueIndex = {
  version: 1,
  generatedAt: "2026-05-13T00:00:00.000Z",
  videoCount: 3,
  byTechnique: {
    "camera-move:push-in": ["a", "b"],
    "camera-move:pull-out": ["c"],
    "cut:match-cut": ["a"],
  },
  videoTags: {
    a: {
      cuts: ["match-cut"],
      transitions: [],
      cameraMoves: ["push-in"],
      speedChanges: [],
      effects: [],
      subtitleStyles: [],
      audioSyncAnchors: [],
      hookFormats: ["question"],
    },
    b: {
      cuts: [],
      transitions: [],
      cameraMoves: ["push-in"],
      speedChanges: [],
      effects: [],
      subtitleStyles: [],
      audioSyncAnchors: [],
      hookFormats: ["before-after"],
    },
    c: {
      cuts: [],
      transitions: [],
      cameraMoves: ["pull-out"],
      speedChanges: [],
      effects: [],
      subtitleStyles: [],
      audioSyncAnchors: [],
      hookFormats: ["question"],
    },
  },
};

describe("potentialToDesiredTags", () => {
  it("maps push-in opportunities to camera-move:push-in tag", () => {
    const tags = potentialToDesiredTags({
      pushInOpportunities: [{ at: { sec: 1 }, reason: "centered subject" }],
      matchCutCandidates: [],
      sceneTransitionCandidates: [],
    });
    expect(tags).toContain("camera-move:push-in");
  });

  it("maps match-cut candidates to cut:match-cut", () => {
    const tags = potentialToDesiredTags({
      pushInOpportunities: [],
      matchCutCandidates: [{ pairId: "p1", from: { sec: 1 }, to: { sec: 3 }, reason: "" }],
      sceneTransitionCandidates: [],
    });
    expect(tags).toContain("cut:match-cut");
  });

  it("returns empty array when no opportunities", () => {
    const tags = potentialToDesiredTags({
      pushInOpportunities: [],
      matchCutCandidates: [],
      sceneTransitionCandidates: [],
    });
    expect(tags).toEqual([]);
  });
});

describe("scoreCandidates", () => {
  it("returns candidates sorted by match count then alphabetical", () => {
    const scored = scoreCandidates(idx, ["camera-move:push-in", "cut:match-cut"]);
    expect(scored[0].videoId).toBe("a");
    expect(scored[0].matchedTags).toEqual(["camera-move:push-in", "cut:match-cut"]);
    expect(scored[0].score).toBe(2);
    expect(scored[1].videoId).toBe("b");
    expect(scored[1].score).toBe(1);
  });

  it("returns empty array when no tags match", () => {
    const scored = scoreCandidates(idx, ["camera-move:dolly-zoom"]);
    expect(scored).toEqual([]);
  });

  it("does not include videos with zero matches", () => {
    const scored = scoreCandidates(idx, ["camera-move:push-in"]);
    const ids = scored.map((c) => c.videoId);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).not.toContain("c");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm run test -- tests/technique-index/similarity.test.ts
```

Expected: FAIL.

- [ ] **Step 3: 写实现**

```typescript
// lib/technique-index/similarity.ts
import type { CandidateScore, TechniqueIndex } from "./types";

export type DesiredFromPotential = {
  pushInOpportunities: Array<{ at: { sec: number }; reason: string }>;
  matchCutCandidates: Array<{
    pairId: string;
    from: { sec: number };
    to: { sec: number };
    reason: string;
  }>;
  sceneTransitionCandidates: Array<{ at: { sec: number }; reason: string }>;
};

/**
 * 把用户视频的 Potential 维度映射成 "desired technique tag list"。
 * 例：用户视频探到 3 个 push-in 机会 → 用户期望对标"使用 push-in 的爆款"。
 */
export function potentialToDesiredTags(potential: DesiredFromPotential): string[] {
  const tags: string[] = [];
  if (potential.pushInOpportunities.length > 0) tags.push("camera-move:push-in");
  if (potential.matchCutCandidates.length > 0) tags.push("cut:match-cut");
  if (potential.sceneTransitionCandidates.length > 0) tags.push("transition:whip-pan");
  return tags;
}

/**
 * 给索引里每条候选打分：matched tag 数量越多分越高。
 */
export function scoreCandidates(
  index: TechniqueIndex,
  desiredTags: string[],
): CandidateScore[] {
  if (desiredTags.length === 0) return [];

  const counter = new Map<string, { matched: string[]; score: number }>();
  for (const tag of desiredTags) {
    const videoIds = index.byTechnique[tag] ?? [];
    for (const id of videoIds) {
      const entry = counter.get(id) ?? { matched: [], score: 0 };
      entry.matched.push(tag);
      entry.score++;
      counter.set(id, entry);
    }
  }

  return [...counter.entries()]
    .map(([videoId, { matched, score }]) => ({
      videoId,
      matchedTags: matched,
      score,
    }))
    .sort((a, b) => b.score - a.score || a.videoId.localeCompare(b.videoId));
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npm run test -- tests/technique-index/similarity.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add tests/technique-index/similarity.test.ts lib/technique-index/similarity.ts
git commit -m "feat(technique-index): similarity scorer for potential → desired tags"
```

---

### Task 13: build-technique-index 一次性脚本

**Files:**
- Create: `scripts/build-technique-index.ts`

- [ ] **Step 1: 写 CLI**

```typescript
// scripts/build-technique-index.ts
/**
 * Run: npx tsx --env-file=.env.local scripts/build-technique-index.ts
 *
 * 读 data/enriched-cutplans/*.json → 构建反向索引 → 写 data/technique-index.json
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CutPlanSchema, type CutPlan } from "@/lib/cut-plan/schema";
import { buildTechniqueIndex } from "@/lib/technique-index/build-index";

async function main() {
  const dir = join(process.cwd(), "data", "enriched-cutplans");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  console.log(`[build-index] reading ${files.length} cutplans`);

  const plans: CutPlan[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(join(dir, f), "utf-8");
      plans.push(CutPlanSchema.parse(JSON.parse(raw)));
    } catch (e) {
      console.warn(`  skip ${f}: ${(e as Error).message}`);
    }
  }

  console.log(`[build-index] valid cutplans: ${plans.length}`);
  const idx = buildTechniqueIndex(plans);

  const outPath = join(process.cwd(), "data", "technique-index.json");
  await writeFile(outPath, JSON.stringify(idx, null, 2), "utf-8");

  const tagCount = Object.keys(idx.byTechnique).length;
  const top5 = Object.entries(idx.byTechnique)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);
  console.log(`[build-index] wrote ${outPath}`);
  console.log(`  total tags: ${tagCount}`);
  console.log(`  top tags:`);
  for (const [tag, ids] of top5) {
    console.log(`    ${tag}: ${ids.length} videos`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: 加 npm script**

编辑 `package.json` 的 `scripts`，加：

```json
"build:technique-index": "tsx --env-file=.env.local scripts/build-technique-index.ts",
```

- [ ] **Step 3: 跑构建**

```bash
npm run build:technique-index
```

Expected: 输出 `valid cutplans: 250+`、`total tags: 30+`、top5 显示常见技法（如 `camera-move:push-in` `cut:match-cut` `hook:question` 等）。

- [ ] **Step 4: 检视产物**

```bash
node -e "const d=require('./data/technique-index.json'); console.log('version:', d.version); console.log('videos:', d.videoCount); console.log('tag count:', Object.keys(d.byTechnique).length); console.log('sample videoTags:', Object.keys(d.videoTags)[0], d.videoTags[Object.keys(d.videoTags)[0]]);"
```

Expected: videoCount 250+，至少 20 个独立 tags。

- [ ] **Step 5: 提交**

```bash
git add scripts/build-technique-index.ts package.json data/technique-index.json
git commit -m "feat(technique-index): generate reverse index from 250+ enriched cutplans"
```

---

### Task 14: retrieval 接 technique-cluster 召回

**Files:**
- Modify: `lib/sample-references/index.ts`

- [ ] **Step 1: 扩展 ReferenceFilter + retrieval 逻辑**

替换 `lib/sample-references/index.ts` 的 `loadReferenceCutPlans` 部分（保留 Task 6 写的 `loadEnriched` / `loadFallback` / `getCache` / `filterByFormat`），完整版本如下：

```typescript
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { CutPlanSchema, type CutPlan } from "@/lib/cut-plan/schema";
import { loadTechniqueIndex } from "@/lib/technique-index/load-index";
import { scoreCandidates } from "@/lib/technique-index/similarity";

const ENRICHED_DIR = "data/enriched-cutplans";
const FALLBACK_DIR = "lib/sample-references/cutplans";
const FALLBACK_FILES = [
  "transformation-match-cut.json",
  "vlog-pull-out-aerial.json",
] as const;

export type ReferenceFilter = {
  userFormat?: string;
  userTopic?: string;
  /** P2 新增：用户期望的技法 tag（来自 potential → desiredTags 映射） */
  desiredTechniques?: string[];
  limit?: number;
};

export type ReferenceLoadResult = {
  cutPlans: CutPlan[];
  source: "sample" | "database" | "technique-cluster";
  notice?: string;
};

let cache: { plans: CutPlan[]; map: Map<string, CutPlan>; source: "sample" | "database" } | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60 * 1000;

async function loadEnriched(): Promise<CutPlan[]> {
  const dir = join(process.cwd(), ENRICHED_DIR);
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const results: CutPlan[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(join(dir, f), "utf-8");
      results.push(CutPlanSchema.parse(JSON.parse(raw)));
    } catch (e) {
      console.warn(`[sample-references] skip ${f}: ${(e as Error).message}`);
    }
  }
  return results;
}

async function loadFallback(): Promise<CutPlan[]> {
  const dir = join(process.cwd(), FALLBACK_DIR);
  const results: CutPlan[] = [];
  for (const name of FALLBACK_FILES) {
    try {
      const raw = await readFile(join(dir, name), "utf-8");
      results.push(CutPlanSchema.parse(JSON.parse(raw)));
    } catch {
      /* missing fallback is fine */
    }
  }
  return results;
}

async function getCache(): Promise<{ plans: CutPlan[]; map: Map<string, CutPlan>; source: "sample" | "database" }> {
  if (cache && Date.now() - cacheTime < CACHE_TTL_MS) return cache;
  const enriched = await loadEnriched();
  let plans: CutPlan[];
  let source: "sample" | "database";
  if (enriched.length >= 10) {
    plans = enriched;
    source = "database";
  } else {
    plans = [...enriched, ...(await loadFallback())];
    source = "sample";
  }
  const map = new Map<string, CutPlan>();
  for (const p of plans) map.set(p.videoId, p);
  cache = { plans, map, source };
  cacheTime = Date.now();
  return cache;
}

function filterByFormat(plans: CutPlan[], format: string): CutPlan[] {
  const f = format.toLowerCase().trim();
  return plans.filter((p) => p.videoFormat.toLowerCase().startsWith(f));
}

export async function loadReferenceCutPlans(
  filter: ReferenceFilter = {},
): Promise<ReferenceLoadResult> {
  const { plans, map, source } = await getCache();
  const limit = filter.limit ?? 5;

  // Path A: technique-cluster 召回（P2 优先路径）
  if (filter.desiredTechniques && filter.desiredTechniques.length > 0) {
    const idx = await loadTechniqueIndex();
    if (idx) {
      const scored = scoreCandidates(idx, filter.desiredTechniques);
      const matched: CutPlan[] = [];
      for (const c of scored) {
        const p = map.get(c.videoId);
        if (p) matched.push(p);
        if (matched.length >= limit) break;
      }
      if (matched.length >= Math.min(3, limit)) {
        return {
          cutPlans: matched,
          source: "technique-cluster",
          notice: `技法簇召回：按 ${filter.desiredTechniques.join(", ")} 命中 ${matched.length} 条爆款`,
        };
      }
    }
  }

  // Path B: format 召回（P1 baseline）
  let pool = plans;
  if (filter.userFormat) {
    const matched = filterByFormat(plans, filter.userFormat);
    if (matched.length >= limit) pool = matched;
  }

  const top = pool
    .slice()
    .sort((a, b) => (b.density.overall ?? 0) - (a.density.overall ?? 0))
    .slice(0, limit);

  return {
    cutPlans: top,
    source,
    notice:
      source === "database"
        ? `从富化爆款池中按 format=${filter.userFormat ?? "any"} 召回 ${top.length} 条`
        : `Demo 数据池：${top.length} 条手工样本（富化未跑或失败）`,
  };
}
```

- [ ] **Step 2: 改 /api/technique-match 把 desiredTechniques 传进去**

修改 `app/api/technique-match/route.ts`，在 `loadReferenceCutPlans` 调用前后做这两处改动。

找到 line 137-141 附近：

```typescript
const refs = await loadReferenceCutPlans({
  userFormat: userPotential.detectedFormat,
  userTopic: topic || undefined,
  limit: 5,
});
```

替换为：

```typescript
const { potentialToDesiredTags } = await import("@/lib/technique-index/similarity");
const desiredTechniques = potentialToDesiredTags({
  pushInOpportunities: userPotential.potential.pushInOpportunities ?? [],
  matchCutCandidates: userPotential.potential.matchCutCandidates ?? [],
  sceneTransitionCandidates: userPotential.potential.sceneTransitionCandidates ?? [],
});
const refs = await loadReferenceCutPlans({
  userFormat: userPotential.detectedFormat,
  userTopic: topic || undefined,
  desiredTechniques,
  limit: 5,
});
```

并把已有的 `send({ stage: "load_refs", ... })` 那条 progress event 改 `notice` 显示 `refs.source`（已经存在了，不用动）。

- [ ] **Step 3: 端到端验证**

```bash
npm run dev
```

打开 `/technique-match`，上传一条 mp4，观察 `load_refs` stage 的 `source` 字段：
- 若用户视频有 push-in 机会 / match-cut 候选 → `source: "technique-cluster"`
- 若 desiredTechniques 为空 → `source: "database"`（format 召回兜底）

Expected: 大部分用户视频走 `technique-cluster` 路径，notice 显示具体命中了哪些 tag。

- [ ] **Step 4: 提交**

```bash
git add lib/sample-references/index.ts app/api/technique-match/route.ts
git commit -m "feat(retrieval): technique-cluster recall path + format fallback"
```

---

### Task 15: 收尾 push

- [ ] **Step 1: 跑一次完整 build 确认无 ts 错误**

```bash
npm run build
```

Expected: build 成功，无错误。

- [ ] **Step 2: 跑一次全测**

```bash
npm run test
```

Expected: 三个测试文件全部 PASS。

- [ ] **Step 3: push 到 origin**

```bash
git log origin/main..HEAD --oneline
git push origin main
```

Expected: push 成功，Vercel 自动触发 deploy。

- [ ] **Step 4: production 烟雾测试**

打开 `https://viral-reviewer.vercel.app/technique-match`，上传一条 mp4，确认：
- pipeline 跑完 < 4min
- 召回 5 条来自真实库的爆款
- 至少 1 条来自 `technique-cluster` 路径

---

## 后续步骤

P1+P2 完成后即可启动：
- **P3** 把 `/technique-match` 的 retrieval 接到 `lib/review-engine/retrieval.ts` 那条带实时抓取兜底的链路，处理"题材+技法都未覆盖"的冷启
- **P0** UI 合并 `/review` + `/technique-match` 为单页 `/analyze`，渐进披露

---

## Self-Review Notes

- 所有 task 的"测试代码"包含完整断言，无 placeholder
- 所有 Step 都有可执行 command 或可粘贴 code block
- 类型/函数名一致：`extractTechniqueTags`、`buildTechniqueIndex`、`scoreCandidates`、`potentialToDesiredTags`、`loadTechniqueIndex` 在 Task 8/9/10/11/12/14 一致
- Gemini 真金白银的步骤（Task 2/3/5）都有 expected output + 验证脚本
- 断点续跑机制（Task 4 `isAlreadyEnriched`）确保失败后重跑安全
- gitignore 在 Task 1 第一步就建好，避免后续 commit 误入大文件
