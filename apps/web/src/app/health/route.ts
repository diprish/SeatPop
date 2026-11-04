import { NextResponse } from "next/server";
import { HealthResponseSchema } from "@seatpop/shared";
import { publicSupabase } from "../../lib/recommend-server";

/** GET /health: status and build info. Never includes secrets. */
export async function GET(): Promise<NextResponse> {
  // Deploy check for voting: boolean only, never values.
  // publicSupabase() first: it fills unset vars from the repo-root .env,
  // so the salt read below must come after it.
  const supabase = publicSupabase();
  const votes =
    (process.env["VOTE_SALT"]?.trim() ?? "") !== "" && supabase !== null;
  const body = {
    status: "ok",
    service: "seatpop-web",
    version: "0.0.0",
    commit:
      process.env["VERCEL_GIT_COMMIT_SHA"] ??
      process.env["GIT_COMMIT"] ??
      "dev",
    node: process.version,
    time: new Date().toISOString(),
  };
  return NextResponse.json({ ...HealthResponseSchema.parse(body), votes });
}
