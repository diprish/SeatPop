import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Secrets live in the repo-root .env (git-ignored); Next only reads the
// app dir by default, so load the root file explicitly. Fill-unset: real
// environment variables still win. Resolved from this file's location so
// the caller's working directory cannot break it.
const repoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
loadEnvConfig(repoRoot);
// Value-free proof of what loaded (no secrets printed).
console.log(
  `[seatpop] supabase env: ${
    process.env["SUPABASE_URL"] && process.env["SUPABASE_ANON_KEY"]
      ? "ok"
      : "MISSING (restart dev after editing .env)"
  }`,
);

const nextConfig: NextConfig = {
  transpilePackages: ["@seatpop/shared", "@seatpop/llm", "@seatpop/worker"],
};

export default nextConfig;
