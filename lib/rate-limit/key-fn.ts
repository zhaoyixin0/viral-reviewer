/**
 * Rate-limit keyFn helper —— 从 Request 提取 client IP 作为限流桶 key。
 *
 * Vercel canonical IP 信任链(P3 #3 phase 2 W3 verdict §B):
 *   1. `x-real-ip` 优先:Vercel 注入 single value,客户端无法控,更难伪造
 *   2. fallback `x-forwarded-for` left-most:Vercel 把客户端 IP 写第一位,
 *      后续 hop 追加;left-most 是 Vercel canonical 客户端 IP
 *   3. fallback `"anon"`:dev / test / 无 IP 请求落到同一桶,行为可预测
 *      且不触发"无限流"漏洞
 *
 * 不用 `NextRequest.ip`:Next.js 15 nodejs runtime 在某些边界 case 不可靠,
 * 且 NextRequest 与原生 Request 互转破坏 `withRateLimit` 签名兼容。
 */
export function clientIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return "anon";
}
