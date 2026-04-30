"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "首页" },
  { href: "/review", label: "开始评审" },
  { href: "/library", label: "爆款库" },
  { href: "/template-review", label: "模板审核" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-[rgba(8,8,12,0.6)] border-b border-white/[0.06]">
      <div className="mx-auto max-w-7xl px-6 lg:px-10 h-16 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <span className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-[#8b5cf6] to-[#d946ef] shadow-[0_8px_24px_-8px_rgba(217,70,239,0.6)]">
            <Sparkles className="w-4 h-4 text-white" />
          </span>
          <span className="text-base">Viral Reviewer</span>
          <span className="ml-2 px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-full bg-white/[0.06] text-white/60 border border-white/10">
            Beta
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-2 text-sm text-white/70 hover:text-white transition-colors rounded-lg hover:bg-white/[0.06]"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Link href="/review" className="btn-primary text-sm py-2.5 px-5">
          开始评审
        </Link>
      </div>
    </header>
  );
}
