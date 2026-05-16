import { vi } from "vitest";

/**
 * Shared DNS mock helpers for url-allowlist caller tests (P3 #2 phase 3.5).
 *
 * **W3 verdict 5357c41 §D2 mandate**: caller test fixtures must mock
 * `node:dns/promises` (not bypass `safeResolveIp`)—helpers go through lib
 * logic so test coverage exercises `checkAsync` + `fetchWithAllowlist` chain.
 *
 * **Usage** (each test file that needs DNS mocking):
 *
 * ```typescript
 * import { vi } from "vitest";
 *
 * vi.mock("node:dns", async () => {
 *   const actual = await vi.importActual<typeof import("node:dns")>("node:dns");
 *   return {
 *     ...actual,
 *     promises: { resolve4: vi.fn(), resolve6: vi.fn() },
 *   };
 * });
 *
 * import { promises as dns } from "node:dns";
 * import {
 *   mockDnsResolve,
 *   mockDnsTimeout,
 *   mockDnsNxDomain,
 *   mockDnsRebinding,
 *   resetDnsMocks,
 * } from "@/tests/__stubs__/dns-mock";
 *
 * beforeEach(() => resetDnsMocks(dns));
 * ```
 */

type DnsMockable = {
  resolve4: ReturnType<typeof vi.fn>;
  resolve6: ReturnType<typeof vi.fn>;
};

/**
 * Accepts the `promises` namespace directly (caller usually
 * `import { promises as dns } from "node:dns"`, so `dns === promises`).
 * Typed as `unknown`-ish so callers can pass the real `dns.promises` shape
 * after vi.mock has replaced `resolve4` / `resolve6` with vi.fn() instances.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Resolver = any;

function asMockable(dnsLike: Resolver): DnsMockable {
  return {
    resolve4: dnsLike.resolve4 as unknown as ReturnType<typeof vi.fn>,
    resolve6: dnsLike.resolve6 as unknown as ReturnType<typeof vi.fn>,
  };
}

/**
 * Stage DNS resolution for `host` returning `addresses`. IPv4 addresses (no
 * `:`) go to `resolve4`; IPv6 (with `:`) go to `resolve6`. Empty side returns
 * `[]` so `safeResolveIp` gets one fulfilled + one empty (partial success).
 */
export function mockDnsResolve(
  dnsLike: Resolver,
  host: string,
  addresses: string[],
): void {
  const mock = asMockable(dnsLike);
  const v4 = addresses.filter((a) => !a.includes(":"));
  const v6 = addresses.filter((a) => a.includes(":"));
  mock.resolve4.mockImplementation((hostname: string) =>
    hostname === host ? Promise.resolve(v4) : Promise.resolve([]),
  );
  mock.resolve6.mockImplementation((hostname: string) =>
    hostname === host ? Promise.resolve(v6) : Promise.resolve([]),
  );
}

/**
 * Make DNS resolution hang forever for any host → triggers `safeResolveIp`
 * timeout (5s default) → `dns_resolve_failed` deny reason. Tests should
 * pass `timeoutMs` shortcut to `safeResolveIp` via the lib for fast tests.
 */
export function mockDnsTimeout(dnsLike: Resolver): void {
  const mock = asMockable(dnsLike);
  mock.resolve4.mockImplementation(() => new Promise(() => {}));
  mock.resolve6.mockImplementation(() => new Promise(() => {}));
}

/**
 * Reject with NXDOMAIN-style error code → `safeResolveIp` returns
 * `{ ok: false, cause: "A=NXDOMAIN;AAAA=NXDOMAIN" }` → caller surfaces
 * `dns_resolve_failed` deny reason.
 */
export function mockDnsNxDomain(dnsLike: Resolver): void {
  const mock = asMockable(dnsLike);
  const err = Object.assign(new Error("nxdomain"), { code: "NXDOMAIN" });
  mock.resolve4.mockRejectedValue(err);
  mock.resolve6.mockRejectedValue(err);
}

/**
 * Simulate DNS rebinding: first resolve returns `firstAddrs` (public),
 * second resolve returns `secondAddrs` (typically containing a private IP
 * like `127.0.0.1` / `169.254.169.254` / `fc00::1`).
 *
 * Affects `resolve4` if any `firstAddrs[0]` is IPv4 dotted-quad; else
 * `resolve6`. Both streams use call-count to advance.
 */
export function mockDnsRebinding(
  dnsLike: Resolver,
  host: string,
  firstAddrs: string[],
  secondAddrs: string[],
): void {
  const mock = asMockable(dnsLike);
  const v4First = firstAddrs.filter((a) => !a.includes(":"));
  const v6First = firstAddrs.filter((a) => a.includes(":"));
  const v4Second = secondAddrs.filter((a) => !a.includes(":"));
  const v6Second = secondAddrs.filter((a) => a.includes(":"));

  let call4 = 0;
  let call6 = 0;

  mock.resolve4.mockImplementation((hostname: string) => {
    if (hostname !== host) return Promise.resolve([]);
    call4 += 1;
    return Promise.resolve(call4 === 1 ? v4First : v4Second);
  });
  mock.resolve6.mockImplementation((hostname: string) => {
    if (hostname !== host) return Promise.resolve([]);
    call6 += 1;
    return Promise.resolve(call6 === 1 ? v6First : v6Second);
  });
}

/** Reset mock state between tests (call in `beforeEach`). */
export function resetDnsMocks(dnsLike: Resolver): void {
  const mock = asMockable(dnsLike);
  mock.resolve4.mockReset();
  mock.resolve6.mockReset();
}
