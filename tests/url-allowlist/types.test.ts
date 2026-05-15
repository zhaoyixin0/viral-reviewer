import { describe, expect, it } from "vitest";
import { UrlAllowlistOptsSchema } from "@/lib/url-allowlist/types";

/**
 * Phase 1 nit cleanup (2026-05-15): hostPatternSchema 的 `{ suffix }` 分支
 * 必须强制前导点。补 schema-level runtime guard 测试。
 *
 * 既有 createUrlAllowlist 的 zod-throw 集中在 index.test.ts;本文件专测
 * schema parse 行为（safeParse 不抛,返回 { success: false }）。
 */

describe("UrlAllowlistOptsSchema — { suffix } leading dot enforcement", () => {
  it("rejects { suffix } missing leading dot (suffix without '.' is ambiguous)", () => {
    const result = UrlAllowlistOptsSchema.safeParse({
      allowedHosts: [{ suffix: "tiktokcdn.com" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // message 应人话化提示 leading-dot 要求,不是默认 "Invalid input"
      const flat = result.error.issues.map((i) => i.message).join(" | ");
      expect(flat.toLowerCase()).toContain("leading");
    }
  });

  it("accepts { suffix } with leading dot", () => {
    const result = UrlAllowlistOptsSchema.safeParse({
      allowedHosts: [{ suffix: ".tiktokcdn.com" }],
    });
    expect(result.success).toBe(true);
  });
});

describe("UrlAllowlistOptsSchema — pre-existing guards still hold (regression)", () => {
  it("rejects empty allowedHosts array", () => {
    const result = UrlAllowlistOptsSchema.safeParse({ allowedHosts: [] });
    expect(result.success).toBe(false);
  });

  it("rejects empty string in allowedHosts", () => {
    const result = UrlAllowlistOptsSchema.safeParse({ allowedHosts: [""] });
    expect(result.success).toBe(false);
  });

  it("rejects empty suffix object", () => {
    const result = UrlAllowlistOptsSchema.safeParse({
      allowedHosts: [{ suffix: "" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts string and RegExp host patterns (leading-dot rule only applies to { suffix })", () => {
    const result = UrlAllowlistOptsSchema.safeParse({
      allowedHosts: ["example.com", /^api\.example\.com$/],
    });
    expect(result.success).toBe(true);
  });
});
