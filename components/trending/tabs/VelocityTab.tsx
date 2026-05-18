"use client";

import { TrendingUp, TrendingDown, Minus, Sparkles, X } from "lucide-react";
import type { BoardInsightDTO } from "@/app/api/trending/route";

/**
 * Velocity tab (L3+ plan §6.2):三栏 WoW 动量 (技法 / BGM / 事件)。
 *
 * 数据源:BoardInsightDTO.velocityTab (projection 已浅拷贝 + 类型收窄
 * eventWoW trend = "new"|"stable"|"ended" 不含 rising/falling)。
 *
 * 无 prev snapshot 时 (首周 / 删除老快照):techniqueWoW = {}, bgmWoW 全 "new",
 * eventWoW 全 "new"。展示为"基线"而非空,信号给用户"等下周才有 WoW"。
 */

type Props = {
  velocity: BoardInsightDTO["velocityTab"];
};

type BgmTrend = BoardInsightDTO["velocityTab"]["bgmWoW"][number]["trend"];
type EventTrend = BoardInsightDTO["velocityTab"]["eventWoW"][number]["trend"];

const BGM_TREND_META: Record<BgmTrend, { label: string; color: string; Icon: typeof TrendingUp }> = {
  rising: { label: "上升", color: "#22d3ee", Icon: TrendingUp },
  falling: { label: "下降", color: "#f87171", Icon: TrendingDown },
  stable: { label: "稳定", color: "#94a3b8", Icon: Minus },
  new: { label: "新出现", color: "#a78bfa", Icon: Sparkles },
};

const EVENT_TREND_META: Record<EventTrend, { label: string; color: string; Icon: typeof TrendingUp }> = {
  new: { label: "新出现", color: "#a78bfa", Icon: Sparkles },
  stable: { label: "持续", color: "#94a3b8", Icon: Minus },
  ended: { label: "已结束", color: "#64748b", Icon: X },
};

export function VelocityTab({ velocity }: Props) {
  const techniqueEntries = Object.entries(velocity.techniqueWoW).sort(
    ([, a], [, b]) => Math.abs(b) - Math.abs(a),
  );
  const isBaseline =
    techniqueEntries.length === 0 &&
    velocity.bgmWoW.every((b) => b.trend === "new") &&
    velocity.eventWoW.every((e) => e.trend === "new");

  return (
    <div className="space-y-3">
      {isBaseline && (
        <div className="glass-card p-3 text-xs text-white/55">
          首周基线视图:无上周对比数据,下周一起将显示完整 WoW 动量。
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        <Section title="技法 WoW">
          {techniqueEntries.length === 0 ? (
            <Empty label="本周无技法变化" />
          ) : (
            <ul className="space-y-1.5">
              {techniqueEntries.map(([tech, delta]) => (
                <DeltaRow key={tech} name={tech} delta={delta} />
              ))}
            </ul>
          )}
        </Section>
        <Section title="BGM WoW">
          {velocity.bgmWoW.length === 0 ? (
            <Empty label="无 BGM 数据" />
          ) : (
            <ul className="space-y-1.5">
              {velocity.bgmWoW.map((b) => {
                const meta = BGM_TREND_META[b.trend];
                return (
                  <li
                    key={b.name}
                    className="flex items-center gap-2 rounded bg-white/[0.03] px-2 py-1.5 text-xs"
                  >
                    <span className="flex-1 truncate text-white/75" title={b.name}>
                      {b.name}
                    </span>
                    <span className="w-10 text-right text-[10px] text-white/45">
                      {formatDelta(b.deltaHits)}
                    </span>
                    <TrendBadge meta={meta} />
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
        <Section title="事件 WoW">
          {velocity.eventWoW.length === 0 ? (
            <Empty label="无事件数据" />
          ) : (
            <ul className="space-y-1.5">
              {velocity.eventWoW.map((e) => {
                const meta = EVENT_TREND_META[e.trend];
                return (
                  <li
                    key={e.name}
                    className="flex items-center gap-2 rounded bg-white/[0.03] px-2 py-1.5 text-xs"
                  >
                    <span className="flex-1 truncate text-white/75" title={e.name}>
                      {e.name}
                    </span>
                    <TrendBadge meta={meta} />
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-card p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/55">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-center text-xs text-white/35">{label}</p>;
}

function DeltaRow({ name, delta }: { name: string; delta: number }) {
  const isRising = delta > 0;
  const color = isRising ? "#22d3ee" : delta < 0 ? "#f87171" : "#94a3b8";
  const Icon = isRising ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  return (
    <li className="flex items-center gap-2 rounded bg-white/[0.03] px-2 py-1.5 text-xs">
      <span className="flex-1 truncate text-white/75" title={name}>
        {name}
      </span>
      <span className="w-12 text-right text-[10px]" style={{ color }}>
        {(delta * 100).toFixed(1)} pp
      </span>
      <Icon className="h-3 w-3" style={{ color }} />
    </li>
  );
}

function TrendBadge({
  meta,
}: {
  meta: { label: string; color: string; Icon: typeof TrendingUp };
}) {
  return (
    <span
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold"
      style={{ background: `${meta.color}26`, color: meta.color }}
    >
      <meta.Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function formatDelta(delta: number): string {
  if (delta === 0) return "0";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}`;
}
