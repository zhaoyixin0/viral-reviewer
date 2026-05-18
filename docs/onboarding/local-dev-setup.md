# Local Dev Setup — viral-reviewer

> 目标：让新 dev / 重装环境的 dev **< 30 min** 把 local dev 跑起来，验证 GCS upload + GCS read trending snapshot + Anthropic + Gemini + Apify 端到端。

本指南分四部分：

1. **Quick start**（已有 GCP 访问权限的 dev，10 行命令跑起来）
2. **从零 setup**（首次需要 GCP / Apify / Anthropic / OpenAI 等 credential）
3. **Env vars reference**（每个变量来源、是否 secret、production binding）
4. **Troubleshooting**（W1 在 T6 C5 撞的 3 个真实 issue + 解法）

---

## 1. Quick start（已配过本机的 dev）

前提：本机已有 `gcloud auth application-default login` + `.env.local` 已配过一次。

```bash
git pull origin main
npm install
npm run dev
# 浏览器开 http://localhost:3000
```

Smoke check 路由：

| 路由 | 验证什么 |
|---|---|
| `/` | 首页能渲染（无 LLM call） |
| `/trending` | GCS read 通（读 `trending/snapshot-2026-W*.json`） |
| `/technique-match` 上传 1 个测试 mp4 | GCS POST signed URL + Apify + Haiku + Opus 端到端 |

如果任何一步 fail，跳到 §4 Troubleshooting。

---

## 2. 从零 setup（首次 onboarding）

### 2.1 装本机工具

| 工具 | 用途 | 安装 |
|---|---|---|
| Node.js 20+（推荐 22 LTS） | runtime（`package.json` engines `>=20`） | https://nodejs.org/ |
| npm 10+ | 包管理 | 随 Node |
| `gcloud` CLI | GCP auth + Secret Manager + ADC | https://cloud.google.com/sdk/docs/install |
| `openssl` | 生成本机随机 secret | Windows 走 Git Bash 自带 / macOS 自带 |
| `git` | 版本控制 | 已装 |

Windows 注意：
- 推荐用 **Git Bash**（Git for Windows 自带）跑下面所有 bash 命令
- PowerShell 也行，但 `openssl rand -hex 32` 等命令用 Git Bash 更稳

### 2.2 Clone + 装依赖

```bash
git clone https://github.com/zhaoyixin0/viral-reviewer.git
cd viral-reviewer
npm install
```

### 2.3 GCS / GCP 认证（**最容易翻车的一步**）

viral-reviewer 用 GCS 存视频上传 + 周度 trending snapshot。`/api/upload` 走 GCS v4 signed POST policy，**SDK 必须能拿到 `client_email` 才能签 URL**。

走 ADC user creds（`gcloud auth application-default login`）的 dev creds **不带 `client_email`**，调 `generateSignedPostPolicy` 会爆：

```
SigningError: Cannot sign data without 'client_email'
```

所以 dev 三选一：

#### Option A — SA JSON download（**推荐**）

直接拿 service account 的 JSON key，跑得最稳。

**Pros**: 一次配完，所有 GCS 操作都能跑（含 signed URL 签发）。
**Cons**: JSON 文件含明文 private key，**绝对不能 commit / 不能上传**。
**安全**: 文件名建议 `*.service-account.json` 配合 `.gitignore` pattern（详见 §5）。

步骤：

```bash
# 1) 切到正确 GCP project
gcloud config set project <YOUR_GCP_PROJECT_ID>

# 2) 用已有的 cloud-run-runtime SA（prod runtime 用的同一个，权限刚好够 dev）
#    SA 已含 roles/storage.objectAdmin + 读 Secret Manager 权限
#    （详见 docs/deploy/cloud-run-setup.md §3.2）
SA_EMAIL="cloud-run-runtime@<YOUR_GCP_PROJECT_ID>.iam.gserviceaccount.com"

# 3) 创 key 并下载到本机 secure 位置（**不要放 repo 内**）
mkdir -p "$HOME/.gcp/viral-reviewer"
gcloud iam service-accounts keys create \
  "$HOME/.gcp/viral-reviewer/runtime-sa.json" \
  --iam-account="$SA_EMAIL"

# 4) 在 .env.local 里指 GOOGLE_APPLICATION_CREDENTIALS 到这条路径
#    （见 §2.4）
```

**Rotation**：建议每 90 天 rotate 一次。`gcloud iam service-accounts keys list --iam-account="$SA_EMAIL"` 看现有 key，删旧的：`gcloud iam service-accounts keys delete <KEY_ID> --iam-account="$SA_EMAIL"`。

#### Option B — SA impersonation（更安全，但 GCS signed URL **可能**不工作）

不下载明文 key，让 user creds 临时 impersonate SA：

