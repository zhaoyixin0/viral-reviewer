import "server-only";

/**
 * Structured logger for Cloud Run (P5.8.0).
 *
 * Outputs single-line JSON to stdout (Cloud Logging native parses `severity` +
 * `jsonPayload`). Replaces ad-hoc `console.warn / console.error` across the
 * codebase per W3 P5.8 verdict (a A1 factory + B1 WARN/ERROR + C1 (msg, ctx?)
 * + E1 single raw-JSON path).
 *
 * Caller usage:
 *   const log = createLogger({ module: "trending/fetch" });
 *   log.warn("TikTok Stage 2 failed", { handle, err: e });
 *   log.error("snapshot write retry exhausted", { week, err });
 *
 * The first arg is always a human-readable message; the optional second arg is
 * a plain context object whose keys are merged into the top-level JSON line.
 * `Error` values inside the context (any key, any depth via `cause`) are
 * structurally serialized — message / name / stack / recursive cause chain.
 *
 * Cloud Logging spec: https://cloud.google.com/run/docs/logging#run_manual_logging
 */

type Severity = "WARNING" | "ERROR";

type Context = Record<string, unknown>;

interface LoggerOptions {
  /**
   * Module identifier appearing in every line emitted by this instance.
   * Convention: short-path slug like `"trending/fetch"` or `"capcut-compiler/assets"`.
   */
  module: string;
}

export interface Logger {
  warn(message: string, context?: Context): void;
  error(message: string, context?: Context): void;
}

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError | string;
}

const MAX_CAUSE_DEPTH = 5;

/**
 * Recursively serialize an Error (and its `cause` chain) into a plain object
 * suitable for `JSON.stringify`. Stops at MAX_CAUSE_DEPTH to guard against
 * pathological circular `.cause` chains (per W3 P5.8 verdict nit 1).
 */
function serializeError(value: unknown, depth = 0): SerializedError | string {
  if (depth >= MAX_CAUSE_DEPTH) {
    return "[max cause depth exceeded]";
  }
  if (value instanceof Error) {
    const out: SerializedError = {
      name: value.name,
      message: value.message,
    };
    if (value.stack) out.stack = value.stack;
    if (value.cause !== undefined) {
      out.cause = serializeError(value.cause, depth + 1);
    }
    return out;
  }
  // Non-Error fallback: best-effort string.
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Walk the context shallowly and replace any top-level Error value with its
 * serialized form; coerce BigInt values to strings (JSON.stringify cannot
 * encode BigInt natively and would otherwise trigger the global fallback
 * envelope, losing all other context fields).
 *
 * Note: nested Errors inside container objects (e.g. `{ meta: { err } }`) are
 * NOT auto-serialized — only top-level keys are walked. Callers passing nested
 * Errors should pre-serialize them.
 */
function normalizeContext(context: Context): Context {
  const out: Context = {};
  for (const [key, val] of Object.entries(context)) {
    if (val instanceof Error) {
      out[key] = serializeError(val);
    } else if (typeof val === "bigint") {
      out[key] = val.toString();
    } else {
      out[key] = val;
    }
  }
  return out;
}

function emit(severity: Severity, module: string, message: string, context?: Context): void {
  const payload: Record<string, unknown> = {
    severity,
    timestamp: new Date().toISOString(),
    module,
    message,
    gitSha: process.env.GIT_SHA || "dev",
  };

  if (context) {
    const normalized = normalizeContext(context);
    for (const [key, val] of Object.entries(normalized)) {
      // Caller context keys do NOT overwrite reserved top-level fields.
      if (!(key in payload)) {
        payload[key] = val;
      }
    }
  }

  let line: string;
  try {
    line = JSON.stringify(payload);
  } catch {
    // Circular reference or other JSON.stringify failure — emit minimal envelope.
    line = JSON.stringify({
      severity,
      timestamp: payload.timestamp,
      module,
      message,
      gitSha: payload.gitSha,
      error: "serialization failed",
    });
  }

  // Cloud Run reads stdout for structured logs (stderr also works but stdout is
  // conventional and avoids splitting warn/error across two log streams).
  // eslint-disable-next-line no-console
  console.log(line);
}

/**
 * Create a logger instance bound to a module name. Caller's pattern:
 *
 *   const log = createLogger({ module: "trending/fetch" });
 *   log.warn("TikTok timed out", { handle, err });
 *   log.error("snapshot write failed", { week, err });
 */
export function createLogger(options: LoggerOptions): Logger {
  const { module } = options;
  return {
    warn(message, context) {
      emit("WARNING", module, message, context);
    },
    error(message, context) {
      emit("ERROR", module, message, context);
    },
  };
}

/**
 * @internal Test-only escape hatch — NOT part of the public API contract.
 * Do not import from application code (use `createLogger` instead).
 */
export const __internals = {
  serializeError,
  MAX_CAUSE_DEPTH,
};
