import type { UrlAllowlistDenyReason } from "./types";

/**
 * Phase 2 wiring 抛错类型 —— lib 函数（`prepareAssets` / `extractFramesAndAudio`
 * 等）在入口 allowlist check 失败时抛 `UrlAllowlistError`，route handler 用
 * `instanceof` 判断后映射 400 `url_denied` + server `console.warn` 写完整
 * `url` + `reason`（W3 phase 2 verdict B2：response 不暴露 reason 详情防 SSRF
 * probe，server log 写完整方便看真实流量）。
 *
 * 命名 `UrlAllowlistError`（非 `SSRFError`/`DeniedUrlError`）跟 phase 1 lib
 * `createUrlAllowlist` / `UrlAllowlistOpts` 一致风格。
 *
 * **Phase 3 扩展 (commit 4/6 · 2026-05-15, W3 verdict 9154701 §F2 补充)**:
 * - `reason` union 通过 `UrlAllowlistDenyReason` 类型自动承接 phase 3 新加的
 *   `"dns_resolve_failed"` / `"resolved_private_ip"`,无需 error.ts 自身改
 * - 新增 `resolvedIp?: string` 可选字段：`resolved_private_ip` 时携带触发拒绝
 *   的 IP（方便 server log 看哪个 rebound IP）。其他 reason 不附（DNS 阶段未达
 *   或 IP literal sync 拒已写在 message 内）
 * - 新增 `cause?: string` 可选字段：`dns_resolve_failed` 时携带 cause 字符串
 *   （如 `"A=NXDOMAIN;AAAA=NXDOMAIN"`）方便 log 故障域
 *
 * **既有 caller 兼容性**：phase 2 callers 只读 `reason` / `url`,新字段 optional
 * 不破坏；4-arg constructor 兼容 2-arg 调用形式（resolvedIp / cause 默认 undefined）。
 */
export class UrlAllowlistError extends Error {
  readonly reason: UrlAllowlistDenyReason;
  readonly url: string;
  readonly resolvedIp?: string;
  readonly cause?: string;

  constructor(
    reason: UrlAllowlistDenyReason,
    url: string,
    extra?: { resolvedIp?: string; cause?: string },
  ) {
    super(`URL denied by allowlist: reason=${reason}`);
    this.name = "UrlAllowlistError";
    this.reason = reason;
    this.url = url;
    if (extra?.resolvedIp !== undefined) this.resolvedIp = extra.resolvedIp;
    if (extra?.cause !== undefined) this.cause = extra.cause;
  }
}
