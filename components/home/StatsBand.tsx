"use client";

import { motion } from "framer-motion";
import { SEED_VIDEOS, ALL_TOPICS } from "@/data/seed/viral-videos";

function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

export function StatsBand() {
  const totalViews = SEED_VIDEOS.reduce((s, v) => s + v.views, 0);
  const totalLikes = SEED_VIDEOS.reduce((s, v) => s + v.likes, 0);

  const stats = [
    { label: "实时爆款样本", value: SEED_VIDEOS.length.toString() },
    { label: "覆盖题材", value: ALL_TOPICS.length.toString() },
    { label: "累计播放量", value: formatNumber(totalViews) },
    { label: "累计点赞", value: formatNumber(totalLikes) },
  ];

  return (
    <section className="py-12">
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div className="glass-card p-10 grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              viewport={{ once: true }}
              className="text-center"
            >
              <div className="text-3xl md:text-4xl font-semibold text-gradient-accent">
                {s.value}
              </div>
              <div className="mt-2 text-xs uppercase tracking-wider text-white/50">
                {s.label}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
