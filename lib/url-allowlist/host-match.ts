import type { HostPattern } from "./types";

/**
 * Host 比对 —— 三种 HostPattern 分派,case-insensitive（DNS hostname 不区分大小写）。
 *
 * - `string` → 小写精确比较
 * - `RegExp` → 直接 `.test(host)`（caller 决定锚定 / flags）
 * - `{ suffix: ".foo.com" }` → 允许根域 `"foo.com"` 和子域 `"a.foo.com"`
 *   （spec：`host === suffix.slice(1) || host.endsWith(suffix)`）
 *
 * 注：caller 应传带前导点的 suffix（`".foo.com"`），否则 `slice(1)`
 * 会切掉一个有意义字符。Zod schema 仅约束 suffix 非空,leading-dot
 * 约定靠 review 把关（不在 phase 1 强校验,避免锁死合法 use case）。
 */
export function matchHost(host: string, pattern: HostPattern): boolean {
  if (typeof pattern === "string") {
    return host.toLowerCase() === pattern.toLowerCase();
  }
  if (pattern instanceof RegExp) {
    return pattern.test(host);
  }
  const sfx = pattern.suffix.toLowerCase();
  const lowered = host.toLowerCase();
  return lowered === sfx.slice(1) || lowered.endsWith(sfx);
}
