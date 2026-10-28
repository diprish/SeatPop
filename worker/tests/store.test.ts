import { describe, expect, it } from "vitest";
import {
  findEventsByDedupeKeys,
  findEventsByRawHashes,
  insertEvent,
  linkEventSource,
  recordSourceRun,
  type StoreConfig,
} from "../src/ingest/store";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function mockFetch(
  handler: (call: Captured) => unknown,
): { fetchImpl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: unknown, init?: Record<string, unknown>) => {
    const call: Captured = {
      url: String(url),
      method: String(init?.["method"] ?? "GET"),
      headers: { ...((init?.["headers"] as Record<string, string>) ?? {}) },
      body: init?.["body"] as string | undefined,
    };
    calls.push(call);
    return new Response(JSON.stringify(handler(call)), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const CONFIG: StoreConfig = {
  url: "https://test.supabase.co",
  serviceKey: "test-service-key",
};

describe("store", () => {
  it("looks up raw hashes within one source", async () => {
    const { fetchImpl, calls } = mockFetch(() => [
      { id: "e1", raw_hash: "h1", dedupe_key: "k1" },
    ]);
    const found = await findEventsByRawHashes(
      { ...CONFIG, fetchImpl },
      "s1",
      ["h1", "h2"],
    );
    expect(calls[0].url).toContain("/rest/v1/events?");
    expect(calls[0].url).toContain("source_id=eq.s1");
    expect(calls[0].url).toContain("raw_hash=in.(h1,h2)");
    expect(found.get("h1")?.id).toBe("e1");
    expect(found.has("h2")).toBe(false);
  });

  it("looks up dedupe keys across sources", async () => {
    const { fetchImpl, calls } = mockFetch(() => [
      { id: "e9", raw_hash: "hx", dedupe_key: "k9" },
    ]);
    const found = await findEventsByDedupeKeys(
      { ...CONFIG, fetchImpl },
      ["k9"],
    );
    expect(calls[0].url).toContain("dedupe_key=in.(k9)");
    expect(found.get("k9")?.id).toBe("e9");
  });

  it("inserts events with the service role key", async () => {
    const { fetchImpl, calls } = mockFetch(() => [{ id: "new-id" }]);
    const row = await insertEvent(
      { ...CONFIG, fetchImpl },
      {
        source_id: "s1",
        source_url: "https://example.test/e",
        title: "T",
        starts_at: "2026-11-01T00:00:00.000Z",
        timezone: "America/Toronto",
        raw_text: "raw",
        raw_hash: "h",
        dedupe_key: "k",
        status: "scheduled",
      },
    );
    expect(row.id).toBe("new-id");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["Authorization"]).toBe("Bearer test-service-key");
    expect(calls[0].headers["apikey"]).toBe("test-service-key");
    expect(calls[0].headers["Prefer"]).toContain("return=representation");
    expect(JSON.parse(calls[0].body ?? "{}").title).toBe("T");
  });

  it("links listings idempotently", async () => {
    const { fetchImpl, calls } = mockFetch(() => []);
    await linkEventSource(
      { ...CONFIG, fetchImpl },
      "e1",
      "s2",
      "https://example.test/e",
    );
    expect(calls[0].url).toContain("on_conflict=event_id,source_id");
    expect(calls[0].headers["Prefer"]).toContain("ignore-duplicates");
  });

  it("resolves return=minimal calls on an empty 204 body", async () => {
    const empty: typeof fetch = (async () =>
      new Response(null, { status: 204 })) as unknown as typeof fetch;
    await expect(
      linkEventSource(
        { ...CONFIG, fetchImpl: empty },
        "e1",
        "s2",
        "https://example.test/e",
      ),
    ).resolves.toBeUndefined();
    await expect(
      recordSourceRun({ ...CONFIG, fetchImpl: empty }, "s1", {
        lastStatus: "ok",
        robotsOk: true,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects representation calls with an empty body", async () => {
    const empty: typeof fetch = (async () =>
      new Response(null, { status: 200 })) as unknown as typeof fetch;
    await expect(
      insertEvent(
        { ...CONFIG, fetchImpl: empty },
        {
          source_id: "s1",
          source_url: "https://example.test/e",
          title: "T",
          starts_at: "2026-11-01T00:00:00.000Z",
          timezone: "America/Toronto",
          raw_text: "raw",
          raw_hash: "h",
          dedupe_key: "k",
          status: "scheduled",
        },
      ),
    ).rejects.toThrow("returned an empty body");
  });
});
