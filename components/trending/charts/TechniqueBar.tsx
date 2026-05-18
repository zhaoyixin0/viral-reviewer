/**
 * 横向 mini-bar:技法分布占比可视化 (L3+ plan §6 共享组件)。
 *
 * 给 HashtagTab.tsx (per-hashtag techniqueDistribution hover) +
 * TechniqueTab.tsx (全局 technique share) 复用。纯展示,无 state / 事件。
 *
 * 故意无 "use client" directive:Server/Client 双端共用 (App Router 允许 Client
 * 组件 import Server 组件,会自动 bundle 进 client)。未来若加 state/事件再补 directive。
 */

type Props = {
  /** technique → share (0..1)。share 总和不一定等于 1 (HashtagInsight 归一化但 callers 允许传 subset)。 */
  distribution: Record<string, number>;
  /** 最多展示前 N 项,按 share 降序。 */
  maxItems?: number;
  /** 颜色 token (Tailwind v4 oklch hex);默认 cyan-400 系。 */
  color?: string;
};

const DEFAULT_MAX_ITEMS = 5;
const DEFAULT_COLOR = "#22d3ee";

export function TechniqueBar({
  distribution,
  maxItems = DEFAULT_MAX_ITEMS,
  color = DEFAULT_COLOR,
}: Props) {
  const sorted = Object.entries(distribution)
    .sort(([, a], [, b]) => b - a)
    .slice(0, maxItems);

  if (sorted.length === 0) {
    return <p className="text-xs text-white/35">暂无技法分布数据</p>;
  }

  // 用 max value 作 bar 长度基准,让最高项填满,其他成比例
  const maxShare = sorted[0]?.[1] ?? 1;

  return (
    <ul className="space-y-1.5">
      {sorted.map(([technique, share]) => {
        const widthPct = maxShare > 0 ? (share / maxShare) * 100 : 0;
        const sharePct = (share * 100).toFixed(1);
        return (
          <li key={technique} className="flex items-center gap-2 text-xs">
            <span className="w-20 truncate text-white/70" title={technique}>
              {technique}
            </span>
            <span className="relative h-2 flex-1 overflow-hidden rounded bg-white/[0.05]">
              <span
                className="absolute inset-y-0 left-0 rounded"
                style={{ width: `${widthPct}%`, background: color }}
              />
            </span>
            <span className="w-10 text-right text-white/45">{sharePct}%</span>
          </li>
        );
      })}
    </ul>
  );
}
