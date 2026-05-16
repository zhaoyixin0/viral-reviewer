# P5 · Vercel → Google Cloud Run 迁移 scope draft

> **写于** 2026-05-15 · 针对 main = `4c86cad` · 来自 W1
> **scope-template 版本** 2026-05-15（§4 已含 8 anti-patterns）
> **触发** W3 verdict `4c86cad`（user 拒 Vercel Pro $240/yr → Cloud Run 平台迁移）
> **task** #23（multi-day scope draft；docs only，不动代码）
> **目标** 把 viral-reviewer Next.js 15 App Router 全栈从 Vercel Functions（Hobby 300s wall-time）迁到 Google Cloud Run（service timeout 3600s），解锁 Opus 4.7 多视频 technique-match（N=6 实测 3-5min，贴近 300s 上限）+ 后续 N=10 扩展空间

---

## 1. 适用范围

P5 是一次**跨平台 host 迁移**，不是常规 hardening pass。它同时触发：

- §2.2 URL 来源 → 策略选择（GCS bucket allowlist 替换 `VERCEL_BLOB_PRESET`）
- §2.1 改动清单（11 个 Vercel-specific surface 类别）
- §2.6 风险面（生产 6 素材 vlog 仍受 Vercel 300s 影响整个 migration 窗口）

按 scope-template §1 强制走全套 §2 必填栏。

---

## 2. 必填栏

### 2.1 改动清单（11 categories × W3 预盘）

| # | 位置 | 改动类型 | 改动摘要 | route mode | 影响面 |
|---|---|---|---|---|---|
| 1 | `vercel.ts` + new `Dockerfile` + new `cloudbuild.yaml` | feat | runtime: Vercel Functions → Cloud Run container（Node 24 LTS） | n/a | infra |
| 2 | `lib/{account-profile,topic-cache,trending}/cache.ts` × 3 + `app/api/{template-brief-upload,upload,compile-capcut}` × 3 + `components/{technique-match,template-review,review}/*.tsx` × 4 | refactor | `@vercel/blob` → `@google-cloud/storage`（put/head/list/del 同语义封装） | n/a | lib + route + ui |
| 3 | `vercel.ts:crons` + new GCP Cloud Scheduler job → `POST /api/cron/trending` w/ OIDC token | refactor | Vercel Cron → Cloud Scheduler；`isAuthorized()` 改读 Google ID token (`x-goog-iap-jwt-assertion` 或 OIDC verify) | n/a | infra + route |
| 4 | `/api/trending` 路由 + Cloudflare（或 Cloud CDN） | refactor | Vercel ISR (1h revalidate 注释) → Cloudflare edge cache + `Cache-Control: s-maxage=3600` header | NDJSON / non-stream（实施前 grep 复核 §4 #5） | infra + route |
| 5 | `git push` → Vercel auto deploy + Preview URL → GitHub Actions / Cloud Build → Cloud Run revision + traffic tag URL | refactor | CI/CD + preview deploys | n/a | infra |
| 6 | Vercel Project Env (Encrypted) → Google Secret Manager + Cloud Run env binding | refactor | `BLOB_READ_WRITE_TOKEN` → GCS SA JSON key（或 Workload Identity）；`CRON_SECRET` → OIDC verify；其他 API keys 平迁 | n/a | infra |
| 7 | Vercel DNS → Cloud Run domain mapping + Cloudflare proxy | refactor | DNS 切流量 | n/a | infra |
| 8 | Vercel logs → Cloud Logging + 可选 Cloud Trace；rate-limit memory backend warn × 7 现状不动 | refactor | observability | n/a | infra |
| 9 | `next.config.ts:outputFileTracingIncludes`（ffmpeg/ffprobe Linux x64 lambda bundle） | refactor | Vercel lambda tracing → `Dockerfile COPY node_modules/ffmpeg-static/ffmpeg` | n/a | infra |
| 10 | 14 routes × `export const maxDuration = 60/120/300` | refactor | Vercel function timeout → Cloud Run service `--timeout=3600`（或 per-route Cloud Run jobs） | n/a | route |
| 11 | `lib/technique-matching/match-engine.ts:199` 当前 `messages.stream().finalMessage()` hot fix | **keep** | Cloud Run 上不受 SDK 10min 限（streaming 路径无 cap），但保留 stream API 以便未来切 NDJSON UX | n/a | lib |

