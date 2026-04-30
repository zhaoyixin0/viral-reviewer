"use client";

import { motion } from "framer-motion";
import {
  Zap,
  TrendingUp,
  Layers,
  ScrollText,
  Sparkles,
  Target,
} from "lucide-react";

const FEATURES = [
  {
    icon: TrendingUp,
    title: "实时爆款雷达",
    desc: "Apify 实时抓取 TikTok / Instagram Reels 趋势，按题材结构化入库。",
    accent: "from-[#8b5cf6] to-[#3b82f6]",
  },
  {
    icon: Target,
    title: "6 维专业评分",
    desc: "创新性、传播潜力、交互易用性、技术可行性、性能、合规风险。",
    accent: "from-[#d946ef] to-[#8b5cf6]",
  },
  {
    icon: Layers,
    title: "按秒时间轴建议",
    desc: "0-3s hook、3-8s 主体、彩蛋点位 — 每段镜头/转场/BGM 精确到秒。",
    accent: "from-[#fb7185] to-[#d946ef]",
  },
  {
    icon: ScrollText,
    title: "四段式批评清单",
    desc: "问题 → 影响 → 建议 → 对标，每条批评都附可执行改法。",
    accent: "from-[#22d3ee] to-[#3b82f6]",
  },
  {
    icon: Sparkles,
    title: "题材爆款公式",
    desc: "提炼同题材爆款的玩法分布、视觉风格、hook 模式与节奏。",
    accent: "from-[#fbbf24] to-[#fb7185]",
  },
  {
    icon: Zap,
    title: "视频草稿差距分析",
    desc: "上传草稿，AI 抽帧 + Whisper + Vision 给出与爆款公式的差距。",
    accent: "from-[#06b6d4] to-[#8b5cf6]",
  },
];

export function FeatureGrid() {
  return (
    <section className="relative py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div className="text-center mb-16">
          <p className="pill mb-4">
            <Sparkles className="w-3.5 h-3.5 text-[#d946ef]" />
            产品能力
          </p>
          <h2 className="text-4xl md:text-5xl font-semibold tracking-tight text-gradient-primary">
            从灵感到爆款的中间环节
          </h2>
          <p className="mt-4 text-white/60 max-w-2xl mx-auto">
            把内容创作的关键决策从"凭感觉"变成"看数据"
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.05 }}
              viewport={{ once: true, margin: "-50px" }}
              className="glass-card glass-card-hover p-7 group"
            >
              <div
                className={`inline-flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br ${f.accent} mb-5 shadow-[0_8px_30px_-8px_rgba(217,70,239,0.4)]`}
              >
                <f.icon className="w-5 h-5 text-white" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-white/60 leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
