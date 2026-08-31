import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["bcryptjs"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },

  // Traced, self-contained server output. Vercel ignores this; the Docker image
  // needs it, and it is what lets the runtime stage skip node_modules entirely.
  output: "standalone",

  /**
   * The demo tape loader reads `fixtures/*.csv` from disk at request time, by a path
   * built at runtime. Next's dependency tracing follows static imports, so it cannot
   * see that — the files were simply absent from the build.
   *
   * The Docker image hid this, because it copies `fixtures/` in explicitly. A
   * serverless deployment does not, so "Load the demo tape" would have returned a 500
   * on Vercel while working perfectly in every local and container test. Naming the
   * directory here is what makes the two deployment paths agree.
   */
  outputFileTracingIncludes: {
    "/tapes": ["./fixtures/**"],
    "/api/v1/tapes": ["./fixtures/**"],
  },
};

export default nextConfig;