**W3 核查 hint**：
- §2.1 加了 `route mode` 列（§4 anti-pattern #5 防御）
- #2 / #4 / #11 是动代码点；#1 / #3 / #5-#9 / #10 是 infra + 配置点
- 涉及 caller wiring 的只有 #2（GCS lib 用法跨 7+ 调用点）

### 2.2 URL / 数据源 → 策略选择表（**§2.2 必填**）

| # | 位置 | URL 来源 | URL host pattern | 选用 preset / 策略 | 现有校验 |
|---|---|---|---|---|---|
| 1 | `lib/trending/snapshot-store.ts` get | server lib 调 `head()`/`list()`/`del()` | GCS `storage.googleapis.com/<bucket>/...`（或 CMEK custom domain） | `GCS_PRESET`（新增；allowedHosts: `storage.googleapis.com` 单 host） | inline none → 改 SSRF 一致 |
| 2 | `lib/topic-cache/blob-cache.ts` | server lib `head()`/`put()` | 同上 | `GCS_PRESET` | 同上 |
| 3 | `lib/account-profile/cache.ts` | server lib `head()`/`put()` | 同上 | `GCS_PRESET` | 同上 |
| 4 | `app/api/upload/route.ts` + `app/api/template-brief-upload/route.ts` | client multipart upload（用户上传视频） | n/a（直接 SDK PUT，不走 fetch） | GCS signed URL（client → GCS direct） | route Zod schema + `BLOB_READ_WRITE_TOKEN` 等价物 |
| 5 | `app/api/compile-capcut/route.ts` | server fetch zip 中间结果 → 客户端 download | `storage.googleapis.com/<bucket>/...` | `GCS_PRESET` | inline none → 改 SSRF 一致 |
| 6 | `app/api/cron/trending/route.ts` | Cloud Scheduler → POST 自家 endpoint | n/a（出站不 fetch user URL；只 fetch TT/IG via lib/trending/fetch） | 不动；保留 `TIKTOK_INSTAGRAM_CDN_PRESET` | OIDC token verify 替代 `CRON_SECRET` |

**W3 核查 checklist**：
- [x] 每个 fetch 点 "URL 来源" 列具体（server lib / client upload / cron 出站）
- [x] 每个 fetch 点 "URL host pattern" 跟 preset 一致（GCS 单 host vs TT/IG 5 host）
- [ ] **W3 拍板**：新增 `GCS_PRESET` 是放在 `lib/url-allowlist/presets.ts` 还是单独 `lib/storage/preset.ts`？（与现有 `VERCEL_BLOB_PRESET` 命名一致性 vs storage 模块化分离）

### 2.3 设计决策点（A-J）

#### A. Cloud Run **service** vs **jobs**
- A1 **全部 service**（一个容器跑全栈 Next.js standalone server）
- A2 **service + jobs split**（technique-match / template-review 这种重 LLM 改 Cloud Run Jobs 异步触发，HTTP service 轻量）
- A3 **service + Cloud Tasks queue**（service 接 HTTP → 写 Cloud Tasks → worker service 处理）

**优缺点**：
- A1：简单，1 个 Dockerfile，1 个 CI。**缺**：Cloud Run service max timeout 3600s，但同步 request 仍受 HTTP idle timeout 15min 影响（虽然 stream 模式 OK）
- A2：长任务彻底解耦，stateless service 不受 LLM 阻塞。**缺**：需要前端 polling / WebSocket 改 UX，工作量大
- A3：架构最干净，可观测。**缺**：multi-container，CI 复杂度 ×2

**W1 倾向 A1**，理由：当前 NDJSON stream 已经在 Next.js handler 内做，Cloud Run service 3600s timeout + Node.js 24 LTS 完全够用 Opus 4.7 32K output（实测 3-5min）；A2/A3 是 N=10+ 或 batch 用户级别的优化，过早。
**请 W3 拍板**：A1 vs A2？如果 W3 选 A2，技术方案是 Cloud Run Jobs + Firestore 状态 polling 还是 Pub/Sub？

#### B. GCS 迁移路径（dual-write vs hard cut）
- B1 **hard cut**（停服 30min，code 切 GCS lib + env 切 SA key + 数据一次性 `gsutil rsync` from Vercel Blob）
- B2 **dual-write**（一段时间内 write 同时打 Vercel Blob 和 GCS，read 优先 GCS fallback Vercel Blob；稳定后停 Vercel Blob）

