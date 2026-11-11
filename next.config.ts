import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep visited (dynamic) pages in the browser's router cache for 3 min, so going back to a folder you
    // just opened is instant instead of a new server render. Actions that change page data must clear it
    // (revalidatePath / router.refresh).
    staleTimes: { dynamic: 180 },
  },
  // Face models and their runtime (lib/face-detect.ts) sit in versioned folders, so guests on event wifi
  // download them once.
  async headers() {
    const forever = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
    return [
      { source: "/models/:path*", headers: forever },
      { source: "/ort-1.31.1/:path*", headers: forever },
    ];
  },
};

export default nextConfig;
