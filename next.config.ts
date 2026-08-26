import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ["bcryptjs"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};
export default nextConfig;