**优缺点**：
- B1：简单，1 个 PR。**缺**：停服窗口；trending snapshot / account-profile cache 数据需要 pre-migrate
- B2：零停服。**缺**：write 路径 ×2 复杂；fallback 逻辑要小心 cache key collision

**W1 倾向 B1**，理由：viral-reviewer 当前是低流量（用户单人 hands-on），停服 30min 可接受；trending snapshot 即使丢也会下周一 cron 重生；topic-cache / account-profile 是 cache，丢 = miss 重算。
**请 W3 拍板**：B1 vs B2？是否 freeze 1 周让数据自然过期再 hard cut？

#### C. Cron 选型
- C1 **Cloud Scheduler → HTTPS POST + OIDC token**（最贴近现有 Vercel Cron 语义）
- C2 **Cloud Scheduler → Pub/Sub → Cloud Run（push subscription）**（解耦，方便加多 worker）
- C3 **Cloud Workflows**（如果未来 cron 链路变多步）

**W1 倾向 C1**，理由：当前只 1 个 cron（trending snapshot 每周一 08:00 UTC），C2/C3 over-engineered。
**请 W3 拍板**：C1 vs C2？

#### D. CDN
- D1 **Cloudflare proxy** in front of Cloud Run（DNS only or full proxy）
- D2 **Cloud CDN**（GCP 原生）
- D3 **none**（直 Cloud Run，依赖 Next.js Cache-Control header + `revalidate`）

**W1 倾向 D1**，理由：Cloudflare 免费 plan 已经覆盖 viral-reviewer 流量级别；Cloud CDN 跟 Load Balancer 绑定费用高；D3 缺 edge cache（trending 路由 1h revalidate 必须 edge cache 才有意义）。
**请 W3 拍板**：D1 vs D2？是否预留迁去 Cloud CDN 的退路？

#### E. CI/CD
- E1 **GitHub Actions**（已有 git push 触发习惯）→ `gcloud run deploy` 命令
- E2 **Cloud Build trigger**（GCP 原生）→ Cloud Build → Cloud Run

**W1 倾向 E1**，理由：GitHub Actions 跨平台、`gcloud` CLI 文档充分；Cloud Build 跟 GCP 强绑定但 viral-reviewer 没 GCP 强投入打算。
**请 W3 拍板**：E1 vs E2？是否两者并存（main → E2 production，PR → E1 preview）？

#### F. Preview deploys
- F1 **Cloud Run revisions + traffic tag URL**（每个 PR 一个 tag-XXX---<service>.run.app）
- F2 **skip preview**（PR review 只看 code，merge 后直接 prod）
- F3 **本机 docker-compose** Dev 环境替代 preview

**优缺点**：
- F1：保留 Vercel Preview 的关键 UX。**缺**：每个 PR 跑 build + deploy，CI 时间 ×N；Cloud Run service 上限 1000 revisions，需要 GC 老的
- F2：CI 最快。**缺**：UI / E2E 验证只能在 main 上做
- F3：本机简单。**缺**：跟生产环境差异大

**W1 倾向 F1**，理由：viral-reviewer 频繁出 UI 改动（technique-match / template-review），preview URL 给 user 跑 E2E 是必要的；revision GC 用 `gcloud run revisions delete` 加 cron。
**请 W3 拍板**：F1 vs F2？revision GC 是放 cron 还是 deploy hook？

#### G. Secret 管理
- G1 **Google Secret Manager**（all secrets，Cloud Run binding 时 mount as env）
- G2 **直接 env via Cloud Run setEnvVar**（明文）

**W1 倾向 G1**，理由：APIFY_TOKEN 之前在 .env.local 已暴露过（memory `apify-token-rotation.md`，rotate 未做），Secret Manager + IAM 是必须；G2 是新泄漏入口。
**请 W3 拍板**：G1 必做？借迁移机会 rotate 所有 secrets（APIFY / ANTHROPIC / GOOGLE / OPENAI）？

#### H. DNS 切流量
- H1 **dual-domain test 期**（vrev.cloudrun.example.com 测 1 周 → 改 vrev.example.com CNAME → Cloudflare）
- H2 **hard cutover**（直接改 DNS A/CNAME，依赖 DNS TTL 自然分发）
- H3 **Cloudflare weighted routing**（10% / 50% / 100% 切流量）

**W1 倾向 H1**，理由：低流量项目，dual-domain 一周可以 user 自己点测；H3 over-engineered；H2 风险高（如果 Cloud Run 暴雷无回滚）。
**请 W3 拍板**：H1 测试期多久？多少个核心路由必须通过 user E2E 才能切（/trending / /technique-match / /template-review）？

