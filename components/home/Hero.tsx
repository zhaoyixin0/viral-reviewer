"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Sparkles, Play } from "lucide-react";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-20 pb-32">
      {/* Aurora blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/4 w-[600px] h-[600px] rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.4),transparent_70%)] blur-3xl" />
        <div className="absolute top-40 right-0 w-[500px] h-[500px] rounded-full bg-[radial-gradient(circle,rgba(217,70,239,0.3),transparent_70%)] blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-6 lg:px-10 text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex justify-center mb-6"
        >
          <span className="pill">
            <Sparkles className="w-3.5 h-3.5 text-[#d946ef]" />
            来自 TikTok 内部产品评审专家的真实经验
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.05 }}
          className="text-5xl md:text-7xl lg:text-8xl font-semibold tracking-tight leading-[1.05] text-gradient-primary"
        >
          让你的下一条视频
          <br />
          赢在脚本之前
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="mt-8 max-w-2xl mx-auto text-lg md:text-xl text-white/70 leading-relaxed"
        >
          基于 TikTok 与 Instagram Reels 的真实爆款数据，AI
          以严厉但建设性的产品 PM 视角，为你的视频想法或草稿
          做 6 维评分、按秒优化时间轴、四段式建议。
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.25 }}
          className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link href="/review" className="btn-primary">
            开始评审我的视频
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link href="/library" className="btn-secondary">
            <Play className="w-4 h-4" />
            浏览爆款库
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.35 }}
          className="mt-14 flex flex-wrap items-center justify-center gap-6 text-sm text-white/50"
        >
          <span className="flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#22d3ee]" />
            实时 Apify 抓取
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#d946ef]" />
            6 维评审 · 四段式建议
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#fb7185]" />
            按秒时间轴优化
          </span>
        </motion.div>
      </div>
    </section>
  );
}