```bash
gcloud auth application-default login \
  --impersonate-service-account="cloud-run-runtime@<YOUR_GCP_PROJECT_ID>.iam.gserviceaccount.com"
```

**Pros**: 不落地 private key 文件，撤销 IAM 即生效。
**Cons**: `@google-cloud/storage` `generateSignedPostPolicy` 对 impersonation 的支持依赖 SDK 版本 + IAM Credentials API 是否开启。**实测可能仍报 `Cannot sign data without 'client_email'`**（同 ADC user 一样的根因）。如果 Option A 能接受，优先 A。

如果决定试 B，需要先开 API：

```bash
gcloud services enable iamcredentials.googleapis.com
gcloud iam service-accounts add-iam-policy-binding \
  cloud-run-runtime@<YOUR_GCP_PROJECT_ID>.iam.gserviceaccount.com \
  --member="user:$(gcloud config get-value account)" \
  --role="roles/iam.serviceAccountTokenCreator"
```

如果 signed URL 仍 fail，回 Option A。

> 若 SDK 报 project 找不到（"Unable to detect a Project Id"），加：
> ```bash
> export GOOGLE_CLOUD_PROJECT=<YOUR_GCP_PROJECT_ID>   # macOS/Linux
> $env:GOOGLE_CLOUD_PROJECT = "<YOUR_GCP_PROJECT_ID>"  # Windows PowerShell
> ```
> SA JSON（Option A）自带 `project_id` 字段，不需要此 var；impersonation 路径下 SDK 偶尔需要。

#### Option C — ADC user creds（**仅 partial dev mode**）

```bash
gcloud auth application-default login
```

**能跑**：
- `/trending` (GCS read snapshot — 用 user 自身 storage.objects.get 权限)
- 所有不碰 GCS upload 的页面

**不能跑**：
- `/api/upload` → `SigningError`（如上）
- `/technique-match` 视频上传 e2e

适合：只改前端 UI 不动 upload 路径的快速 dev iteration。**不适合**：完整 e2e 验证、改 lib/storage/ 相关代码、跑 T6 InsightBanner 类需要 review 整链的 feature。

### 2.4 配 `.env.local`

```bash
cp .env.example .env.local
```

打开 `.env.local`，填以下值（详见 §3 reference）：

```dotenv
# Secrets (必填 — 缺则对应 feature 不工作)
APIFY_TOKEN=<Apify console 拿>
ANTHROPIC_API_KEY=<Anthropic console 拿>
GOOGLE_API_KEY=<GCP / AI Studio 拿 Gemini key>
OPENAI_API_KEY=<OpenAI 拿>

# Upload 链 (必填 — 缺则上传 503)
UPLOAD_SIGNING_SECRET=<本机生 — 见下>
GCS_BUCKET_NAME=viral-reviewer-blob-prod   # 或 dev 等同 bucket

# GCS ADC (Option A 必填，B/C 视情况)
GOOGLE_APPLICATION_CREDENTIALS=/Users/<you>/.gcp/viral-reviewer/runtime-sa.json
# Windows: GOOGLE_APPLICATION_CREDENTIALS=C:\Users\<you>\.gcp\viral-reviewer\runtime-sa.json

# Cron auth 本机 manual trigger 用（可选）
ADMIN_TRIGGER_SECRET=<本机生 — 见下>
```

**生本机 secret**：

```bash
# UPLOAD_SIGNING_SECRET：256-bit hex
openssl rand -hex 32

# ADMIN_TRIGGER_SECRET：随机字符串即可
openssl rand -hex 16
```

**注意**：本机随机 secret 跟 prod **不一样**没关系，prod 走 Secret Manager。本机的 secret 只用来 sign / verify 同一台机器本地 round-trip 的 token。

### 2.5 启 dev server

```bash
npm run dev
```

预期：见 `▲ Next.js 15.x.x  -  Local: http://localhost:3000` 无 startup error。

### 2.6 Smoke check（按顺序跑）

1. **首页** `http://localhost:3000` → 渲染（无 LLM call，验 build / hot reload OK）
2. **`/trending`** → trending dashboard 渲染。如果显示空 / 报错，检查 `GCS_BUCKET_NAME` + ADC creds（§4 #1）
3. **`/technique-match`** → 上传一个 < 50MB 的 mp4，等 review 完成。验：
   - GCS POST signed URL 签发成功（无 `SigningError`）
   - 视频上传到 bucket
   - Apify scrape 跑通（验 `APIFY_TOKEN`）
   - Haiku enrich + Opus review 跑通（验 `ANTHROPIC_API_KEY`）
   - Gemini understand 跑通（验 `GOOGLE_API_KEY`）

全 3 步绿 = local dev 完整可用。

---

## 3. Env vars reference

