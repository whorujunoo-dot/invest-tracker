import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
};

export default nextConfig;