#### I. Dual-run 阶段
- I1 **不 dual-run**（hard cutover after preview verified）
- I2 **dual-run 1 周**（Vercel + Cloud Run 并存，DNS 50/50；任一暴雷快速切回）
- I3 **dual-run 1 个月**（更保守）

**W1 倾向 I1**，理由：维护两套环境 + 数据同步（B1 hard cut 已经 GCS only）成本高于带来的安全感；preview 阶段已经验证。
**请 W3 拍板**：I1 vs I2？

#### J. Rollback 策略
- J1 **DNS 切回 Vercel**（前提：Vercel 部署不 sunset，至少保留 1 个月）
- J2 **Cloud Run revision rollback**（`gcloud run services update-traffic --to-revisions=<prev>=100`）+ Vercel 已 sunset
- J3 **两层都备**（J1 + J2）

**W1 倾向 J3**，理由：rollback 是命门，多一层备份成本是空跑 Vercel deploy 1 个月（免费 Hobby plan 不占额度）。
**请 W3 拍板**：J3 OK？Vercel 保留多久才 sunset（1 月 / 3 月 / 永久）？

### 2.4 提议改动清单（基于 W1 倾向 A1/B1/C1/D1/E1/F1/G1/H1/I1/J3）

按 W3 verdict 通过后的实施 phase 拆（**docs only scope，不在本 PR 实施**，仅给 W3 估算工作量）：

| Phase | 文件 | LoC 估算 | 新增测试 |
|---|---|---|---|
| P5.1 GCS lib 替换 | `lib/storage/gcs.ts`（new，put/head/list/del 同语义封装）+ 3 cache lib 改 import + 3 upload route 改 SDK + 4 components 改 client uploader | 改 ~600 / new ~200 | `tests/storage/gcs.test.ts`（unit）+ `tests/storage/gcs-integration.test.ts`（against local gcloud emulator） |
| P5.2 Dockerfile + Cloud Build | `Dockerfile`（multi-stage：base node:24-alpine → deps install → next build standalone → runner 拷 .next/standalone + ffmpeg binaries）+ `cloudbuild.yaml`（或 `.github/workflows/deploy.yml`） | new ~150 | smoke test：`docker build && docker run -p 8080:8080` 跑 `/api/trending` 200 |
| P5.3 Cron 改造 | `app/api/cron/trending/route.ts:isAuthorized()` 加 OIDC verify 分支 + terraform / gcloud 命令文档 cron job | 改 ~30 / docs | `tests/api/cron-trending.test.ts` 加 OIDC token mock case |
| P5.4 next.config.ts 清理 | 删 `outputFileTracingIncludes`（Cloud Run Dockerfile COPY 接管） | 改 ~6 | n/a |
| P5.5 maxDuration 清理 | 14 routes 删 `export const maxDuration`（无害保留也可，Vercel-specific 但 Next.js 解析时忽略） | 改 ~14 | n/a |
| P5.6 env / secret 迁移 | `.env.example` 更新（BLOB_READ_WRITE_TOKEN → GOOGLE_APPLICATION_CREDENTIALS）；Secret Manager 创建 + IAM 文档 | 改 ~5 / docs | n/a |
| P5.7 DNS + CDN 切流量 | 纯 ops，docs only | 0 | n/a |
| P5.8 observability | Cloud Logging structured log helper + 删 `console.warn/error` 全转 structured | 改 ~20 | n/a |

**合计**：改 ~675 LoC / new ~350 LoC / docs ~多个。8 phase 跨 2-3 周（W3 verdict 预估）。

### 2.5 三门估算（**仅 docs scope，本 PR 三门不变**）

本 scope draft 是 docs only（`docs/coordination/scopes/p5-cloud-run-migration.md` 新增 + `docs/coordination/window-1.md` append），实施 phase 才动代码。本 PR 三门：

- `tsc --noEmit`：0 error（docs only，无 TS 变动）
- `vitest run`：base + 0 new
- `next build`：routes 0 变化 / bundle 0 变化

**实施 phase（P5.1+）三门估算（W3 verdict 通过后单独 scope）**：

