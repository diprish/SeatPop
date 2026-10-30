import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@seatpop/shared", "@seatpop/llm", "@seatpop/worker"],
};

export default nextConfig;
