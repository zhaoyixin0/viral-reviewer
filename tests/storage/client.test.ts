import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Per W3 P5.1.b-1 verdict c9367c4:
 * - A1 frozen: lazy singleton.
 * - nit (defer): __resetStorageForTests must clear the underlying Storage
 *   instance, not just drop the bucket reference. Case #5 below proves this
 *   by counting Storage constructor invocations across a reset boundary.
 */

const mocks = vi.hoisted(() => {
  const StorageCtorMock = vi.fn();
  const bucketMock = vi.fn((name: string) => ({
    name,
    _isFakeBucket: true,
  }));
  return { StorageCtorMock, bucketMock };
});

vi.mock("@google-cloud/storage", () => {
  class Storage {
    constructor() {
      mocks.StorageCtorMock();
    }
    bucket(name: string) {
      return mocks.bucketMock(name);
    }
  }
  return { Storage };
});

import { __resetStorageForTests, getStorage } from "@/lib/storage";

beforeEach(() => {
  mocks.StorageCtorMock.mockClear();
  mocks.bucketMock.mockClear();
  __resetStorageForTests();
  delete process.env.GCS_BUCKET_NAME;
});

afterEach(() => {
  __resetStorageForTests();
  delete process.env.GCS_BUCKET_NAME;
});

describe("getStorage", () => {
  it("returns disabled when GCS_BUCKET_NAME is missing (no Storage construction)", () => {
    const c = getStorage();
    expect(c).toEqual({
      provider: "gcs",
      enabled: false,
      bucket: null,
      bucketName: "",
    });
    expect(mocks.StorageCtorMock).not.toHaveBeenCalled();
  });

  it("returns enabled + bucket handle when GCS_BUCKET_NAME is set", () => {
    process.env.GCS_BUCKET_NAME = "viral-reviewer-blob-dev";
    const c = getStorage();
    expect(c.provider).toBe("gcs");
    expect(c.enabled).toBe(true);
    expect(c.bucketName).toBe("viral-reviewer-blob-dev");
    expect(c.bucket).not.toBeNull();
    expect(mocks.bucketMock).toHaveBeenCalledWith("viral-reviewer-blob-dev");
    expect(mocks.StorageCtorMock).toHaveBeenCalledTimes(1);
  });

  it("caches the singleton across calls — Storage constructed exactly once", () => {
    process.env.GCS_BUCKET_NAME = "bkt";
    const a = getStorage();
    const b = getStorage();
    const c = getStorage();
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(mocks.StorageCtorMock).toHaveBeenCalledTimes(1);
    expect(mocks.bucketMock).toHaveBeenCalledTimes(1);
  });

  it("__resetStorageForTests clears the cache so next call re-resolves env", () => {
    process.env.GCS_BUCKET_NAME = "bkt-a";
    const first = getStorage();
    expect(first.bucketName).toBe("bkt-a");

    __resetStorageForTests();
    process.env.GCS_BUCKET_NAME = "bkt-b";
    const second = getStorage();
    expect(second.bucketName).toBe("bkt-b");
  });

  it("__resetStorageForTests clears the Storage instance — not just the bucket reference (W3 verdict c9367c4 nit)", () => {
    // First call: constructs Storage #1 and caches the full client envelope.
    process.env.GCS_BUCKET_NAME = "bkt-a";
    getStorage();
    expect(mocks.StorageCtorMock).toHaveBeenCalledTimes(1);

    // Reset → next call MUST construct a fresh Storage (proving the cache
    // holds the whole client envelope, not just the bucket reference that
    // could be re-derived from a stale Storage instance).
    __resetStorageForTests();
    process.env.GCS_BUCKET_NAME = "bkt-b";
    getStorage();
    expect(mocks.StorageCtorMock).toHaveBeenCalledTimes(2);
  });
});
