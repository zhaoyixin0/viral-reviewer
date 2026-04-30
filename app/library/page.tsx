import { readdir, stat } from "fs/promises";
import { join } from "path";
import { Header } from "@/components/ui/Header";
import { Footer } from "@/components/ui/Footer";
import { LibraryClient } from "@/components/library/LibraryClient";
import { loadVideos } from "@/lib/data/load-videos";

async function detectSource(): Promise<"enriched" | "raw" | "seed"> {
  try {
    const dir = join(process.cwd(), "data", "scraped");
    const files = await readdir(dir);
    if (files.some((f) => f.startsWith("enriched-") && f.endsWith(".json"))) {
      return "enriched";
    }
    for (const f of files) {
      if (
        (f.startsWith("tiktok-") || f.startsWith("instagram-")) &&
        f.endsWith(".json")
      ) {
        const s = await stat(join(dir, f));
        if (s.size > 100) return "raw";
      }
    }
  } catch {
    /* fall through */
  }
  return "seed";
}

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const [videos, source] = await Promise.all([loadVideos(), detectSource()]);
  const topics = Array.from(new Set(videos.map((v) => v.topic))).sort();

  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-6 lg:px-10 py-12">
        <LibraryClient videos={videos} topics={topics} source={source} />
      </main>
      <Footer />
    </>
  );
}
