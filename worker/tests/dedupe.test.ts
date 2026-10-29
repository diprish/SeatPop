import { describe, expect, it } from "vitest";
import {
  dedupeKey,
  normalizeTitle,
  planDraftActions,
  rawHash,
} from "../src/ingest/dedupe";

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

  it("links every occurrence even when raw text repeats (no hash collapse)", () => {
    // RRULE siblings: one raw text, one key per occurrence.
    const actions = planDraftActions(
      [
        { hash: "h", key: "k1" },
        { hash: "h", key: "k2" },
        { hash: "h", key: "k3" },
      ],
      new Set(),
      new Map([
        ["k1", "e1"],
        ["k2", "e2"],
        ["k3", "e3"],
      ]),
      new Set(),
    );
    expect(actions).toEqual([
      { action: "link", eventId: "e1" },
      { action: "link", eventId: "e2" },
      { action: "link", eventId: "e3" },
    ]);
  });

  it("skips raw matches and already-linked canonicals, inserts the rest", () => {
    const actions = planDraftActions(
      [
        { hash: "seen", key: "k1" },
        { hash: "fresh", key: "k2" },
        { hash: "fresh", key: "k3" },
      ],
      new Set(["seen"]),
      new Map([["k2", "e2"]]),
      new Set(["e2"]),
    );
    expect(actions).toEqual([
      { action: "skip" },
      { action: "skip" },
      { action: "insert" },
    ]);
  });

  it("links an unlinked canonical once per batch", () => {
    const actions = planDraftActions(
      [
        { hash: "a", key: "k" },
        { hash: "b", key: "k" },
      ],
      new Set(),
      new Map([["k", "e"]]),
      new Set(),
    );
    expect(actions).toEqual([
      { action: "link", eventId: "e" },
      { action: "skip" },
    ]);
  });
});
