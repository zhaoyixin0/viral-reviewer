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

**未在本 P5.2.6 runbook 跑** — 实际创建命令见 P5.6 scope. P5.2.6 仅文档化命名约定避免 `service.yaml` (本 PR P5.2.3) 与 P5.6 实际命名 drift.

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

# Secret Manager secrets (P5.6 创建的)
for s in anthropic-api-key openai-api-key google-api-key apify-token blob-read-write-token; do
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
