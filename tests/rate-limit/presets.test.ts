import { describe, expect, it } from "vitest";
import {
  STRICT_PER_IP,
  GENEROUS_AUTHENTICATED,
  WRITE_HEAVY,
  ANON_AI_HEAVY,
  STREAM_HEAVY,
} from "@/lib/rate-limit";

/**
 * P3 #3 phase 2 commit 1: preset shape regression guard。
 *
 * Phase 2.5 经验:preset 数字 / algorithm / window 一旦漂移会引入静默回归
 * (与 url-allowlist preset 同模式)。锁住 5 个 preset 的完整 shape,
 * 任何无意修改触发 test fail。
 *
 * 数字依据见 presets.ts 注释。
 */
describe("rate-limit presets · shape regression guard", () => {
  it("STRICT_PER_IP: 10/1m sliding (anonymous GET baseline)", () => {
    expect(STRICT_PER_IP).toEqual({
      limit: 10,
      window: "1 m",
      algorithm: "sliding",
    });
  });

  it("GENEROUS_AUTHENTICATED: 100/1m sliding (logged-in users)", () => {
    expect(GENEROUS_AUTHENTICATED).toEqual({
      limit: 100,
      window: "1 m",
      algorithm: "sliding",
    });
  });

  it("WRITE_HEAVY: 5/10m fixed (write/scrape/ffmpeg ops)", () => {
    expect(WRITE_HEAVY).toEqual({
      limit: 5,
      window: "10 m",
      algorithm: "fixed",
    });
  });

  it("ANON_AI_HEAVY: 10/10m sliding (Claude analyze, P3 #3 phase 2 new)", () => {
    expect(ANON_AI_HEAVY).toEqual({
      limit: 10,
      window: "10 m",
      algorithm: "sliding",
    });
  });

  it("STREAM_HEAVY: 3/10m fixed (NDJSON stream + Apify, P3 #3 phase 2 new)", () => {
    expect(STREAM_HEAVY).toEqual({
      limit: 3,
      window: "10 m",
      algorithm: "fixed",
    });
  });
});
