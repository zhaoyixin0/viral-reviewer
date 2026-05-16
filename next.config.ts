import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.tiktokcdn.com" },
      { protocol: "https", hostname: "**.tiktokcdn-us.com" },
      { protocol: "https", hostname: "**.cdninstagram.com" },
      { protocol: "https", hostname: "**.fbcdn.net" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "picsum.photos" },
    ],
  },
  // P5.4: outputFileTracingIncludes 删除 — Vercel Lambda tracing 已退役;
  // Cloud Run Dockerfile multi-stage build 直接 COPY node_modules/ffmpeg-static/
  // ffmpeg + node_modules/ffprobe-static/bin/linux/x64/ffprobe 到 runner stage
  // (per W4 P5.2.1 Dockerfile + W3 P5.2.1 verdict B1: 保留 node_modules 路径
  // zero caller change for lib/video/ffmpeg.ts + lib/video/ffprobe-meta.ts).
  serverExternalPackages: [
    "ffmpeg-static",
    "ffprobe-static",
    "fluent-ffmpeg",
    "pdf-parse",
  ],
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;
