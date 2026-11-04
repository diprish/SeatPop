import { NextResponse } from "next/server";
import { HealthResponseSchema } from "@seatpop/shared";
import { publicSupabase } from "../../lib/recommend-server";

/** GET /health: status and build info. Never includes secrets. */
export async function GET(): Promise<NextResponse> {
  // Deploy check for voting: boolean only, never values.
  const votes =
    (process.env["VOTE_SALT"]?.trim() ?? "") !== "" &&
    publicSupabase() !== null;
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
