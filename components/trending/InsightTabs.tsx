"use client";

import type { ReactNode } from "react";
import type { BoardInsightDTO } from "@/app/api/trending/route";

/**
 * 6-tab nav 容器 (L3+ plan §6.3)。
 *
 * - v1 老快照 / 无 insight (BoardInsightDTO === null) 降级:只渲 videos tab,
 *   隐藏 5 个 insight tab 入口 (plan §6.3 + W3 mailbox carryover #3)。
 * - 默认 activeTab 由父组件决定 (TrendingBoard:insight ? "hashtag" : "videos")
 * - C4 框架:5 个 insight tab body 是 placeholder,C5/C6 替换为真实 tab 组件。
 * - videos tab body 走 `videosSlot` (现有视频 grid + loading + empty state 透传)。
 */

export type TabKey =
  | "hashtag"
  | "technique"
  | "bgm"
  | "event"
  | "velocity"
  | "videos";

type TabDef = { key: TabKey; label: string };

/** 顺序即 nav 显示顺序;videos 放末位 (传统视图入口,新主入口是 hashtag)。 */
const TABS: readonly TabDef[] = [
  { key: "hashtag", label: "Hashtag 榜" },
  { key: "technique", label: "技法分布" },
  { key: "bgm", label: "BGM" },
  { key: "event", label: "热点事件" },
  { key: "velocity", label: "动量" },
  { key: "videos", label: "视频网格" },
] as const;

type Props = {
  insight: BoardInsightDTO | null;
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  /** videos tab 的内容 (现有视频 grid + loading + empty state 由父组件透传)。 */
  videosSlot: ReactNode;
};

export function InsightTabs({ insight, activeTab, onTabChange, videosSlot }: Props) {
  const isDegraded = insight === null;
  const visibleTabs = isDegraded ? TABS.filter((t) => t.key === "videos") : TABS;

  return (
    <div>
      {/* reviewer Nit1:用 div 不用 nav,避免 role="navigation"(<nav> 隐式) 与
          role="tablist" 双 role 冲突 */}
      <div
        role="tablist"
        aria-label="趋势数据视图切换"
        className="mb-6 flex flex-wrap gap-2 border-b border-white/10 pb-3"
      >
        {visibleTabs.map((t) => {
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={`insight-tabpanel-${t.key}`}
              id={`insight-tab-${t.key}`}
              onClick={() => onTabChange(t.key)}
              className={
                isActive
                  ? "rounded-full bg-white/[0.12] px-4 py-1.5 text-sm font-medium text-white"
                  : "rounded-full px-4 py-1.5 text-sm text-white/55 transition hover:bg-white/[0.06] hover:text-white/80"
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`insight-tabpanel-${activeTab}`}
        aria-labelledby={`insight-tab-${activeTab}`}
      >
        {renderTabBody(activeTab, insight, videosSlot)}
      </div>
    </div>
  );
}

function renderTabBody(
  activeTab: TabKey,
  insight: BoardInsightDTO | null,
  videosSlot: ReactNode,
): ReactNode {
  if (activeTab === "videos") return videosSlot;
  // insight === null 时父组件应已把 activeTab 锁在 "videos" (visibleTabs 只剩 videos)
  // 这条 guard 是 defensive:防 URL hash / 历史 state 注入异常 activeTab。
  // reviewer M2:return 空 <span /> 而非 null,保 tabpanel DOM 节点存在,
  // WAI-ARIA tabs 要求 aria-selected="true" 必须关联非空 tabpanel。
  if (insight === null) return <span />;
  // C5/C6 placeholder。C5 替换 hashtag / technique;C6 替换 bgm / event / velocity。
  return (
    <div className="glass-card p-8 text-center text-sm text-white/45">
      {tabPlaceholderLabel(activeTab)} 视图开发中
    </div>
  );
}

function tabPlaceholderLabel(activeTab: Exclude<TabKey, "videos">): string {
  const labels: Record<Exclude<TabKey, "videos">, string> = {
    hashtag: "Hashtag 榜",
    technique: "技法分布",
    bgm: "BGM",
    event: "热点事件",
    velocity: "动量",
  };
  return labels[activeTab];
}
