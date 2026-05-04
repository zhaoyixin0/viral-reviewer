import "server-only";
import { put, head } from "@vercel/blob";
import type { AccountProfile, Platform } from "./types";

const CACHE_PREFIX = "account-profile";

function getIsoWeek(date = new Date()): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function userSlug(username: string): string {
  return encodeURIComponent(
    username.trim().toLowerCase().replace(/^@+/, "").slice(0, 60),
  );
}

export function buildAccountCacheKey(
  platform: Platform,
  username: string,
): string {
  return `${CACHE_PREFIX}/${platform}/${userSlug(username)}-${getIsoWeek()}.json`;
}

export async function readAccountProfileCache(
  platform: Platform,
  username: string,
): Promise<AccountProfile | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const key = buildAccountCacheKey(platform, username);
  try {
    const meta = await head(key);
    if (!meta?.url) return null;
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as AccountProfile;
  } catch {
    return null;
  }
}

export async function writeAccountProfileCache(
  profile: AccountProfile,
): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await put(profile.cacheKey, JSON.stringify(profile), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (e) {
    console.error(
      "[account-cache] write failed:",
      (e as Error).message,
    );
  }
}
