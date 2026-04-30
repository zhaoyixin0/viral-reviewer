import type { ViralFormula, ViralVideo } from "./types";

function distribute(items: string[]) {
  const counts = items.reduce(
    (acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }),
    {} as Record<string, number>,
  );
  const total = items.length || 1;
  return Object.entries(counts)
    .map(([name, n]) => ({ name, weight: Math.round((n / total) * 100) / 100 }))
    .sort((a, b) => b.weight - a.weight);
}

export function extractCommonalities(
  videos: ViralVideo[],
  topic: string,
): ViralFormula {
  const playStyles = distribute(videos.map((v) => v.playStyle));
  const visualStyles = distribute(videos.map((v) => v.visualStyle));

  const hooks = videos.map((v) => v.hook);
  const dominantHook = hooks[0] ?? "0-2s 强对比 + 字幕悬念";

  const durations = videos.map((v) => v.duration);
  const avgDuration =
    durations.length > 0
      ? `${Math.min(...durations)}-${Math.max(...durations)}s`
      : "15-30s";

  const bgmHints = videos.map((v) => v.bgm);
  const dominantBgm = bgmHints[0] ?? "中速 80-100 BPM";

  return {
    topic,
    playStyles: playStyles.slice(0, 4),
    visualStyles: visualStyles.slice(0, 3),
    hookPattern: dominantHook,
    avgDuration,
    bgmStyle: dominantBgm,
  };
}
