import { describe, expect, it } from "vitest";
import { dedupeKey, normalizeTitle, rawHash } from "../src/ingest/dedupe";

describe("dedupe", () => {
  it("hashes raw text stably within a source", () => {
    expect(rawHash("abc")).toBe(rawHash("abc"));
    expect(rawHash("abc")).not.toBe(rawHash("abd"));
  });

  it("keys the same event equally across sources", () => {
    const a = dedupeKey({
      title: "Wednesday   Yoga!!!",
      startsAtUtc: "2026-11-04T23:00:00.000Z",
      venue: "Community Centre",
    });
    const b = dedupeKey({
      title: "wednesday yoga",
      startsAtUtc: "2026-11-04T23:00:00.000Z",
      venue: "community centre, ottawa",
    });
    expect(a).not.toBe(b); // venue differs: different key
    const c = dedupeKey({
      title: "wednesday yoga",
      startsAtUtc: "2026-11-04T23:00:00.000Z",
      venue: "Community Centre",
    });
    expect(a).toBe(c);
    expect(normalizeTitle("Yoga — Débutant")).toBe("yoga debutant");
  });

  it("keys apart different times", () => {
    const a = dedupeKey({
      title: "Yoga",
      startsAtUtc: "2026-11-04T23:00:00.000Z",
    });
    const b = dedupeKey({
      title: "Yoga",
      startsAtUtc: "2026-11-11T23:00:00.000Z",
    });
    expect(a).not.toBe(b);
  });
});
