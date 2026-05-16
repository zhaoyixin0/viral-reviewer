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
  // Bundle ffmpeg/ffprobe Linux binaries into the analyze-video Lambda
  outputFileTracingIncludes: {
    "/api/analyze-video": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/ffprobe-static/bin/linux/x64/ffprobe",
    ],
  },
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
