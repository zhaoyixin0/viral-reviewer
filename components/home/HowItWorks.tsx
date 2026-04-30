"use client";

import { motion } from "framer-motion";
import { ArrowDown } from "lucide-react";

const STEPS = [
  {
    n: "01",
    title: "你输入你的想法或上传草稿",
    desc: "文字描述题材 + 受众，或上传一段 30 秒以内的视频草稿。",
    color: "#8b5cf6",
  },
  {
    n: "02",
    title: "我们检索同题材的真实爆款",
    desc: "从 TikTok + Instagram Reels 实时数据库取 top-K，按播放量与互动率排序。",
    color: "#d946ef",
  },
  {
    n: "03",
    title: "提炼爆款公式",
    desc: "玩法分布、视觉风格、hook 模式、节奏点、BGM 风格 — 这是你的「该怎么做」。",
    color: "#fb7185",
  },
  {
    n: "04",
    title: "AI 严厉评审 + 按秒建议",
    desc: "6 维打分、按秒优化时间轴、四段式批评、拷问清单、可执行行动项。",
    color: "#22d3ee",
  },
];

export function HowItWorks() {
  return (
    <section className="relative py-24">
      <div className="mx-auto max-w-5xl px-6 lg:px-10">
        <div className="text-center mb-16">
          <p className="pill mb-4">工作流程</p>
          <h2 className="text-4xl md:text-5xl font-semibold tracking-tight text-gradient-primary">
            像 PM 一样给你的视频做评审
          </h2>
        </div>

        <div className="space-y-4">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              viewport={{ once: true, margin: "-50px" }}
            >
              <div className="glass-card p-7 flex items-start gap-6">
                <div
                  className="shrink-0 w-14 h-14 rounded-xl flex items-center justify-center text-lg font-bold"
                  style={{
                    background: `linear-gradient(135deg, ${s.color}, transparent)`,
                    border: `1px solid ${s.color}55`,
                  }}
                >
                  {s.n}
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">{s.title}</h3>
                  <p className="text-white/60 leading-relaxed">{s.desc}</p>
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div className="flex justify-center py-2">
                  <ArrowDown className="w-4 h-4 text-white/20" />
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
