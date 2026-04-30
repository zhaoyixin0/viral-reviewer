import { ApifyClient } from "apify-client";

let cached: ApifyClient | null = null;

export function getApifyClient(): ApifyClient {
  if (cached) return cached;
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error(
      "APIFY_TOKEN missing. Add it to .env.local before running scrapers.",
    );
  }
  cached = new ApifyClient({ token });
  return cached;
}
