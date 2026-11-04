import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as healthGET } from "../src/app/health/route";
import {
  GET as votesGET,
  POST as votesPOST,
} from "../src/app/api/votes/route";
import { VOTES_UNAVAILABLE_COPY } from "../src/lib/votes";

const EVENT_ID = "123e4567-e89b-12d3-a456-426614174000";
const TEST_SALT = "coop-test-salt-value-abc123";

const ENV_KEYS = ["VOTE_SALT", "SUPABASE_URL", "SUPABASE_ANON_KEY"] as const;
let savedEnv: Record<string, string | undefined>;
let realFetch: typeof fetch;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  realFetch = globalThis.fetch;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = realFetch;
});

function postRequest(body: unknown, ip: string): NextRequest {
  return new NextRequest("http://localhost/api/votes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

function validBody(): Record<string, unknown> {
  return {
    event_id: EVENT_ID,
    vote: 1,
    tags: [],
    device_id: "test-device-123",
  };
}

describe("POST /api/votes without configuration", () => {
  it("answers 503 votes_unavailable when VOTE_SALT is empty", async () => {
    process.env["VOTE_SALT"] = "";
    process.env["SUPABASE_URL"] = "http://supabase.test";
    process.env["SUPABASE_ANON_KEY"] = "anon";
    const response = await votesPOST(postRequest(validBody(), "10.0.0.1"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "votes_unavailable" });
  });

  it("answers 503 votes_unavailable when Supabase config is missing", async () => {
    process.env["VOTE_SALT"] = TEST_SALT;
    process.env["SUPABASE_URL"] = "";
    process.env["SUPABASE_ANON_KEY"] = "";
    const response = await votesPOST(postRequest(validBody(), "10.0.0.2"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "votes_unavailable" });
  });

  it("answers 503 votes_unavailable on GET when Supabase config is missing", async () => {
    process.env["SUPABASE_URL"] = "";
    process.env["SUPABASE_ANON_KEY"] = "";
    const response = await votesGET(
      new NextRequest(`http://localhost/api/votes?event_id=${EVENT_ID}`),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "votes_unavailable" });
  });
});

describe("POST /api/votes with configuration", () => {
  it("still returns {ok:true} with a mocked Supabase and leaks no salt or device id", async () => {
    process.env["VOTE_SALT"] = TEST_SALT;
    process.env["SUPABASE_URL"] = "http://supabase.test";
    process.env["SUPABASE_ANON_KEY"] = "anon";
    const seenBodies: string[] = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      if (typeof init?.body === "string") seenBodies.push(init.body);
      if (url.includes("public_events")) {
        return new Response(
          JSON.stringify([{ title: "Storytime", venue_id: null }]),
          { status: 200 },
        );
      }
      if (url.includes("rpc/create_vote")) {
        return new Response(JSON.stringify({ ok: true, id: "v1" }), {
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const response = await votesPOST(postRequest(validBody(), "10.0.0.3"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(seenBodies.length).toBeGreaterThan(0);
    for (const body of seenBodies) {
      expect(body).not.toContain(TEST_SALT);
      expect(body).not.toContain("test-device-123");
    }
  });

  it("keeps the 400 behavior for a bad body", async () => {
    process.env["VOTE_SALT"] = TEST_SALT;
    process.env["SUPABASE_URL"] = "http://supabase.test";
    process.env["SUPABASE_ANON_KEY"] = "anon";
    const response = await votesPOST(
      postRequest({ event_id: "not-a-uuid" }, "10.0.0.4"),
    );
    expect(response.status).toBe(400);
  });
});

describe("worth-it card copy", () => {
  const control = readFileSync(
    new URL("../src/components/worth-it.tsx", import.meta.url),
    "utf8",
  );
  const lib = readFileSync(
    new URL("../src/lib/votes.ts", import.meta.url),
    "utf8",
  );

  it("maps failures to the calm copy and never raw server strings", () => {
    expect(VOTES_UNAVAILABLE_COPY).toBe("Voting is temporarily unavailable.");
    expect(lib).toContain("Voting is temporarily unavailable.");
    expect(control).toContain("VOTES_UNAVAILABLE_COPY");
    expect(control).not.toContain("votes are not configured on this server");
    expect(control).not.toContain("error.message");
    expect(control).not.toContain("Couldn");
  });

  it("keeps the vote buttons enabled for retry (disabled only while busy)", () => {
    expect(control).toContain("disabled={busy}");
    expect(control).not.toContain("disabled={busy ||");
    expect(control).toContain("Retry");
  });
});

describe("GET /health votes signal", () => {
  it("reports votes false without config and true with it, never the salt", async () => {
    process.env["VOTE_SALT"] = "";
    process.env["SUPABASE_URL"] = "";
    process.env["SUPABASE_ANON_KEY"] = "";
    const missing = await healthGET();
    const missingBody = (await missing.json()) as { votes?: unknown };
    expect(missingBody.votes).toBe(false);

    process.env["VOTE_SALT"] = TEST_SALT;
    process.env["SUPABASE_URL"] = "http://supabase.test";
    process.env["SUPABASE_ANON_KEY"] = "anon";
    const present = await healthGET();
    const presentBody = (await present.json()) as Record<string, unknown>;
    expect(presentBody["status"]).toBe("ok");
    expect(presentBody["votes"]).toBe(true);
    expect(JSON.stringify(presentBody)).not.toContain(TEST_SALT);
  });
});
