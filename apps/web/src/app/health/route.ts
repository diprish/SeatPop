import { NextResponse } from "next/server";
import { HealthResponseSchema } from "@seatpop/shared";

/** GET /health: status and build info. Never includes secrets. */
export async function GET(): Promise<NextResponse> {
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
  return NextResponse.json(HealthResponseSchema.parse(body));
}
