import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { fetchTrendingSnapshot } from "@/lib/trending/fetch";
import {
  writeSnapshot,
  pruneOldSnapshots,
} from "@/lib/trending/snapshot-store";
import { createLogger } from "@/lib/observability/structured-log";

const log = createLogger({ module: "api/cron/trending" });

export const runtime = "nodejs";

const KEEP_WEEKS = 8;

// P5.3: lazy singleton — google-auth-library 内部 cache JWKS, 每实例独立缓存,
// container 生命周期复用避免每请求重建 HTTP client + JWKS fetch round-trip。
let oauthClient: OAuth2Client | null = null;
function getOauthClient(): OAuth2Client {
  if (!oauthClient) oauthClient = new OAuth2Client();
  return oauthClient;
}

/**
 * P5.3 — Google Cloud Scheduler OIDC token verify。
 *
 * Cloud Scheduler 配 target URL + OIDC service account 后,自动签 ID token 走
 * `Authorization: Bearer <id-token>`。Server 用 Google JWKS 验签 + 验 claims:
 * - signature: Google JWKS (`https://www.googleapis.com/oauth2/v3/certs`)
 * - `aud` claim === CRON_OIDC_AUDIENCE (target URL, e.g. https://<service>/api/cron/trending)
 * - `iss` claim ∈ {"https://accounts.google.com", "accounts.google.com"} (verifyIdToken 自动校验)
 * - `exp` claim 未过期 (verifyIdToken 自动校验)
 * - `email` claim === CRON_OIDC_SERVICE_ACCOUNT (Cloud Scheduler 配的 SA)
 * - `email_verified` === true (Google managed SA 保证)
 *
 * 安全约束: 缺任一 env var 时 short-circuit return false (fail-secure;
 * 不能因 config missing 静默放行).
 */
async function verifyGoogleOidc(token: string): Promise<boolean> {
  const expectedAudience = process.env.CRON_OIDC_AUDIENCE;
  const expectedEmail = process.env.CRON_OIDC_SERVICE_ACCOUNT;
  if (!expectedAudience || !expectedEmail) {
    // security-reviewer LOW (route.ts:39): warn on missing OIDC env so 运维误删
    // env 不会静默 fallback Vercel Cron model (P5.7 cutover 后此 fallback 退役)
    log.warn(
      "OIDC env missing (CRON_OIDC_AUDIENCE or CRON_OIDC_SERVICE_ACCOUNT); OIDC auth disabled, falling back to legacy secrets",
    );
    return false;
  }
  try {
    const ticket = await getOauthClient().verifyIdToken({
      idToken: token,
      audience: expectedAudience,
    });
    const payload = ticket.getPayload();
    if (!payload) return false;
    if (payload.email !== expectedEmail) return false;
    if (payload.email_verified !== true) return false;
    return true;
  } catch {
    // 签名错 / token 过期 / aud 不匹配 / JWKS fetch fail 等所有失败路径 → fail-secure
    return false;
  }
}

/**
 * P5.3 三认证 (P5 verdict §2.6 R7 落地):
 * - **Google Cloud Scheduler OIDC** (主路径, P5.7 cutover 后)
 * - **CRON_SECRET** (Vercel Cron 遗留, P5.7 cutover 完成后可退役)
 * - **ADMIN_TRIGGER_SECRET** (手动降级路径, 始终保留)
 * 任一通过即可。
 *
 * 注: OIDC 校验涉及 JWKS HTTP fetch (cached), 首次 ~100ms; CRON_SECRET / ADMIN
 * 是 string compare 微秒级。优先 try OIDC 让 Cloud Scheduler 生产路径走真实校验,
 * fallback secret-compare 让本地 / Vercel 旧路径仍 work。
 */
async function isAuthorized(request: Request): Promise<boolean> {
  const auth = request.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  // security-reviewer LOW (route.ts:70): short-circuit empty token,
  // 避免无意义 verifyIdToken / secret-compare cycle
  if (!token) return false;

  // OIDC verify (生产 cron 主路径)
  if (await verifyGoogleOidc(token)) return true;

  // Legacy secret compare (Vercel Cron + manual admin).
  // security-reviewer LOW (route.ts:77,79): timingSafeEqual defense-in-depth
  // 防 string compare timing side-channel; P5.7 cutover 退役 CRON_SECRET 后
  // 整段可删,本期保留 fallback path.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && timingSafeStringEq(token, cronSecret)) return true;
  const adminSecret = process.env.ADMIN_TRIGGER_SECRET;
  if (adminSecret && timingSafeStringEq(token, adminSecret)) return true;

  return false;
}

/**
 * Constant-time string equality for secret comparison. Node crypto.timingSafeEqual
 * requires same-length buffers; we Buffer.from both sides + early-exit on length
 * mismatch (length itself is non-secret).
 */
function timingSafeStringEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

// P3 hardening #1：POST body 不消费任何字段（认证只走 Authorization Bearer header），
// 因此豁免 Zod body schema —— 没有可校验的 input surface。新增任何 body 字段消费
// 都必须先在此路由内补 Zod schema 校验。
export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let snapshot;
  try {
    snapshot = await fetchTrendingSnapshot();
  } catch (e) {
    // 两个平台都失败 → fetchTrendingSnapshot throw → 不写空快照
    log.error("fetch failed", { err: e });
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
