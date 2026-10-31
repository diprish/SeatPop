import type { NextConfig } from "next";

// Note: secrets live in the repo-root .env (git-ignored), which Next does
// not read by itself. API routes load it at request time via loadDotenv()
// from @seatpop/llm (see lib/recommend-server.ts) — no config-time env
// handling here, and no NEXT_PUBLIC_* variables anywhere.

const nextConfig: NextConfig = {
  transpilePackages: ["@seatpop/shared", "@seatpop/llm", "@seatpop/worker"],
};

export default nextConfig;
