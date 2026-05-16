# Cloud Run Deployment Setup Runbook (P5.2.6)

> **scope**: viral-reviewer Vercel → Google Cloud Run 迁移 (P5 main scope).
> **prereq**: 本 runbook 仅覆盖 GCP-side setup (APIs / SAs / WIF / AR / GHA Secrets / Secret Manager / verify); 不覆盖 GitHub Actions workflow 内容 (见 `.github/workflows/deploy.yml`, P5.2.4) 或 Dockerfile (W4 P5.2.1) 或 `service.yaml` (P5.2.3, this PR commit `a6d7d5c`).
> **owner**: 一次性 ops 步骤,user 在 GCP Console + 本机 gcloud CLI 跑.
> **time**: ~30-45 min (assuming GCP project + billing 已 ready).
>
> **decision sources**:
> - W3 P5 verdict `baf1780` (A1 service-only + D1 Cloudflare + E1 GitHub Actions + F1 weekly revision GC + G1 Secret Manager)
> - W3 P5.2 verdict `f7d46bb` (D1 single-region us-central1 / E 6-章 runbook + verify / K1 runtime SA 分离)
> - W2 P5.2 scope draft (`docs/coordination/scopes/p5.2-dockerfile-cloud-build.md`)

---

## Chapter 1 — Prerequisites

### 1.1 GCP project

```bash
# 创建新 project (or 用已有)
gcloud projects create viral-reviewer-prod --name="Viral Reviewer Prod"

# 绑 billing account
gcloud beta billing accounts list                                # 找你的 billing ID
gcloud beta billing projects link viral-reviewer-prod \
  --billing-account=XXXXXX-XXXXXX-XXXXXX

# 设默认 project
gcloud config set project viral-reviewer-prod
```

### 1.2 本机工具

```bash
# 装 gcloud CLI (官方 installer): https://cloud.google.com/sdk/docs/install
gcloud --version                                                  # 期 ≥ 470.0.0

# 装 yq (deploy 时 IMAGE_TAG 替换需要)
brew install yq                                                   # macOS
choco install yq                                                  # Windows
sudo apt install yq                                               # Debian/Ubuntu

# 装 docker (本机 verify 步骤需要)
docker --version                                                  # 期 ≥ 24.0
```

### 1.3 本机认证

```bash
# user 个人 login (运行 setup 命令需要,有 Owner role)
gcloud auth login

# Application Default Credentials (本机跑 lib/storage 测试 against GCS sandbox 需要)
gcloud auth application-default login

# Verify
gcloud auth list
# 期: 看到你的 user email, active
```

### 1.4 环境变量约定（本 runbook 通用）

后续命令用以下 placeholder, 第一次执行前 set:

```bash
export GCP_PROJECT_ID="viral-reviewer-prod"
export GCP_REGION="us-central1"
export GH_REPO="zhaoyixin0/viral-reviewer"
# Project number 从 PROJECT_ID 推导:
export GCP_PROJECT_NUMBER=$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')
echo "Project number: $GCP_PROJECT_NUMBER"
```

### 1.5 **Verify**

```bash
gcloud config list
# 期看到: project = viral-reviewer-prod / account = <your email>

gcloud beta billing projects describe "$GCP_PROJECT_ID"
# 期看到 billingEnabled: true
```

---

## Chapter 2 — Enable GCP APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  iam.googleapis.com \
  sts.googleapis.com \
  storage.googleapis.com \
  --project="$GCP_PROJECT_ID"
```

API 用途说明:
| API | 用途 |
|---|---|
| `run.googleapis.com` | Cloud Run service deploy/run |
| `artifactregistry.googleapis.com` | Docker image 存储 |
| `secretmanager.googleapis.com` | 5 个 secret (ANTHROPIC/OPENAI/GOOGLE_API_KEY/APIFY/BLOB) 存储 |
| `iamcredentials.googleapis.com` | WIF OIDC 必需,允许 GHA short-lived token 换 SA token |
| `iam.googleapis.com` | SA / role 管理 |
| `sts.googleapis.com` | WIF 用 STS 换 token |
| `storage.googleapis.com` | P5.1.b GCS lib swap 后 viral-reviewer-cache bucket 用 |

### 2.5 **Verify**

```bash
gcloud services list --enabled --project="$GCP_PROJECT_ID" \
  --filter="name:(run.googleapis.com OR artifactregistry.googleapis.com OR secretmanager.googleapis.com OR iamcredentials.googleapis.com OR iam.googleapis.com OR sts.googleapis.com OR storage.googleapis.com)" \
  --format='value(name)'
