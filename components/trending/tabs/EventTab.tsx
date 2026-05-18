"use client";

import { CalendarDays } from "lucide-react";
import type { BoardInsightDTO } from "@/app/api/trending/route";

/**
 * Event tab (L3+ plan §6.2):本周活跃热点事件卡片,带关联 hashtag chip 列表 +
 * matchedVideoCount 计数 (R4 filter ≥3 已在 aggregate.ts:212 完成,projection 透传)。
 *
 * 数据源:BoardInsightDTO.eventTab (projection 已剥 sampleVideoIds 内部字段)。
 */

type Props = {
  events: BoardInsightDTO["eventTab"];
};

export function EventTab({ events }: Props) {
  if (events.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-sm text-white/40">
        本周暂无热点事件命中 (≥3 视频匹配)
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((e) => (
        <div key={e.name} className="glass-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-[#a78bfa]" />
            <h3 className="text-sm font-semibold text-white/85">{e.displayName}</h3>
            <span className="ml-auto text-xs text-white/45">
              {e.matchedVideoCount} 个视频命中
            </span>
          </div>
          {e.matchedHashtags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {e.matchedHashtags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/65"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
