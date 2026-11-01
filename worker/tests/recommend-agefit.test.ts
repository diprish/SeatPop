import { describe, expect, it } from "vitest";
import { candidateAgeTier, type Preferences } from "@seatpop/shared";
import { orderByScore, type ScoreEvent } from "../src/recommend/score";
import { bandFits, templatedReason } from "../src/recommend/rerank";

const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);
const day = (n: number): string => new Date(NOW + n * 86_400_000).toISOString();

/** The web sample household: one adult, one kid, one preschooler. */
const SAMPLE_MEMBERS: Preferences["members"] = [
  { age_band: "adults", include_adjacent: true },
  { age_band: "kids", include_adjacent: true },
  { age_band: "preschool", include_adjacent: true },
];

const PREFS: Pick<Preferences, "interests" | "avoid" | "members"> = {
  interests: ["music"],
  avoid: [],
  members: SAMPLE_MEMBERS,
};

function event(overrides: Partial<ScoreEvent> & { event_id: string }): ScoreEvent {
  return {
    starts_at: day(30),
    distance_km: 15,
    category: "library",
    tags: ["crafts"],
    fetched_at: day(-30),
    age_min: 6,
    age_max: 12,
    ...overrides,
  };
}

describe("sample household ranking", () => {
  it("keeps adjacent-only 0-1 events out of the top 5 when exacts exist", () => {
    // Six exact fits, deliberately unattractive otherwise (far, late,
    // no interest overlap); three Babytime-style 0-1 sessions made as
    // attractive as possible (now, next door, every interest, fresh).
    const exacts = [
      { id: "exact-1", min: 3, max: 5 },
      { id: "exact-2", min: 6, max: 12 },
      { id: "exact-3", min: 4, max: 8 },
      { id: "exact-4", min: 18, max: 64 },
      { id: "exact-5", min: 0, max: 130 },
      { id: "exact-6", min: 5, max: 10 },
    ].map(({ id, min, max }) =>
      event({ event_id: id, age_min: min, age_max: max }),
    );
    const adjacent = ["baby-1", "baby-2", "baby-3"].map((id) =>
      event({
        event_id: id,
        starts_at: day(0),
        distance_km: 0,
        category: "music",
        tags: ["music"],
        fetched_at: day(0),
        age_min: 0,
        age_max: 1,
      }),
    );
    const ordered = orderByScore([...adjacent, ...exacts], PREFS, {
      nowMs: NOW,
    });
    const top5 = ordered.slice(0, 5);
    expect(top5).toHaveLength(5);
    for (const { event: candidate } of top5) {
      expect(candidateAgeTier(candidate, SAMPLE_MEMBERS)).toBe("exact");
      expect(candidate.event_id.startsWith("baby-")).toBe(false);
    }
  });
});

describe("adjacent reason wording", () => {
  const candidate = {
    title: "Babytime",
    starts_at: "2026-11-07T15:00:00.000Z",
    venue_name: "Main Branch",
    price_label: "Free",
    age_flag: null as string | null,
  };

  it("says 'close to your preschooler's age', never 'fits preschool'", () => {
    const fits = bandFits(
      { age_min: 0, age_max: 1 },
      {
        members: [{ age_band: "preschool", include_adjacent: true }],
      },
    );
    const reason = templatedReason(candidate, fits);
    expect(reason).toContain("close to your preschooler's age (inferred)");
    expect(reason).not.toMatch(/fits\s+preschool/i);
  });

  it("names the adjacent band for the sample household", () => {
    // 0-1 overlaps only the preschool expansion (0-12): the kid and
    // adult bands miss it entirely, so only the preschooler is named.
    const fits = bandFits(
      { age_min: 0, age_max: 1 },
      { members: SAMPLE_MEMBERS },
    );
    const reason = templatedReason(candidate, fits);
    expect(reason).toContain("close to your preschooler's age (inferred)");
    expect(reason).not.toMatch(/fits\s+(kids|preschool)/i);
  });

  it("joins several adjacent bands with a plural noun", () => {
    const fits = bandFits(
      { age_min: 3, age_max: 5 },
      {
        members: [
          { age_band: "kids", include_adjacent: true },
          { age_band: "baby", include_adjacent: true },
        ],
      },
    );
    const reason = templatedReason(candidate, fits);
    expect(reason).toContain("close to your kids' and baby's ages");
  });

  it("leaves exact fits and unknown ages unadorned", () => {
    const exact = templatedReason(
      candidate,
      bandFits({ age_min: 6, age_max: 12 }, { members: SAMPLE_MEMBERS }),
    );
    expect(exact).not.toContain("close to");
    const unknown = templatedReason(
      candidate,
      bandFits({ age_min: null, age_max: null }, { members: SAMPLE_MEMBERS }),
    );
    expect(unknown).not.toContain("close to");
    expect(templatedReason(candidate)).not.toContain("close to");
  });
});
