import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "web-push"],
  env: {
    NEXT_PUBLIC_BUILD_ID:
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.BUILD_ID ||
      "dev",
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  // Suppress noisy source map upload logs in CI
  silent: true,

  // Upload source maps for better stack traces
  widenClientFileUpload: true,

  // Tree-shake Sentry logger in production
  disableLogger: true,
});
