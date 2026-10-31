import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecommendItemView } from "../src/lib/api";
import {
  NOT_FOR_US_REASONS,
  deleteFeedback,
  fetchSavedIds,
  hideEvent,
  isSaved,
  loadHidden,
  loadSaved,
  postFeedback,
  toggleSaved,
  unhideEvent,
} from "../src/lib/feedback";

const ITEM = {
  event_id: "e1",
  title: "Storytime",
} as RecommendItemView;

describe("saved transitions", () => {
  it("toggles, queries, and tolerates a missing DOM", () => {
    expect(loadSaved()).toEqual([]);
    const saved = toggleSaved([], ITEM);
    expect(saved).toHaveLength(1);
    expect(isSaved(saved, "e1")).toBe(true);
    expect(isSaved(saved, "e2")).toBe(false);
    expect(toggleSaved(saved, ITEM)).toEqual([]);
  });
});

describe("hidden transitions", () => {
  it("hides with a reason and unhides", () => {
    expect(loadHidden()).toEqual({});
    const hidden = hideEvent({}, "e1", "Too far");
    expect(hidden).toEqual({ e1: "Too far" });
    expect(unhideEvent(hidden, "e1")).toEqual({});
    expect(NOT_FOR_US_REASONS).toContain("Too far");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("feedback api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts verdicts with the JWT and reason", async () => {
    const calls: { url: unknown; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      (async (url: unknown, init?: RequestInit) => {
        calls.push({ url, init });
        return jsonResponse({ ok: true });
      }) as typeof fetch,
    );
    await postFeedback("jwt-1", "e1", "not_for_us", "Too far");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/feedback");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(
      (calls[0]?.init?.headers as Record<string, string>)["Authorization"],
    ).toBe("Bearer jwt-1");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      event_id: "e1",
      value: "not_for_us",
      reason: "Too far",
    });
  });

  it("throws the server message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      (async () => jsonResponse({ error: "sign-in required" }, 401)) as typeof fetch,
    );
    await expect(postFeedback("bad", "e1", "saved")).rejects.toThrow(
      "sign-in required",
    );
  });

  it("deletes verdicts and lists saved ids", async () => {
    const urls: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      (async (url: unknown, init?: RequestInit) => {
        urls.push(url);
        if (init?.method === "DELETE") return jsonResponse({ ok: true });
        return jsonResponse({
          feedback: [{ event_id: "e9", reason: null, created_at: "2026-01-01" }],
        });
      }) as typeof fetch,
    );
    await deleteFeedback("jwt-1", "e1");
    expect(urls[0]).toBe("/api/feedback?event_id=e1");
    const rows = await fetchSavedIds("jwt-1");
    expect(rows).toEqual([{ event_id: "e9", reason: null, created_at: "2026-01-01" }]);
  });
});