- `tsc --noEmit`：0 error（GCS lib 用 `@google-cloud/storage` 官方 types）
- `vitest run`：base + ~10 new（P5.1 unit 6 + integration 4）
- `next build`：14 routes 不变；bundle size 可能减小（删 `@vercel/blob`）或微增（加 `@google-cloud/storage`）
- **新增 pre-commit 验证**：本机 `docker build && docker run` baseline + Cloud Run local emulator (`gcloud beta code dev`) 跑 6 素材 E2E

### 2.6 风险面 + 兜底（含 cross-check §4 8 anti-patterns）

#### R1. P5 实施期生产仍受 Vercel 300s 影响
- **风险**：迁移窗口（2-3 周）user 跑 6 素材 vlog 仍可能 timeout
- **兜底**：短期：production 继续 Vercel hot fix `54d749b`，user 接受 300s 风险；中期：P5.1 完成后 dual-run 验证 Cloud Run 链路通；长期：DNS 切流量后 Vercel sunset

#### R2. Phase 3.5 (P3 #2 url-allowlist caller wiring) blocked
- **风险**：W3 verdict `4c86cad` 明确 phase 3.5 等 P5 完成；P5 拖延 = SSRF caller wiring 拖延
- **兜底**：W1 评估 phase 3.5 是否可以**先于** P5.7 DNS 切流量做（caller wiring 不涉及平台），W3 verdict 时拍

#### R3. GCS bucket cost vs Vercel Blob
- **风险**：Vercel Blob 含在 Hobby plan，GCS 按 GB-月 + egress 收费；trending snapshot 累计 ~10MB × 8 周 = 80MB，cache 类 ~几百 MB
- **兜底**：GCS free tier 5GB-月 + 1GB egress 北美内/月，远超当前用量；超额监控走 Cloud Billing budget alert（$5/月触发）

#### R4. Cloud Run cold start vs Vercel Fluid Compute
- **风险**：Vercel Fluid Compute 实例复用，Cloud Run min-instances=0 时冷启动 ~3-5s
- **兜底**：production service `--min-instances=1`（成本 ~$5/月恒定），preview revisions 留 0；或 `--cpu-boost` 减冷启动延迟

#### R5. ffmpeg binary 跨发行版兼容性
- **风险**：`ffmpeg-static`/`ffprobe-static` 的 Linux x64 binary 在 `node:24-alpine` 上跑可能 missing libc 依赖
- **兜底**：Dockerfile 用 `node:24-bookworm-slim`（glibc 而非 musl alpine）；本机 `docker run` smoke test 跑 `/api/analyze-video` 验证

#### R6. Secret rotation 时序
- **风险**：Secret Manager 迁移 + APIFY rotation（memory pending 项）需要协调，避免迁移中途 secret 失效
- **兜底**：P5.6 阶段先 dual-write secrets（Vercel env + GCP SM 同步），切流量后再 rotate；APIFY 在 P5.7 DNS cutover 当天 rotate

#### R7. Cloud Scheduler OIDC 跟现有 CRON_SECRET 双认证兼容
- **风险**：`app/api/cron/trending/route.ts:isAuthorized()` 已有 cronSecret + adminTriggerSecret 双逻辑；加第三个 OIDC verify 复杂度上升
- **兜底**：P5.3 phase 改 `isAuthorized()` 时保留 adminTriggerSecret（人手触发降级路径），cronSecret 退役改 OIDC

#### Cross-check §4 8 anti-patterns

| # | Anti-pattern | 适用 P5？ | 防御 |
|---|---|---|---|
| 1 | Caller 选错 preset | **Yes** | §2.2 表强制每 GCS 调用点列 preset；新增 `GCS_PRESET` 单 host |
| 2 | Lib optional 参数 → caller 漏传 SSRF | **Yes** | GCS lib API 设计时把 bucket / allowlist 设为 required 参数（非 optional），tsc 编译期堵 |
| 3 | Test fixture 假设旧 API 行为 | **Yes** | P5.1 实施前盘 `tests/trending/snapshot-store.test.ts` / `tests/api/cron-trending.test.ts` 等 fixture，确认 mock 已切 GCS（不是继续 mock `@vercel/blob`） |
| 4 | Stream 启动后 fail-fast → HTTP 200 but stream error | **Yes** | `/api/technique-match` / `/api/compile-capcut` 实施 P5.5 时保留现有 inline-before-stream 校验，**不改成 wrapper** |
| 5 | Scope 列 route mode (stream/non-stream) 但未复核 | **Yes** | §2.1 已加 route mode 列；P5.4 实施前 `grep -r "ReadableStream" app/api/` 复核 |
| 6 | DNS resolve 用 libc `dns.lookup` | **N/A** | P5 不动 SSRF resolve 路径（lib/url-allowlist 已用 `dns.promises.resolve4/6`） |
| 7 | Fetch IP literal 不传 SNI | **N/A** | 同上，P5 不动 fetch helper |
| 8 | Lib 不显式 close 资源 | **Yes** | GCS Storage client 长寿命复用（不需要 close）；但 P5.1 lib 设计需文档化"singleton 模式 vs per-request 实例"决策 |

