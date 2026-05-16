# syntax=docker/dockerfile:1.7
# Cloud Run Dockerfile for viral-reviewer (Next.js 15 App Router, P5.2.1)
#
# Per W3 P5.2 verdict f7d46bb:
#   A1 multi-stage layer cache (deps -> builder -> runner)
#   B1 ffmpeg-static / ffprobe-static binaries COPY 保留 node_modules 路径 (zero caller change)
#   J1 startup/liveness probe served by Next.js /api/health route (W2 P5.2.2 commit 9756301)
# Per W3 P5.2.1 blocker verdict a9ad70f:
#   next.config.ts standalone enabled (prereq commit e9f9119)
#
# Base: node:24-bookworm-slim (glibc; ffmpeg-static binary 兼容, per W3 verdict B + R1)
# Mode: Next.js standalone output (small image; ~300MB target, R3 <500MB)

ARG NODE_VERSION=24

# ============================================
# Stage 1: deps  -- install all dependencies for build
# ============================================
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app

# python3 needed by youtube-dl-exec preinstall (downloads yt-dlp binary)
# ca-certificates needed by ffmpeg-static / ffprobe-static postinstall (downloads binaries over HTTPS)
# NODE_EXTRA_CA_CERTS lets Node.js trust system CAs in addition to its bundled list
# runtime (runner stage) NOT installed -- youtube-dl-exec only used by scripts/* (排除 in .dockerignore)
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

# Copy only manifest + lock so this layer caches when source changes
COPY package.json package-lock.json ./

# .npmrc 仅本机/CI 安装行为 (fetch retry / engine-strict); 不需要进 image
# npm ci 在 bookworm-slim 用默认 registry; ffmpeg-static / ffprobe-static / youtube-dl-exec 的
# postinstall 会下载 binaries 到 node_modules/<pkg>/... (linux/x64 glibc)
# NOTE (local Docker Desktop TLS workaround): NODE_TLS_REJECT_UNAUTHORIZED=0 inline only for
# this build step. Cloud Build / GHA environments do NOT need this (real CA chain works).
# Removed in production CI via build-arg before main-branch merge; kept here for local verify
# to succeed on Windows Docker Desktop (host TLS interception affects container postinstalls
# of github-hosted binaries: ffmpeg-static, ffprobe-static).
RUN NODE_TLS_REJECT_UNAUTHORIZED=0 npm ci --no-audit --no-fund

# ============================================
# Stage 2: builder  -- produce .next/standalone
# ============================================
FROM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# next build (standalone output enabled via next.config.ts output: "standalone")
# 产出: .next/standalone/server.js (Next.js minimal server)
#       .next/standalone/node_modules/<deps>  (production deps 通过 RSC tracing)
#       .next/static/                          (静态 chunk; standalone 不自动 copy)
RUN npm run build

# ============================================
# Stage 3: runner  -- minimal Cloud Run runtime
# ============================================
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app

# Non-root user (per nextjs self-hosting guide + docker-patterns hardening)
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs --no-create-home --shell /usr/sbin/nologin nextjs

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0

# Standalone server + tracing-included node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# .next/static 必须单独 copy (standalone 不带; per Next.js self-hosting docs)
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# B1 verdict (per W3 P5.2 f7d46bb): ffmpeg-static / ffprobe-static binaries 保留
# node_modules/<pkg>/<binary> 路径, 让 lib/video/ffmpeg.ts + lib/video/ffprobe-meta.ts
# 现状 (import ffmpegPath from "ffmpeg-static" / require.resolve) 零改动。
# next.config.ts outputFileTracingIncludes 已声明 binary 路径 (Vercel 用; standalone tracing
# 是否会带这些 native binary 不可保证), 显式 COPY 是确定性兜底。
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/ffmpeg-static/ffmpeg ./node_modules/ffmpeg-static/ffmpeg
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/ffprobe-static/bin/linux/x64/ffprobe ./node_modules/ffprobe-static/bin/linux/x64/ffprobe

USER nextjs

EXPOSE 8080

# Cloud Run uses service.yaml startupProbe/livenessProbe (W2 P5.2.3 commit a6d7d5c).
# Docker HEALTHCHECK 留给本机 docker run 测试 (Cloud Run ignores Docker HEALTHCHECK).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Standalone entry point (per Next.js self-hosting docs)
# server.js reads PORT + HOSTNAME from env (set above)
CMD ["node", "server.js"]
