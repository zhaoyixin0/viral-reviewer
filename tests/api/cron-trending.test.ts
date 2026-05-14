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
  process.env.CRON_SECRET = "cron-secret";
  process.env.ADMIN_TRIGGER_SECRET = "admin-secret";
  fetchSnapshotMock.mockResolvedValue({
    week: "2026-W20",
    trendingHashtags: [],
    videos: [],
    meta: { partial: false },
  });
});

describe("POST /api/cron/trending", () => {
  it("returns 401 when no auth header is present", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(fetchSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong bearer token", async () => {
    const res = await POST(req("Bearer nope"));
    expect(res.status).toBe(401);
  });

  it("accepts the Vercel cron secret", async () => {
    const res = await POST(req("Bearer cron-secret"));
    expect(res.status).toBe(200);
    expect(writeSnapshotMock).toHaveBeenCalledTimes(1);
    expect(pruneMock).toHaveBeenCalledWith(8);
  });

  it("accepts the admin trigger secret (manual kick path)", async () => {
    const res = await POST(req("Bearer admin-secret"));
    expect(res.status).toBe(200);
  });

  it("returns 502 and does not write when both platforms failed", async () => {
    fetchSnapshotMock.mockRejectedValue(new Error("both platforms failed"));
    const res = await POST(req("Bearer cron-secret"));
    expect(res.status).toBe(502);
    expect(writeSnapshotMock).not.toHaveBeenCalled();
  });
});