完整列表见 [`.env.example`](../../.env.example)（4-category taxonomy: secret / plain / local-only / auto）。下表只列 dev 必关心的：

### 必填（缺则 feature 不工作）

| Var | 来源 | Prod binding | Dev rotation 触发条件 |
|---|---|---|---|
| `APIFY_TOKEN` | https://console.apify.com → Account → Integrations → API tokens | Secret Manager `apify-token` | **2026-05-13 本机已暴露过一次**（memory note）— Apify Console 重生成即 rotate；任何怀疑泄露立即 rotate |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com → API Keys | Secret Manager `anthropic-api-key` | 离职 / 怀疑泄露 |
| `GOOGLE_API_KEY` | https://aistudio.google.com/app/apikey 或 GCP Console → Credentials | Secret Manager `google-api-key` | 同上 |
| `OPENAI_API_KEY` | https://platform.openai.com → API Keys | Secret Manager `openai-api-key` | 同上 |
| `UPLOAD_SIGNING_SECRET` | `openssl rand -hex 32`（dev 本机生） | Secret Manager `upload-signing-secret` | **不能 hot-rotate**（in-flight token 会失效）— rotation 流程见 `docs/deploy/cloud-run-setup.md` §7.2 |
| `GCS_BUCKET_NAME` | 用 prod bucket 名 `viral-reviewer-blob-prod` 或自己创 dev bucket | service.yaml plain env | 跟 bucket 一起生灭 |
| `GOOGLE_APPLICATION_CREDENTIALS` | SA JSON 路径（Option A）— see §2.3 | Cloud Run runtime SA 自动注入（**不在 service.yaml**） | 每 90 天 rotate SA key（GCP best practice） |

### 可选（不填走默认）

| Var | 默认 | 用途 |
|---|---|---|
| `ANTHROPIC_MODEL` | `claude-opus-4-7` | review / template-review LLM model |
| `VISION_MODEL` | `claude-haiku-4-5-20251001` | Vision 抽帧分析 |
| `ENRICH_MODEL` | `claude-haiku-4-5-20251001` | Apify scrape 后富化 |
| `HASHTAG_MODEL` | `claude-haiku-4-5-20251001` | 题材 → hashtag 翻译 |
| `TOPIC_INFERENCE_MODEL` | `claude-haiku-4-5-20251001` | 题材推断 |
| `GEMINI_VIDEO_MODEL` | `gemini-2.5-pro` | 视频 CutPlan IR 抽取 |
| `TRENDING_EVENT_MODEL` | `gemini-2.5-pro` | trending 事件检测 |
| `OPENAI_MODEL` | `gpt-4o` | Whisper fallback |
| `ANTHROPIC_HAIKU_MODEL` | `claude-haiku-4-5-20251001` | Template brainstorm / brief extract / account profile haiku 路径 |
| `BLOB_READ_WRITE_TOKEN` | 空 | **legacy**（P5.1.b GCS swap 后退役，无需配） |
| `CRON_SECRET` / `CRON_OIDC_AUDIENCE` / `CRON_OIDC_SERVICE_ACCOUNT` | 空 | Prod-only（Cloud Scheduler 触 cron）；本机不需要 |
| `ADMIN_TRIGGER_SECRET` | 空 | 本机手动触 `/api/cron/trending` 用（不填则该路由 403） |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 空 | Rate-limit backend；不填走 in-memory（dev 够用） |

### 自动注入（**不要手动设**）

| Var | 来源 |
|---|---|
| `GIT_SHA` | GHA deploy.yml yq 替换；本机 dev 自动是 `"dev"` |
| `PORT` | Cloud Run / Next.js 自动 |
| `NODE_ENV` | Next.js 自动（`development` / `production`） |

---

## 4. Troubleshooting

W1 在 T6 C5 hands-on e2e 撞的 3 个真实 issue（2026-05-18 documented in `docs/coordination/window-1.md`）：

### #1 `SigningError: Cannot sign data without 'client_email'`

**症状**：`/api/upload` 500 / 上传卡住。

**根因**：当前 ADC creds 是 user creds（`gcloud auth application-default login` 默认结果），不含 `client_email`。`@google-cloud/storage` `generateSignedPostPolicy` 不能签。

**解法**：走 §2.3 **Option A（SA JSON download）**。配完 `GOOGLE_APPLICATION_CREDENTIALS` 重启 `npm run dev`。

### #2 `storage_not_configured` 503

**症状**：`/api/upload` 503 `{"error":"storage_not_configured","message":"上传服务暂未配置"}`。

**根因**：缺 `UPLOAD_SIGNING_SECRET` **或** 缺 `GCS_BUCKET_NAME`（`lib/storage/signed-upload.ts` `requireUploadSecret()` + `lib/storage/client.ts` `getStorage()` 的 `bucketName` 判断 fail-fast）。

