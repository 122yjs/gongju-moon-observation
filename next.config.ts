import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // vinext currently applies the Server Action multipart limit before App
    // Router API handlers. Student observation photos are compressed to <=6MB,
    // while /api/observations independently rejects requests over 8MB.
    // Keep this framework-level guard aligned so valid photo uploads reach the API.
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
