import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Viral Reviewer · AI 爆款评审官",
  description:
    "基于 TikTok / Instagram Reels 真实爆款数据，对你的视频做 6 维专业评审与按秒优化建议。",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