**解法**：检 `.env.local` 两个变量都有值 + 重启 dev server（Next.js 不 hot-reload env）。

### #3 `/trending` 显示空 / `readLatestTwoSnapshots` 返回 null

**症状**：`/trending` 页面渲染空状态 banner，或控制台没 GCS read log。

**根因**：缺 `GCS_BUCKET_NAME` → `getStorage().enabled === false` → snapshot store soft-fail return null。

**解法**：配 `GCS_BUCKET_NAME=viral-reviewer-blob-prod`（或自己 dev bucket）+ 重启。如果 bucket 名对但仍 null，跑：

```bash
gsutil ls gs://viral-reviewer-blob-prod/trending/
# 期：看到 snapshot-2026-W*.json 文件
```

无文件 = bucket 还没人填 snapshot（prod cron 跑过就有）。

### #4 `Apify rate limited` / scrape 返回 0 结果

**症状**：`/technique-match` review 跑到 Apify 阶段报 429 或返回空。

**根因**：免费 token 月度配额耗尽，或 Apify trends-actor 间歇性问题（known issue — `feedback_pre_push_reviewer_skip_dep_changes.md` 旁边的 backlog item）。

**解法**：
1. Apify Console → Billing 看 usage
2. 临时换另一个 token 测
3. 永久解：等 backlog Apify health monitoring epic（W3 dispatch backlog item 2）

### #5 `npm run dev` 启不来 / 端口冲突

**症状**：`Error: listen EADDRINUSE: address already in use :::3000`。

**解法**：

```bash
# macOS / Linux
lsof -ti:3000 | xargs kill -9

# Windows PowerShell
Get-NetTCPConnection -LocalPort 3000 | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }
```

或换端口：`PORT=3001 npm run dev`。

### #6 TypeScript compile error / `tsc --noEmit` 报 type 错

**症状**：dev server 启来了但页面渲染时 console 报 type error，或 IDE 全飘红。

**解法**：

```bash
node_modules/.bin/tsc --noEmit
```

跑通则 OK。如果报 missing dep，`npm install` 一次。

---

## 5. Secret management 安全

### 5.1 绝对不准 commit 的文件

| 文件 / pattern | 当前 `.gitignore` 覆盖？ | 备注 |
|---|---|---|
| `.env`, `.env.local`, `.env.*.local` | ✅ | 已显式列 |
| `*service-account*.json` | ❌ | **建议加** — 见下 |
| `*.gcp-key.json`, `runtime-sa.json` 等 SA key | ❌ | 同上 |

**建议给 `.gitignore` 加（防御性兜底）**：

```
# GCP service account JSON keys (never commit)
*service-account*.json
*.gcp-key.json
.gcp/
```

加完 commit 一次。

**主保护**（**比 .gitignore 更重要**）：把 SA JSON 放 repo 外（`$HOME/.gcp/viral-reviewer/` 而不是 `./service-account.json`），物理隔离防误操作。`.gcp/` 的 `.gitignore` 规则只能拦住"放进 working tree 根目录"的失误；放 `$HOME` 之外 git 完全看不到，更稳。

### 5.2 Pre-commit secret scan（可选）

推荐装 `gitleaks` 或 `git-secrets` 做本机 hook 防 push secret：

```bash
# macOS
brew install gitleaks
gitleaks protect --staged --verbose

# 集成到 .git/hooks/pre-commit
```

### 5.3 `APIFY_TOKEN` 已暴露过

`memory/apify-token-rotation.md` 记录：2026-05-13 会话中曾把 token 粘到 prompt 里，已是泄露状态。**任何 fresh dev setup 应直接拿到 token 后立即在 Apify Console rotate 一次**，老 token 立即吊销。

### 5.4 不要把 secret push 到 git

如果不小心 push 了 secret：
1. 立即在原服务（Anthropic / OpenAI / GCP / Apify Console）rotate
2. `git push --force-with-lease` rewrite history（如果上游唯一）
3. 用 [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) 清 git history
4. 通知所有持 clone 的 dev 重 clone

prod 跑 Secret Manager 是为了避免这类操作，dev 本机靠纪律。

---

## 6. 相关文档

- [`docs/deploy/cloud-run-setup.md`](../deploy/cloud-run-setup.md) — prod GCP setup 完整 runbook（Chapter 3 SA 创建 / Chapter 7 Secret Manager bootstrap）
- [`.env.example`](../../.env.example) — 完整 env var 清单 + 注释
- [`README.md`](../../README.md) — 项目高层介绍
- `docs/coordination/window-1.md` line 928-940 — W1 T6 C5 hands-on e2e 撞 3 issue 的原始记录

---

完。任何 step 跑不通，把现场 error stack + `.env.local` schema（**屏蔽 value**）贴 mailbox / issue。