# 期: 7 个 service 全列出
```

---

## Chapter 3 — Create Service Accounts (K1 verdict 分离)

按 W3 P5.2 verdict K1, 创建**两个** SA 分离 runtime / deployer 权限.

### 3.1 Deployer SA (CI/CD 用)

```bash
# 创建
gcloud iam service-accounts create cloud-run-deployer \
  --display-name="GHA deployer for Cloud Run" \
  --project="$GCP_PROJECT_ID"

# Grant roles (deploy / push image / impersonate runtime SA)
for role in \
  roles/run.admin \
  roles/artifactregistry.writer \
  roles/iam.serviceAccountUser \
  roles/iam.serviceAccountTokenCreator; do
  gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member="serviceAccount:cloud-run-deployer@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
    --role="$role" \
    --condition=None
done
```

Roles 说明:
| Role | 用途 |
|---|---|
| `roles/run.admin` | 部署 Cloud Run service / replace `service.yaml` |
| `roles/artifactregistry.writer` | 推 Docker image 到 AR |
| `roles/iam.serviceAccountUser` | impersonate cloud-run-runtime SA (Cloud Run 需要 deployer 能 actAs runtime SA) |
| `roles/iam.serviceAccountTokenCreator` | WIF short-lived token 必需 |

### 3.2 Runtime SA (Cloud Run service identity)

```bash
gcloud iam service-accounts create cloud-run-runtime \
  --display-name="Runtime SA for viral-reviewer Cloud Run service" \
  --project="$GCP_PROJECT_ID"

# Grant minimal roles (read secrets + access GCS bucket for P5.1.b)
for role in \
  roles/secretmanager.secretAccessor \
  roles/storage.objectAdmin; do
  gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member="serviceAccount:cloud-run-runtime@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
    --role="$role" \
    --condition=None
done
```

Roles 说明:
| Role | 用途 |
|---|---|
| `roles/secretmanager.secretAccessor` | Cloud Run runtime 读 Secret Manager (per `service.yaml` env binding) |
| `roles/storage.objectAdmin` | P5.1.b GCS swap 后访问 viral-reviewer-cache bucket (put/head/list/del); P5.2 阶段未用但提前 grant |

### 3.3 **Verify**

```bash
gcloud iam service-accounts list --project="$GCP_PROJECT_ID"
# 期看到两个: cloud-run-deployer / cloud-run-runtime

gcloud iam service-accounts get-iam-policy \
  "cloud-run-runtime@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --project="$GCP_PROJECT_ID"
# 期看到 bindings (member + role) for above 2 runtime roles
```

---

## Chapter 4 — Workload Identity Federation Pool + Provider + Binding

### 4.1 创建 WIF Pool

```bash
gcloud iam workload-identity-pools create github-pool \
  --location=global \
  --display-name="GitHub Actions OIDC Pool" \
  --project="$GCP_PROJECT_ID"
```

### 4.2 创建 OIDC Provider (限本 repo)

```bash
gcloud iam workload-identity-pools providers create-oidc github \
  --location=global \
  --workload-identity-pool=github-pool \
  --display-name="GitHub Actions OIDC Provider" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.actor=assertion.actor,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository == '${GH_REPO}'" \
  --project="$GCP_PROJECT_ID"
```

`attribute-condition` 限制**只有 `zhaoyixin0/viral-reviewer` repo 的 GHA run** 能换 token; 防其他 repo / fork 拿 token.

### 4.3 Bind deployer SA to WIF principalSet

```bash
gcloud iam service-accounts add-iam-policy-binding \
  "cloud-run-deployer@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/${GH_REPO}" \
  --project="$GCP_PROJECT_ID"
