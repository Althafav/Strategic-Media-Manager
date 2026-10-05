import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep visited (dynamic) pages in the browser's router cache for 3 min, so going back to a folder you
    // just opened is instant instead of a new server render. Actions that change page data must clear it
    // (revalidatePath / router.refresh).
    staleTimes: { dynamic: 180 },
  },
};

export default nextConfig;
