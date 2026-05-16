import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

const ORIGINAL_GIT_SHA = process.env.GIT_SHA;

afterEach(() => {
  if (ORIGINAL_GIT_SHA === undefined) {
    delete process.env.GIT_SHA;
  } else {
    process.env.GIT_SHA = ORIGINAL_GIT_SHA;
  }
});

describe("GET /api/health (Cloud Run startup + liveness probe)", () => {
  it("returns 200 + { ok: true, version: 'dev' } when GIT_SHA unset", async () => {
    delete process.env.GIT_SHA;
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ ok: true, version: "dev" });
  });

  it("returns the injected GIT_SHA in version field", async () => {
    process.env.GIT_SHA = "abc1234";
    const res = GET();
    const body = await res.json();
    expect(body.version).toBe("abc1234");
  });

  it("returns no-store header for probe correctness (per W3 verdict J1)", () => {
    const res = GET();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
