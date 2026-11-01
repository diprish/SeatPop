import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { voterHashFor } from "../src/lib/voter-hash";
import { VOTE_TAGS } from "../src/lib/votes";

describe("VOTE_TAGS", () => {
  it("is exactly the six fixed tags (no free text)", () => {
    expect([...VOTE_TAGS]).toEqual([
      "good for toddlers",
      "good for older kids",
      "crowded",
      "well run",
      "worth the drive",
      "not as described",
    ]);
  });

  it("matches the SQL vocabulary in migration 0021", () => {
    const migration = readFileSync(
      new URL(
        "../../../supabase/migrations/0021_series_votes.sql",
        import.meta.url,
      ),
      "utf8",
    );
    for (const tag of VOTE_TAGS) {
      expect(migration).toContain(`'${tag}'`);
    }
  });
});

describe("voterHashFor", () => {
  it("is a stable 64-char hex digest", () => {
    const hash = voterHashFor("device-1", "salt-1");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(voterHashFor("device-1", "salt-1")).toBe(hash);
  });

  it("depends on both the device id and the server salt", () => {
    const hash = voterHashFor("device-1", "salt-1");
    expect(voterHashFor("device-2", "salt-1")).not.toBe(hash);
    expect(voterHashFor("device-1", "salt-2")).not.toBe(hash);
  });
});

describe("votes route wiring", () => {
  const route = readFileSync(
    new URL("../src/app/api/votes/route.ts", import.meta.url),
    "utf8",
  );

  it("rate-limits vote writes per IP", () => {
    expect(route).toContain("routeLimiter()");
    expect(route).toContain("limiter.check(`votes:${clientIp(request)}`)");
    expect(route).toContain("daily request cap reached for this address");
  });

  it("derives the series server-side and never logs the device id", () => {
    expect(route).toContain("voteSeriesKey(event.title, venueName)");
    expect(route).toContain("rpc/create_vote");
    expect(route).toContain("rpc/series_votes_summary");
    expect(route).not.toContain("console.");
  });
});
