import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createLogger, __internals } from "@/lib/observability/structured-log";

/**
 * 8 specific test cases per W3 P5.8 verdict nit 4.
 */
describe("structured-log", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  function lastLine(): Record<string, unknown> {
    const calls = stdoutSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const line = calls[calls.length - 1][0] as string;
    return JSON.parse(line);
  }

  // Case 1: logger.warn -> JSON with severity WARNING
  it("logger.warn emits JSON with severity WARNING", () => {
    const log = createLogger({ module: "test/case1" });
    log.warn("hello");
    const payload = lastLine();
    expect(payload.severity).toBe("WARNING");
    expect(payload.message).toBe("hello");
    expect(payload.module).toBe("test/case1");
  });

  // Case 2: logger.error -> JSON with severity ERROR
  it("logger.error emits JSON with severity ERROR", () => {
    const log = createLogger({ module: "test/case2" });
    log.error("boom");
    const payload = lastLine();
    expect(payload.severity).toBe("ERROR");
    expect(payload.message).toBe("boom");
  });

  // Case 3: context merge — module (factory) + caller op both appear
  it("context merge — module from factory + caller-passed keys both appear", () => {
    const log = createLogger({ module: "trending/fetch" });
    log.warn("scrape failed", { op: "tiktokStage2", handle: "foo" });
    const payload = lastLine();
    expect(payload.module).toBe("trending/fetch");
    expect(payload.op).toBe("tiktokStage2");
    expect(payload.handle).toBe("foo");
  });

  // Case 4: Error auto-serialize — message + stack + name
  it("Error value in context auto-serializes to {name, message, stack}", () => {
    const log = createLogger({ module: "test/case4" });
    const err = new TypeError("type oops");
    log.error("op failed", { err });
    const payload = lastLine();
    const serialized = payload.err as Record<string, unknown>;
    expect(serialized.name).toBe("TypeError");
    expect(serialized.message).toBe("type oops");
    expect(typeof serialized.stack).toBe("string");
    expect((serialized.stack as string).length).toBeGreaterThan(0);
  });

  // Case 5: Error cause chain depth 3 (per nit 1)
  it("Error.cause chain is recursively serialized (depth 3)", () => {
    const log = createLogger({ module: "test/case5" });
    const root = new Error("root cause");
    const mid = new Error("middle layer", { cause: root });
    const top = new Error("top failure", { cause: mid });
    log.error("nested failure", { err: top });
    const payload = lastLine();
    const e0 = payload.err as { message: string; cause?: { message: string; cause?: { message: string } } };
    expect(e0.message).toBe("top failure");
    expect(e0.cause?.message).toBe("middle layer");
    expect(e0.cause?.cause?.message).toBe("root cause");
  });

  // Case 6: timestamp ISO 8601 format
  it("emits timestamp in ISO 8601 format", () => {
    const log = createLogger({ module: "test/case6" });
    log.warn("hi");
    const payload = lastLine();
    const ts = payload.timestamp as string;
    // ISO 8601 UTC: YYYY-MM-DDTHH:MM:SS.sssZ
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // Round-trippable
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  // Case 7: GIT_SHA from process.env (with fallback to "dev")
  it("injects GIT_SHA from process.env with 'dev' fallback when unset", () => {
    const log = createLogger({ module: "test/case7" });
    const original = process.env.GIT_SHA;
    try {
      delete process.env.GIT_SHA;
      log.warn("no sha");
      expect(lastLine().gitSha).toBe("dev");

      process.env.GIT_SHA = "abc1234";
      log.warn("with sha");
      expect(lastLine().gitSha).toBe("abc1234");
    } finally {
      if (original === undefined) {
        delete process.env.GIT_SHA;
      } else {
        process.env.GIT_SHA = original;
      }
    }
  });

  // Case 8: JSON.stringify failure (circular ref) -> fallback envelope
  it("JSON.stringify failure (circular ref) falls back to {severity, message, error: 'serialization failed'}", () => {
    const log = createLogger({ module: "test/case8" });
    // Build a circular plain object that survives normalizeContext (NOT an Error).
    const a: Record<string, unknown> = { name: "a" };
    const b: Record<string, unknown> = { name: "b", ref: a };
    a.ref = b;
    log.error("circular boom", { payload: a });
    const payload = lastLine();
    expect(payload.severity).toBe("ERROR");
    expect(payload.message).toBe("circular boom");
    expect(payload.error).toBe("serialization failed");
    // module + gitSha + timestamp still present in fallback envelope
    expect(payload.module).toBe("test/case8");
    expect(typeof payload.timestamp).toBe("string");
  });

  // Reviewer MED #2 fix: BigInt context values are coerced to strings instead of
  // triggering the global JSON.stringify fallback envelope (which would lose
  // every other context field).
  it("BigInt context values are coerced to strings (not triggering fallback)", () => {
    const log = createLogger({ module: "test/bigint" });
    log.warn("with bigint", { count: BigInt(42), other: "kept" });
    const payload = lastLine();
    expect(payload.count).toBe("42");
    expect(payload.other).toBe("kept"); // sibling fields preserved
    expect(payload.error).toBeUndefined(); // NOT in fallback envelope
  });

  // Bonus invariant: max cause depth guard (nit 1 robustness)
  it("serializeError stops at MAX_CAUSE_DEPTH to avoid pathological chains", () => {
    const { serializeError, MAX_CAUSE_DEPTH } = __internals;
    let chain: Error = new Error("leaf");
    for (let i = 0; i < MAX_CAUSE_DEPTH + 3; i++) {
      chain = new Error(`layer ${i}`, { cause: chain });
    }
    const serialized = serializeError(chain) as { cause?: unknown };
    // Walk down `cause` MAX_CAUSE_DEPTH times — final cause should be the
    // depth-exceeded sentinel string, not another nested Error object.
    let node: unknown = serialized;
    for (let i = 0; i < MAX_CAUSE_DEPTH; i++) {
      node = (node as { cause?: unknown }).cause;
    }
    expect(node).toBe("[max cause depth exceeded]");
  });
});
