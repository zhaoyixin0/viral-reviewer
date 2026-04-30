"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function CTASection() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-5xl px-6 lg:px-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          className="relative overflow-hidden glass-card p-12 md:p-16 text-center"
        >
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.3),transparent_70%)] blur-3xl" />
          </div>

          <h2 className="text-4xl md:text-5xl font-semibold tracking-tight text-gradient-primary">
            把你的下一个视频想法
            <br />
            交给 AI 评审官
          </h2>
          <p className="mt-6 text-white/60 max-w-xl mx-auto">
            从灵感到爆款，缩短一万次错误尝试。
          </p>
          <div className="mt-10">
            <Link href="/review" className="btn-primary text-base py-4 px-7">
              立即开始
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
