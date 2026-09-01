import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only packages with optional native/peer deps stay out of the webpack bundle.
  serverExternalPackages: ["bullmq", "ioredis", "postgres", "pdf-parse", "mammoth", "jszip"],
  experimental: {
    serverActions: { bodySizeLimit: "30mb" },
  },
};

export default nextConfig;
