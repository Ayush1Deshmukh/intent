import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["bcryptjs"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // Traced, self-contained server output. Vercel ignores this; the Docker image
  // needs it, and it is what lets the runtime stage skip node_modules entirely.
  output: "standalone",
};

export default nextConfig;