**applicable: 5 / 8**。**N/A: 6, 7**（P5 不动 SSRF resolve / fetch 层）。

### 2.7 pre-commit 验证机制（**docs only scope，跳过 sample-verify**）

本 PR docs only，**跳过 sample-verify**。

**实施 phase（P5.1+）pre-commit 验证机制**：

- **P5.1 (GCS lib)**：本机 `gcloud beta emulators storage start` 起 GCS emulator → `pnpm test` 跑 integration test → 把 emulator host distribution 写 commit message
- **P5.2 (Dockerfile)**：本机 `docker build && docker run -p 8080:8080` → curl `/api/trending` 200 验证 → 把 image size + cold start 时间写 commit message
- **P5.3 (Cron)**：本机 mock OIDC JWT → 跑 `tests/api/cron-trending.test.ts` → 验证 401/403/200 三档
- **P5.5 (maxDuration)**：本机 `next build` 验证 bundle size 减小 / 不变
- **P5.7 (DNS cutover)**：staging 环境跑 6 素材 vlog E2E（user hands-on）→ 全链 timing 写 commit message

---

## 3. W3 拍板待回答清单（汇总）

按决策点编号 W3 应在 verdict 中给 explicit answer：

- **A**: service-only (A1) vs service+jobs (A2)？
- **B**: hard cut (B1) vs dual-write (B2)？freeze 期长度？
- **C**: HTTPS+OIDC (C1) vs Pub/Sub (C2)？
- **D**: Cloudflare (D1) vs Cloud CDN (D2)？
- **E**: GitHub Actions (E1) vs Cloud Build (E2)？双 pipeline OK？
- **F**: Cloud Run revisions+tag (F1) vs skip preview (F2)？revision GC 怎么管？
- **G**: G1 必做？借机 rotate 所有 secrets？
- **H**: dual-domain 期长度？核心路由 verify checklist？
- **I**: 不 dual-run (I1) vs dual-run 1 周 (I2)？
- **J**: J3（DNS 退路 + revision 退路）？Vercel 保留多久 sunset？

**额外 W3 拍板**：
- §2.2 末尾：`GCS_PRESET` 放 `lib/url-allowlist/presets.ts` 还是 `lib/storage/preset.ts`？
- R2: phase 3.5 (url-allowlist caller wiring) 是否能 P5.7 之前做（不阻塞 P5）？
- §2.6 R7: cronSecret 改 OIDC verify 时是否完全退役 cronSecret 字段？
- §2.6 R5: Dockerfile base image alpine 还是 bookworm-slim？

---

## 4. 实施时序（W3 verdict 通过后）

```
P5.1 GCS lib (1 week, W1 + W2 协作 — W2 写 lib + W1 改 caller)
   ↓
P5.2 Dockerfile + Cloud Build (3 days, W2)
   ↓
P5.3 Cron OIDC (1 day, W1)
   ↓
P5.4 next.config.ts cleanup (1 hour, W1)
   ↓
P5.5 maxDuration cleanup (1 hour, W1)
   ↓
P5.6 Secret Manager + env 切 (2 days, W1)
   ↓
P5.7 DNS + CDN cutover (1 day ops + 1 week dual-domain test, user hands-on)
   ↓
P5.8 Observability (3 days, W1) — 可以 P5.2 后任何时间做
```

**总工期** ~2.5 周。期间生产仍 Vercel hot fix `54d749b`。

---

## 5. 待 W3 verdict 后下一步

1. W3 在 verdict 中逐项答复 §3 拍板清单
2. W1 起 P5.1 scope draft（GCS lib 详细 API design + caller wiring）→ W3 review
3. W2 起 P5.2 scope draft（Dockerfile multi-stage + Cloud Build YAML）→ W3 review
4. ...逐 phase 推进

**block list**：phase 3.5（url-allowlist caller wiring）按 R2 是否能并行做，等 W3 verdict。
