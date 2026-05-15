import { describe, expect, it } from "vitest";
import {
  createUrlAllowlist,
  VERCEL_BLOB_PRESET,
  TIKTOK_INSTAGRAM_CDN_PRESET,
} from "@/lib/url-allowlist";

/**
 * P3 #2 phase 2.5：`TIKTOK_INSTAGRAM_CDN_PRESET` 接受 5 个 host suffix 的真实
 * sample URL（cover image 形态 ≈ video CDN 形态，同 platform 同 CDN host）。
 *
 * 5 host 来源：next.config.ts:6-9 + pre-commit sample-verify (2026-05-15)
 * `data/scraped/enriched-2026-04-29.json` host 分布。
 */
describe("TIKTOK_INSTAGRAM_CDN_PRESET · 5 social CDN host suffix coverage", () => {
  const allowlist = createUrlAllowlist(TIKTOK_INSTAGRAM_CDN_PRESET);

  it("accepts *.tiktokcdn.com sample (TT global main CDN)", () => {
    const r = allowlist.check(
      "https://p16-sign-sg.tiktokcdn.com/tos-alisg-p-0037/abc.mp4",
    );
    expect(r.ok).toBe(true);
  });

  it("accepts *.tiktokcdn-us.com sample (TT US region CDN)", () => {
    const r = allowlist.check(
      "https://p16-common-sign.tiktokcdn-us.com/tos-useast5-p-0068-tx/def.mp4",
    );
    expect(r.ok).toBe(true);
  });

  it("accepts *.tiktokcdn-eu.com sample (TT EU region CDN, sample-verify discovered)", () => {
    // 这条是 pre-commit sample-verify 发现 W3 verdict 4-host 未覆盖的关键 case
    // —— 若 preset 漏这个 suffix，所有 EU TT 创作者请求 host_denied 静默失败
    const r = allowlist.check(
      "https://p16-common-sign.tiktokcdn-eu.com/tos-useast8-p-0068-tx2/ghi.mp4",
    );
    expect(r.ok).toBe(true);
  });

  it("accepts *.cdninstagram.com sample (IG static media CDN)", () => {
    const r = allowlist.check(
      "https://scontent-arn2-1.cdninstagram.com/v/t51.82787-15/jkl.mp4",
    );
    expect(r.ok).toBe(true);
  });

  it("accepts *.fbcdn.net sample (IG video CDN per next.config.ts)", () => {
    // sample 数据未覆盖但 next.config.ts:9 已用，保留兜底防 IG 视频走 fbcdn
    const r = allowlist.check("https://video.xx.fbcdn.net/v/t39.mp4");
    expect(r.ok).toBe(true);
  });

  it("rejects evil.com with host_denied", () => {
    const r = allowlist.check("https://evil.com/x.mp4");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("host_denied");
  });

  it("rejects http:// scheme on valid TT host with scheme_denied", () => {
    const r = allowlist.check(
      "http://p16-sign-sg.tiktokcdn.com/tos-alisg-p-0037/abc.mp4",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("scheme_denied");
  });

  it("rejects private IP host with private_ip", () => {
    const r = allowlist.check("https://127.0.0.1/foo.mp4");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("private_ip");
  });
});

/**
 * Reverse case：确认两个 preset 互斥不重叠——VERCEL_BLOB_PRESET 拒社交 CDN URL,
 * TIKTOK_INSTAGRAM_CDN_PRESET 拒 vercel-storage URL。phase 2 hidden regression
 * 根因就是 caller 选错 preset；测试守住"选错 preset = host_denied"不变量。
 */
describe("Cross-preset isolation · phase 2 regression guard", () => {
  it("VERCEL_BLOB_PRESET rejects TikTok CDN URL (phase 2 regression root cause)", () => {
    // 这个 case **精确复现** phase 2 → 2.5 之间的 hidden regression：
    // account-profile/route.ts 误用 VERCEL_BLOB_PRESET → top1.videoDownloadUrl
    // 在 tiktokcdn-us.com 必中 host_denied。phase 2.5 切换 preset 后此 case 仍
    // 应 host_denied（preset 隔离），但实际 caller 改了 preset 不会触发。
    const allowlist = createUrlAllowlist(VERCEL_BLOB_PRESET);
    const r = allowlist.check(
      "https://p16-common-sign.tiktokcdn-us.com/tos-useast5-p-0068-tx/x.mp4",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("host_denied");
  });

  it("TIKTOK_INSTAGRAM_CDN_PRESET rejects vercel-storage URL (symmetric guard)", () => {
    const allowlist = createUrlAllowlist(TIKTOK_INSTAGRAM_CDN_PRESET);
    const r = allowlist.check(
      "https://abc.public.blob.vercel-storage.com/x.mp4",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("host_denied");
  });
});
