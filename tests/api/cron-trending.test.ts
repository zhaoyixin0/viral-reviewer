import { describe, expect, it, vi, beforeEach } from "vitest";

const fetchSnapshotMock = vi.fn();
const writeSnapshotMock = vi.fn();
const pruneMock = vi.fn();

vi.mock("@/lib/trending/fetch", () => ({
  fetchTrendingSnapshot: (...a: unknown[]) => fetchSnapshotMock(...a),
}));
vi.mock("@/lib/trending/snapshot-store", () => ({
  writeSnapshot: (...a: unknown[]) => writeSnapshotMock(...a),
  pruneOldSnapshots: (...a: unknown[]) => pruneMock(...a),
}));

// P5.3: mock google-auth-library OIDC verify
// hoisted const + class mock (per W2 phase 3.5 dns-mock.ts precedent)
const verifyIdTokenMock = vi.fn();
vi.mock("google-auth-library", () => ({
  OAuth2Client: class MockOAuth2Client {
    verifyIdToken(...a: unknown[]) {
      return verifyIdTokenMock(...a);
    }
  },
}));

import { POST } from "@/app/api/cron/trending/route";

function req(authHeader?: string): Request {
  return new Request("https://x/api/cron/trending", {
    method: "POST",
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

beforeEach(() => {
  fetchSnapshotMock.mockReset();
  writeSnapshotMock.mockReset();
  pruneMock.mockReset();
  verifyIdTokenMock.mockReset();
  process.env.ADMIN_TRIGGER_SECRET = "admin-secret";
  // P5.3 OIDC config (per service.yaml env binding when deployed)
  process.env.CRON_OIDC_AUDIENCE = "https://viral-reviewer-web/api/cron/trending";
  process.env.CRON_OIDC_SERVICE_ACCOUNT = "cloud-scheduler@PROJECT.iam.gserviceaccount.com";
  fetchSnapshotMock.mockResolvedValue({
    week: "2026-W20",
    trendingHashtags: [],
    videos: [],
    meta: { partial: false },
  });
});

describe("POST /api/cron/trending — ADMIN_TRIGGER_SECRET ops emergency auth", () => {
  it("returns 401 when no auth header is present", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(fetchSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong bearer token", async () => {
    // OIDC verify fails (invalid token) → fallback to secret compare → all fail
    verifyIdTokenMock.mockRejectedValue(new Error("invalid token"));
    const res = await POST(req("Bearer nope"));
    expect(res.status).toBe(401);
  });

  it("returns 401 for non-Bearer auth scheme", async () => {
    const res = await POST(req("Basic dXNlcjpwYXNz"));
    expect(res.status).toBe(401);
  });

  it("accepts ADMIN_TRIGGER_SECRET via Bearer header", async () => {
    // OIDC verify rejects (not an OIDC token) → fallback secret compare matches
    verifyIdTokenMock.mockRejectedValue(new Error("not a JWT"));
    const res = await POST(req("Bearer admin-secret"));
    expect(res.status).toBe(200);
    expect(writeSnapshotMock).toHaveBeenCalledTimes(1);
    expect(pruneMock).toHaveBeenCalledWith(8);
  });

  it("accepts the admin trigger secret (manual kick path)", async () => {
    verifyIdTokenMock.mockRejectedValue(new Error("not a JWT"));
    const res = await POST(req("Bearer admin-secret"));
    expect(res.status).toBe(200);
  });

  it("returns 502 and does not write when both platforms failed", async () => {
    verifyIdTokenMock.mockRejectedValue(new Error("not a JWT"));
    fetchSnapshotMock.mockRejectedValue(new Error("both platforms failed"));
    const res = await POST(req("Bearer admin-secret"));
    expect(res.status).toBe(502);
    expect(writeSnapshotMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/cron/trending — Google Cloud Scheduler OIDC (P5.3)", () => {
  it("accepts a valid OIDC token with matching email + email_verified", async () => {
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        email: "cloud-scheduler@PROJECT.iam.gserviceaccount.com",
        email_verified: true,
      }),
    });
    const res = await POST(req("Bearer fake-jwt"));
    expect(res.status).toBe(200);
    expect(verifyIdTokenMock).toHaveBeenCalledWith({
      idToken: "fake-jwt",
      audience: "https://viral-reviewer-web/api/cron/trending",
    });
    expect(writeSnapshotMock).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when OIDC token email does not match expected SA", async () => {
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        email: "attacker@evil.iam.gserviceaccount.com",
        email_verified: true,
      }),
    });
    const res = await POST(req("Bearer wrong-sa-jwt"));
    expect(res.status).toBe(401);
    expect(fetchSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns 401 when email_verified is false (defense against unverified SA tokens)", async () => {
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        email: "cloud-scheduler@PROJECT.iam.gserviceaccount.com",
        email_verified: false,
      }),
    });
    const res = await POST(req("Bearer unverified-jwt"));
    expect(res.status).toBe(401);
  });

  it("returns 401 when verifyIdToken throws (signature / exp / aud mismatch all fall here)", async () => {
    verifyIdTokenMock.mockRejectedValue(new Error("signature verification failed"));
    const res = await POST(req("Bearer tampered-jwt"));
    expect(res.status).toBe(401);
  });

  it("OIDC config missing → fail-secure (does not silently allow)", async () => {
    delete process.env.CRON_OIDC_AUDIENCE;
    delete process.env.CRON_OIDC_SERVICE_ACCOUNT;
    // OIDC short-circuits returning false; secret fallback still works for legacy
    const res = await POST(req("Bearer some-jwt-that-would-have-been-valid"));
    expect(res.status).toBe(401);
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it("returns 401 when verifyIdToken resolves but getPayload() returns null", async () => {
    // security-reviewer MED (cron-trending.test.ts:98): defense-in-depth test
    // for rare google-auth-library state where ticket resolves but payload empty
    verifyIdTokenMock.mockResolvedValue({ getPayload: () => null });
    const res = await POST(req("Bearer null-payload-jwt"));
    expect(res.status).toBe(401);
  });
});