```

### 4.4 **Verify**

```bash
# 看 pool 存在
gcloud iam workload-identity-pools describe github-pool \
  --location=global --project="$GCP_PROJECT_ID"

# 看 provider 配置 (检查 attribute-condition 限了本 repo)
gcloud iam workload-identity-pools providers describe github \
  --location=global \
  --workload-identity-pool=github-pool \
  --project="$GCP_PROJECT_ID" \
  --format='value(attributeCondition)'
# 期输出: assertion.repository == 'zhaoyixin0/viral-reviewer'

# 看 deployer SA 的 IAM binding 含 workloadIdentityUser
gcloud iam service-accounts get-iam-policy \
  "cloud-run-deployer@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --project="$GCP_PROJECT_ID" \
  --format='value(bindings.members)' | grep workloadIdentityPools
# 期看到 principalSet://...github-pool/attribute.repository/zhaoyixin0/viral-reviewer
```

---

## Chapter 5 — Artifact Registry Repo

```bash
gcloud artifacts repositories create viral-reviewer \
  --repository-format=docker \
  --location="$GCP_REGION" \
  --description="viral-reviewer container images" \
  --project="$GCP_PROJECT_ID"
```

Repo 命名 `viral-reviewer` (D1 verdict); image 推到 `${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/viral-reviewer/web:<tag>` (path 含 `/web/` segment 留扩展空间未来加 `worker` / `cron` service).

### 5.5 **Verify**

```bash
gcloud artifacts repositories describe viral-reviewer \
  --location="$GCP_REGION" --project="$GCP_PROJECT_ID"
# 期: format: DOCKER, mode: STANDARD_REPOSITORY
```

---

## Chapter 6 — Push GitHub Actions Secrets

打开 GitHub repo Settings → Secrets and variables → Actions, 添加以下 4 个 **Repository secrets**:

| Secret name | Value |
|---|---|
| `GCP_PROJECT_ID` | `viral-reviewer-prod` (你 Chapter 1.1 起的 PROJECT_ID) |
| `GCP_PROJECT_NUMBER` | `gcloud projects describe $GCP_PROJECT_ID --format='value(projectNumber)'` 输出 |
| `WIF_PROVIDER` | `projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/providers/github` |
| `WIF_SERVICE_ACCOUNT` | `cloud-run-deployer@${GCP_PROJECT_ID}.iam.gserviceaccount.com` |

### 6.5 **Verify**

```bash
# 本机生成 expected values
echo "GCP_PROJECT_ID=$GCP_PROJECT_ID"
echo "GCP_PROJECT_NUMBER=$GCP_PROJECT_NUMBER"
echo "WIF_PROVIDER=projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/providers/github"
echo "WIF_SERVICE_ACCOUNT=cloud-run-deployer@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
# 把输出和 GH Settings → Secrets 里的 value 比对一致
```

GHA workflow (P5.2.4) 用 `google-github-actions/auth@v2` action 拿 WIF token 然后 `gcloud run services replace`. 见 `.github/workflows/deploy.yml`.

---

## Chapter 7 — Secret Manager (P5.6 phase, runbook 仅占位)

P5.6 scope (separate phase) 在 Secret Manager 创建以下 5 个 secrets, `service.yaml` 已 bind:

| Secret name | Source |
|---|---|
| `anthropic-api-key` | 当前 Vercel env `ANTHROPIC_API_KEY` |
| `openai-api-key` | 当前 Vercel env `OPENAI_API_KEY` |
| `google-api-key` | 当前 Vercel env `GOOGLE_API_KEY` |
| `apify-token` | 当前 Vercel env `APIFY_TOKEN` (memory: 2026-05-13 暴露, P5.6 借机 rotate) |
| `blob-read-write-token` | 当前 Vercel env `BLOB_READ_WRITE_TOKEN` (P5.1.b GCS swap 后退役) |
| `upload-signing-secret` | **新增** (per W3 mandate 78b7d2f patch 2). HMAC-SHA256 sign completion token for browser-direct-upload ping (W1 P5.1.b-2 design). Value: `openssl rand -hex 32` (32 bytes / 64 hex chars). 一次性生成, 不源自 Vercel env. |

**未在本 P5.2.6 runbook 跑** — 实际创建命令见 P5.6 scope. P5.2.6 仅文档化命名约定避免 `service.yaml` (本 PR P5.2.3) 与 P5.6 实际命名 drift.

### 7.1 Bootstrap upload-signing-secret (P5.6 phase)

```bash
# 生成 32 byte (256-bit) random hex secret
SECRET_VALUE=$(openssl rand -hex 32)

# 创建 Secret Manager secret with initial version
echo -n "${SECRET_VALUE}" | gcloud secrets create upload-signing-secret \
  --data-file=- \
  --replication-policy=automatic \
  --project="$GCP_PROJECT_ID"

# 验证创建成功
gcloud secrets versions access latest \
  --secret=upload-signing-secret \
  --project="$GCP_PROJECT_ID" | head -c 8
# 期: 输出 8 hex chars (secret 前 8 位)
```

**⚠️ Rotation policy**: 不能 hot-rotate (会让 in-flight HMAC token invalid). 必要时:
1. 创建新 version (`gcloud secrets versions add upload-signing-secret --data-file=- < /dev/stdin`)
2. service.yaml 保持 `key: "latest"` deploy (新 revision 启动自动拿新 version, 无需改 yaml)
3. 等所有 in-flight token TTL 过期 (15 min)
4. 删旧 version (`gcloud secrets versions destroy <old-version-num>`)

可选额外步骤: 若要审计每次 deploy 用了哪个 secret version, 改 `key:` 从 `"latest"` 改成具体 version 号; 但这增加 deploy + rotation 的耦合, 一般不必。

---

## Chapter 8 — First Deploy Verification (本 chapter 在 P5.2.4 deploy.yml ship 后跑)

GHA workflow `.github/workflows/deploy.yml` (P5.2.4 W2 owned, 本 runbook 之外) 接 push 到 main 触发. 首次 deploy 后 smoke test:

```bash
# 拿 service URL
SERVICE_URL=$(gcloud run services describe viral-reviewer-web \
  --region="$GCP_REGION" --project="$GCP_PROJECT_ID" \
  --format='value(status.url)')
echo "$SERVICE_URL"

# Smoke test /api/health (W2 P5.2.2 commit 9756301)
curl -sS "$SERVICE_URL/api/health"
# 期: {"ok":true,"version":"<short-sha>"}

# Smoke test /api/trending (主 GET 路由)
curl -sS "$SERVICE_URL/api/trending" -w "\nHTTP %{http_code} / first-byte %{time_starttransfer}s\n" -o /tmp/trending-response.json
# 期: HTTP 200, JSON 返回, first-byte < 5s
```

### 8.5 **Verify**

```bash
# 看 service revision 状态
gcloud run revisions list --service=viral-reviewer-web \
  --region="$GCP_REGION" --project="$GCP_PROJECT_ID"
# 期: 最新 revision Ready (TRUE), receiving 100% traffic

# 看 Cloud Logging
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=viral-reviewer-web" \
  --limit=20 --project="$GCP_PROJECT_ID"
# 期: 看到 startup log + /api/health probe 200 log
```

---

## Chapter 9 — GCS Bucket Setup (for P5.1.b browser-direct upload)

P5.1.b GCS swap (W1 owned phase, P5.2 完后启) 用 GCS bucket 取代 Vercel Blob。该 chapter 文档化 bucket create + **CORS 严格 origin 配置**（per W3 mandate 78b7d2f patch 1 + ECC HIGH-2 finding）。

### 9.1 创建 bucket

```bash
# bucket name 由 P5.1.b W1 scope 决定 (e.g. viral-reviewer-prod-blob)
export GCS_BUCKET_NAME="viral-reviewer-prod-blob"

gsutil mb -p "$GCP_PROJECT_ID" -l "$GCP_REGION" -b on \
  "gs://${GCS_BUCKET_NAME}"
# -b on = uniform bucket-level access (推荐, ACL granularity 已 deprecated)
```

### 9.2 配置 CORS — **严格 origin (CRITICAL security)**

**⚠️ 不要写 `*.vercel.app` 作 allowed origin** — 任何 Vercel 用户都可注册一个 `attacker.vercel.app` 进 CORS preflight，盗 signed upload URL → 越权写 bucket。**必须用项目名 prefix glob**。

`cors.json`:

```json
[
  {
    "origin": [
      "https://viral-reviewer.vercel.app",
      "https://viral-reviewer-*-zhaoyixin0.vercel.app"
    ],
    "method": ["POST", "PUT", "OPTIONS"],
    "responseHeader": [
      "Content-Type",
      "x-goog-acl",
      "x-goog-content-length-range",
      "x-goog-meta-*",
      "ETag",
      "Location"
    ],
    "maxAgeSeconds": 3600
  }
]
```

Apply:

```bash
gsutil cors set cors.json "gs://${GCS_BUCKET_NAME}"
```

### 9.3 Origin pattern 解释

- `https://viral-reviewer.vercel.app` — prod domain (W2 service 切流量后此 origin)
- `https://viral-reviewer-*-zhaoyixin0.vercel.app` — Vercel preview pattern (`<project>-<branch-hash>-<vercel-username>.vercel.app`)
- **不含** `*.vercel.app` (任意 Vercel 用户域名都会通过 = CORS bypass + signed URL theft)
- **不含** `https://*.run.app` (Cloud Run 也是 multi-tenant, 用户域 `<service>-<hash>-<region>.run.app` 可任意; P5.7 cutover 后用户域名替代时再 update CORS)

**⚠️ glob 边界注意 (security-reviewer 2026-05-16 LOW finding)**: 同账户 `zhaoyixin0` 下若另开 Vercel 项目命名以 `viral-reviewer-` 开头（如 `viral-reviewer-experiment`），其 preview URL `viral-reviewer-experiment-<hash>-zhaoyixin0.vercel.app` 同样命中本 glob pattern。如有此类项目, 评估其受信任度 (你的账户 = 你信任). Vercel username `zhaoyixin0` 全局唯一 (Vercel namespace flat, 与 GitHub 同机制), 攻击者不能 squat 该 username。

P5.7 DNS cutover 后 update cors.json origin 加 `https://<your-custom-domain>` 后重 apply。

### 9.4 **Verify**

```bash
gsutil cors get "gs://${GCS_BUCKET_NAME}"
# 期: 输出与 cors.json 一致 (2 origin, 2 method, responseHeader 列表)

# Negative test: 用 disallowed origin curl preflight 期 fail
curl -i -X OPTIONS \
  -H "Origin: https://attacker.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  "https://storage.googleapis.com/${GCS_BUCKET_NAME}/test.txt"
# 期: response 不含 Access-Control-Allow-Origin (CORS 拒绝)
```

### 9.5 Lifecycle (per P5.1 scope §2.3 G defer)

P5.1.b scope §2.3 G: "暂不设 lifecycle (P5.1 不做)"。Cleanup 走 cron (per W4 P5.2.5 `cloud-run-revisions-gc.yml` 同模式扩展未来 phase)。

---

## Chapter 10 — Cloud Scheduler OIDC Setup (P5.3 cron 主路径)

P5.3 用 Google Cloud Scheduler 替换 Vercel Cron。Cloud Scheduler → 自动签 OIDC ID token → POST `/api/cron/trending` with `Authorization: Bearer <token>` → server-side `OAuth2Client.verifyIdToken()` 校验。

### 10.1 创建专用 SA for Cloud Scheduler

```bash
gcloud iam service-accounts create cloud-scheduler \
  --display-name="Cloud Scheduler OIDC caller" \
  --project="$GCP_PROJECT_ID"
```

**最小权限**: Cloud Scheduler 调 Cloud Run service 需要 `roles/run.invoker` on the **specific service**:

```bash
gcloud run services add-iam-policy-binding viral-reviewer-web \
  --member="serviceAccount:cloud-scheduler@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT_ID"
```

(不要 grant project-wide `roles/run.invoker` — 限定到本 service 防 SA 被滥用调其他 service。)

### 10.2 创建 Cloud Scheduler job

```bash
# 取 Cloud Run service URL (与 service.yaml CRON_OIDC_AUDIENCE 一致)
SERVICE_URL=$(gcloud run services describe viral-reviewer-web \
  --region="$GCP_REGION" --project="$GCP_PROJECT_ID" \
  --format='value(status.url)')

# 每周一 08:00 UTC (与 vercel.ts 的 cron schedule 一致)
gcloud scheduler jobs create http trending-snapshot \
  --location="$GCP_REGION" \
  --project="$GCP_PROJECT_ID" \
  --schedule="0 8 * * 1" \
  --time-zone="UTC" \
  --uri="${SERVICE_URL}/api/cron/trending" \
  --http-method=POST \
  --oidc-service-account-email="cloud-scheduler@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --oidc-token-audience="${SERVICE_URL}/api/cron/trending" \
  --description="Weekly trending snapshot fetch (P5.3 replaces vercel.ts cron)"
```

**关键参数**:
- `--oidc-service-account-email` — Cloud Scheduler 用此 SA 签 token; **必须** match service.yaml `CRON_OIDC_SERVICE_ACCOUNT` env 值
- `--oidc-token-audience` — token 的 `aud` claim; **必须** match service.yaml `CRON_OIDC_AUDIENCE` env 值
- 任一不匹配 → server `verifyIdToken()` 抛 → fallback secret compare → 401 (fail-secure)

### 10.3 更新 service.yaml env vars (P5.7 cutover 后)

`service.yaml` 已 ship 含 2 个 placeholder env:

```yaml
- name: CRON_OIDC_AUDIENCE
  value: "https://viral-reviewer-web/api/cron/trending"
- name: CRON_OIDC_SERVICE_ACCOUNT
  value: "cloud-scheduler@PROJECT_ID.iam.gserviceaccount.com"
```

P5.7 DNS cutover 前 / first deploy 时:
- `CRON_OIDC_AUDIENCE` 改成真实 Cloud Run service URL (e.g. `https://viral-reviewer-web-abc-uc.a.run.app/api/cron/trending`)
- `CRON_OIDC_SERVICE_ACCOUNT` 改 `PROJECT_ID` 为真实 GCP project ID (deploy.yml 的 yq 替换会自动处理)

### 10.4 P5.7 cutover 期: 三认证并存 (fallback chain)

P5.3-P5.6 期间 `isAuthorized()` 三层 fallback:
1. **Google OIDC** (Cloud Scheduler 生产路径, P5.7 cutover 后)
2. **CRON_SECRET** (Vercel Cron 遗留, 转生产期保留, P5.7 cutover 完成后可退役)
3. **ADMIN_TRIGGER_SECRET** (手动降级, 始终保留)

任一通过即 200。OIDC 校验需 ~100ms (首次 JWKS fetch, 之后 cached)，secret compare 微秒级，不显著影响 cron 性能。

### 10.5 **Verify**

```bash
# 看 scheduler job 配置
gcloud scheduler jobs describe trending-snapshot \
  --location="$GCP_REGION" --project="$GCP_PROJECT_ID"
# 期: oidcToken.serviceAccountEmail + oidcToken.audience 与 service.yaml env 一致

# 手动触发一次 verify OIDC 路径 (不依赖 cron schedule 等)
gcloud scheduler jobs run trending-snapshot \
  --location="$GCP_REGION" --project="$GCP_PROJECT_ID"

# 看 Cloud Logging
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=viral-reviewer-web AND textPayload:trending" \
  --limit=10 --project="$GCP_PROJECT_ID"
# 期: 200 trending snapshot fetch log
```

### 10.6 Retire `CRON_SECRET` (P5.7 cutover 完成后)

P5.7 DNS cutover 完成 + Cloud Scheduler 1 周稳定后:
- Vercel project 设 `CRON_SECRET=""` (空值停用 Vercel cron auth)
- 或直接停 Vercel deploy (Vercel cron 会自然失效)
- `service.yaml` 仍可保留 `CRON_SECRET` env (其值不再生效, 但删 env 需重新 deploy 风险更高)
- `ADMIN_TRIGGER_SECRET` 永远保留 (`gcloud scheduler jobs run` 失败时人手 fallback)

---

## Appendix A — Troubleshooting

### A.1 GHA deploy fails with `Failed to get federated access token`

- 检查 Chapter 4.2 attribute-condition 字符串 (单引号外双引号内, 与 `$GH_REPO` 一致)
- 检查 Chapter 6 `WIF_PROVIDER` secret value 含完整 `projects/<NUMBER>/locations/global/...` 不能简写
- 检查 GHA workflow 文件含 `permissions: id-token: write` (P5.2.4 deploy.yml 含)

### A.2 Cloud Run service start fails with `Failed to start: container_started_failed`

- 看 `gcloud logging read` 找根因
- 常见: ffmpeg-static binary GLIBC missing (R1 风险, P5.2.1 Dockerfile R1 B3 fallback `apt-get install ffmpeg` 触发)
- 常见: secret binding 缺失 (Chapter 7 没创建对应 secret)
- 常见: port 8080 未 listen (Next.js standalone server bind 错)

### A.3 Probe fails: `/api/health` returns 404

- service.yaml startupProbe.httpGet.path 拼写
- W2 P5.2.2 commit `9756301` 必须在 image 内 (检查 Dockerfile COPY 没 exclude app/api/health/)
- `.dockerignore` (W4 P5.2.1) 检查没 exclude app/

### A.4 Image size 失控 (> 1GB)

- 检查 `.dockerignore` 排除 node_modules / data / .next/cache / tests / docs
- 检查 base image 用 `node:24-bookworm-slim` 而非 full `node:24`
- 检查 ffmpeg-static binary 只 COPY linux/x64 一份 (不带 darwin / win 平台)

### A.5 Cold start latency > 10s

- 检查 service.yaml `run.googleapis.com/startup-cpu-boost: "true"` 配置生效
- 检查 minScale ≥ 1 (避免 scale to 0 触发完整 cold start)
- 检查 Next.js standalone build 正确 (`next.config.ts output: standalone`)

---

## Appendix B — Rollback

### B.1 Service revision rollback (Cloud Run 内部, 快)

```bash
# 列最近 revisions
gcloud run revisions list --service=viral-reviewer-web \
  --region="$GCP_REGION" --project="$GCP_PROJECT_ID"

# 切流量到前一 revision (instant cutover)
gcloud run services update-traffic viral-reviewer-web \
  --region="$GCP_REGION" --project="$GCP_PROJECT_ID" \
  --to-revisions=<prev-revision-name>=100
```

### B.2 Git-level rollback (含 service.yaml + deploy.yml + Dockerfile 完整还原)

```bash
git revert <bad-deploy-commit-sha>
git push
# GHA 自动跑 deploy workflow → 用前一 immutable image SHA 替换 → service.yaml 自带回滚
```

### B.3 DNS-level rollback (P5.7 phase, 切回 Vercel)

P5 verdict J3 双层 rollback: DNS 切回 Vercel (前提 Vercel 部署不 sunset 至少 1 个月).
具体操作见 P5.7 scope (separate phase).

---

## Appendix C — Cleanup (彻底删除测试环境时用)

⚠️ **destructive**, 仅在 staging / 测试 project 跑.

```bash
# Cloud Run service
gcloud run services delete viral-reviewer-web --region="$GCP_REGION" --project="$GCP_PROJECT_ID"

# Artifact Registry repo (含所有 image)
gcloud artifacts repositories delete viral-reviewer --location="$GCP_REGION" --project="$GCP_PROJECT_ID"

# Secret Manager secrets (P5.6 创建的 + b-2 mandate upload-signing-secret)
for s in anthropic-api-key openai-api-key google-api-key apify-token blob-read-write-token upload-signing-secret; do
  gcloud secrets delete "$s" --project="$GCP_PROJECT_ID" --quiet
done

# WIF pool (含 provider + binding)
gcloud iam workload-identity-pools delete github-pool --location=global --project="$GCP_PROJECT_ID"

# SAs
gcloud iam service-accounts delete "cloud-run-deployer@${GCP_PROJECT_ID}.iam.gserviceaccount.com" --project="$GCP_PROJECT_ID" --quiet
gcloud iam service-accounts delete "cloud-run-runtime@${GCP_PROJECT_ID}.iam.gserviceaccount.com" --project="$GCP_PROJECT_ID" --quiet
```

---

## Appendix D — Build Architecture Notes (per W3 P5.2.1 verdict MED #2)

### D.1 Cloud Run runs **linux/amd64 only**

Cloud Run service runtime on GCP is `linux/amd64` (Intel/AMD x86_64). Cloud Run **does not** schedule containers on arm64 nodes. Building multi-arch images (`linux/amd64,linux/arm64`) wastes Artifact Registry storage with blobs Cloud Run will never pull.

Real cost from W4 P5.2.1 实测 (`d3fddf7`): single-arch image **202 MB** vs multi-arch manifest **843 MB** — `+640 MB` extra per push, accumulated weekly + per-PR preview.

### D.2 Build commands — explicit single-arch pin required

The Cloud Run deploy workflow (`.github/workflows/deploy.yml`, P5.2.4.1) uses traditional `docker build` (not `docker buildx`) with explicit `--platform linux/amd64` to defend against future `docker` / GHA runner default behavior changes:

```bash
docker build \
  --platform linux/amd64 \
  --tag "${IMAGE_URL}:${IMAGE_TAG}" \
  --tag "${IMAGE_URL}:latest" \
  --file Dockerfile \
  .
```

**For local Dockerfile testing**, same pin applies:

```bash
docker build --platform linux/amd64 -t viral-reviewer:local .
```

(On Windows / macOS with Docker Desktop, omitting `--platform` may default to host arch — `arm64` on Apple Silicon Macs — and produce an image that **won't run** on Cloud Run. Always pin.)

### D.3 Verify image arch before push

Inspect image manifest:

```bash
docker image inspect "${IMAGE_URL}:${IMAGE_TAG}" --format='{{.Architecture}}/{{.Os}}'
# Expected: amd64/linux
```

deploy.yml workflow includes this as a step that fails the build if the image is not single-arch `amd64/linux`. See `.github/workflows/deploy.yml` step "Verify image is single-arch (linux/amd64)".

### D.4 Why not `buildx` with explicit platform?

`docker buildx build --platform linux/amd64` produces the same single-arch result, **but**:
- `buildx` default behavior across versions has shifted toward multi-arch manifest creation
- Cloud Build / GHA runners may pre-configure `buildx` with multi-platform builders
- Adding `buildx` adds tooling complexity (need `qemu-user-static` for cross-arch build, even if we don't cross-build)

Traditional `docker build` on `linux/amd64` host = single arch by default + explicit `--platform` pin = double-defense at minimal complexity.

### D.5 If you must support arm64 in the future

If Cloud Run later supports arm64 (e.g., for cost savings on Graviton-class nodes), update:
1. `docker build --platform linux/amd64` → `docker buildx build --platform linux/amd64,linux/arm64` in `deploy.yml`
2. `service.yaml` `containers[0].image` annotation — Cloud Run picks correct arch from multi-arch manifest automatically
3. Verify arm64 image runs ffmpeg-static / ffprobe-static binaries (current `ffmpeg-static` package has Linux x64 binary; arm64 needs different package source)

**Not currently planned**. Cloud Run pricing is uniform across arch; arm64 only matters if Google introduces arm-discounted instance types.

---

## References

- Cloud Run service.yaml schema: <https://cloud.google.com/run/docs/reference/yaml/v1>
- WIF with GitHub Actions: <https://github.com/google-github-actions/auth?tab=readme-ov-file#preferred-direct-workload-identity-federation>
- `gcloud iam workload-identity-pools` docs: <https://cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools>
- `service.yaml` in this repo: `service.yaml` (P5.2.3 commit `a6d7d5c`)
- W3 P5.2 verdict: commit `f7d46bb` in `docs/coordination/window-2.md`
- W2 P5.2 scope draft: `docs/coordination/scopes/p5.2-dockerfile-cloud-build.md`

> **Verify each chapter's §X.5 step before moving to next chapter. Total time ~30-45 min if no errors.**
