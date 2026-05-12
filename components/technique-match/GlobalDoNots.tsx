"use client";

import { Ban } from "lucide-react";

type Props = { items: string[] };

export function GlobalDoNots({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <div className="glass-card p-6 border border-[#f43f5e]/20 bg-[#f43f5e]/5">
      <div className="flex items-center gap-2 mb-3">
        <Ban className="w-4 h-4 text-[#f43f5e]" />
        <h3 className="text-base font-semibold text-white">
          明确不要做
        </h3>
        <span className="text-xs text-white/45">
          (跨爆款共识，强警告)
        </span>
      </div>

      <ul className="space-y-2">
        {items.map((d, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-sm text-white/85 leading-relaxed"
          >
            <span className="text-[#f43f5e] shrink-0 mt-0.5">✗</span>
            <span>{d}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
