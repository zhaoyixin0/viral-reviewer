import { createMemoryBackend } from "./memory-backend";
import { createUpstashBackend } from "./upstash-backend";
import type { RateLimitBackend } from "./types";
import { createLogger } from "@/lib/observability/structured-log";

const log = createLogger({ module: "rate-limit/backend" });

/**
 * Backend dispatch:env 齐 → Upstash;否则 in-memory + warn-once。
 *
 * warn 是 single-process state,测试隔离请用 vi.resetModules() + dynamic import。
 */

let memoryWarned = false;
let cachedBackend: RateLimitBackend | null = null;

export function getBackend(): RateLimitBackend {
  if (cachedBackend) return cachedBackend;

  if (hasUpstashEnv()) {
    cachedBackend = createUpstashBackend();
    return cachedBackend;
  }

  if (!memoryWarned) {
    log.warn(
      "in-memory backend; not safe for production. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to enable Upstash.",
    );
    memoryWarned = true;
  }
  cachedBackend = createMemoryBackend();
  return cachedBackend;
}

function hasUpstashEnv(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

/** 测试 hook —— production 不调用。重置内部缓存让 next getBackend() 重新 dispatch。 */
export function _resetBackendForTests(): void {
  cachedBackend = null;
  memoryWarned = false;
}
