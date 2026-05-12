"use client";

import { Activity, CheckCircle2, AlertTriangle } from "lucide-react";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";

type Props = { potential: MaterialPotential };

function DensityBar({ label, value }: { label: string; value: number }) {
  const color =
    value >= 70 ? "#22d3ee" : value >= 40 ? "#d946ef" : "#fb7185";
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-white/70">{label}</span>
        <span className="text-xs font-semibold" style={{ color }}>
          {value}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${value}%`,
            background: `linear-gradient(90deg, ${color}, ${color}aa)`,
          }}
        />
      </div>
    </div>
  );
}

export function UserDiagnosis({ potential }: Props) {
  const { detectedFormat, detectedFormatConfidence, base, adaptabilitySummary } =
    potential;
  const d = base.density;

  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-[#22d3ee]" />
        <h3 className="text-base font-semibold">你的素材分析</h3>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <div className="text-xs text-white/45 mb-1">视频形态</div>
            <div className="text-sm">
              <span className="font-semibold text-white">{detectedFormat}</span>
              <span className="ml-2 text-xs text-white/45">
                conf {detectedFormatConfidence}
              </span>
            </div>
          </div>

          <div>
            <div className="text-xs text-white/45 mb-2">技法密度</div>
            <div className="space-y-2.5">
              <DensityBar label="剪辑节奏" value={d.editing} />
              <DensityBar label="转场" value={d.transition} />
              <DensityBar label="特效" value={d.effect} />
              <DensityBar label="BGM 同步" value={d.bgmSync} />
              <DensityBar label="综合" value={d.overall} />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-[#22d3ee] mb-2">
              <CheckCircle2 className="w-3.5 h-3.5" />
              素材优势
            </div>
            <ul className="text-xs text-white/75 space-y-1.5 leading-relaxed">
              {adaptabilitySummary.strengths.map((s, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-[#22d3ee] shrink-0">•</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-xs text-[#f59e0b] mb-2">
              <AlertTriangle className="w-3.5 h-3.5" />
              素材局限
            </div>
            <ul className="text-xs text-white/75 space-y-1.5 leading-relaxed">
              {adaptabilitySummary.limitations.map((s, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-[#f59e0b] shrink-0">•</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
