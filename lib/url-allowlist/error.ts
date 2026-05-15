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
 */
export class UrlAllowlistError extends Error {
  readonly reason: UrlAllowlistDenyReason;
  readonly url: string;

  constructor(reason: UrlAllowlistDenyReason, url: string) {
    super(`URL denied by allowlist: reason=${reason}`);
    this.name = "UrlAllowlistError";
    this.reason = reason;
    this.url = url;
  }
}
