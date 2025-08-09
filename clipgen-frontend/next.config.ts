import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    eslint: {
        dirs: ["app"],
        ignoreDuringBuilds: true
    },
    typescript: {
        ignoreBuildErrors: true,
    }
};

export default nextConfig;
