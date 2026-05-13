import "server-only";
import { readFile } from "fs/promises";
import { join } from "path";
import type { TechniqueIndex } from "./types";

const INDEX_PATH = "data/technique-index.json";
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: TechniqueIndex | null = null;
let cacheTime = 0;

export async function loadTechniqueIndex(): Promise<TechniqueIndex | null> {
  if (cache && Date.now() - cacheTime < CACHE_TTL_MS) return cache;
  try {
    const raw = await readFile(join(process.cwd(), INDEX_PATH), "utf-8");
    cache = JSON.parse(raw) as TechniqueIndex;
    cacheTime = Date.now();
    return cache;
  } catch {
    return null;
  }
}

export function clearTechniqueIndexCache() {
  cache = null;
  cacheTime = 0;
}
