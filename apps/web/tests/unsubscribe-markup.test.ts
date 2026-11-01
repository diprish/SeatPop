import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Static pins for the one-click unsubscribe GET page. */

const route = readFileSync(
  new URL("../src/app/api/reminders/unsubscribe/route.ts", import.meta.url),
  "utf8",
);

describe("unsubscribe page", () => {
  it("is a GET that deletes through the token-checked RPC", () => {
    expect(route).toContain("export async function GET");
    expect(route).toContain("rpc/delete_reminder");
    expect(route).toContain("p_id");
    expect(route).toContain("p_delete_token");
  });

  it("validates the query and rate-limits", () => {
    expect(route).toContain("z.string().uuid()");
    expect(route).toContain("z.string().min(32).max(200)");
    expect(route).toContain("limiter.check");
  });

  it("renders plain HTML for every outcome, never raw JSON", () => {
    expect(route).toContain("text/html; charset=utf-8");
    expect(route).toContain("Link incomplete");
    expect(route).toContain("Reminder deleted");
    expect(route).toContain("Already gone");
    expect(route).not.toContain("NextResponse.json");
  });
});
