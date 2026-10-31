import { describe, expect, it } from "vitest";
import {
  loadSeedEntries,
  matchSeedEntry,
  normalizeVenueName,
  planVenueUpdates,
  resolveNewVenueCoords,
  seedBoundsError,
  type SeedEntry,
} from "../src/seed-venues/seed";

function entry(partial: Partial<SeedEntry> & { key: string }): SeedEntry {
  return {
    match: [],
    name: partial.key,
    lat: 45.4,
    lng: -75.7,
    source: "test",
    verified: true,
    ...partial,
  };
}

describe("normalizeVenueName", () => {
  it("lowercases, strips accents, collapses whitespace", () => {
    expect(normalizeVenueName("Orléans at Salle Dolorès et Marcel Bériault")).toBe(
      "orleans at salle dolores et marcel beriault",
    );
    expect(normalizeVenueName("  Greely   at\nCarol Parker Room ")).toBe(
      "greely at carol parker room",
    );
  });
});

describe("matchSeedEntry", () => {
  const greely = entry({
    key: "ottawa-public-library-greely",
    match: ["Greely at", "Greely Branch"],
    lat: 45.2623,
    lng: -75.5567,
  });

  it("matches branch rooms by qualifier, one entry to many rows", () => {
    for (const room of [
      "Greely at Carol Parker Room",
      "Greely at Meeting Room",
      "Greely Branch",
    ]) {
      expect(matchSeedEntry([greely], room)?.entry.key).toBe(greely.key);
    }
  });

  it("prefers the longest match (Diefenbunker over Carp Road)", () => {
    const entries = [
      entry({ key: "carp", match: ["carp"] }),
      entry({ key: "diefenbunker", match: ["Diefenbunker"] }),
    ];
    const venue =
      "Diefenbunker: Canada’s Cold War Museum, 3929 Carp Road, Ottawa";
    expect(matchSeedEntry(entries, venue)?.entry.key).toBe("diefenbunker");
  });

  it("never matches bare words without a qualifier", () => {
    const main = entry({ key: "main", match: ["Main at", "Main Branch"] });
    expect(matchSeedEntry([main], "Main Hall")).toBeNull();
    expect(matchSeedEntry([main], "Main at Auditorium")?.entry.key).toBe("main");
  });

  it("matches across accents and hyphen variants", () => {
    const orleans = entry({ key: "orleans", match: ["Orleans at"] });
    expect(
      matchSeedEntry([orleans], "Orléans at Salle Dolorès et Marcel Bériault")
        ?.entry.key,
    ).toBe("orleans");
    const laurent = entry({
      key: "saint-laurent",
      match: ["Saint Laurent at", "St-Laurent at", "St Laurent at"],
    });
    expect(
      matchSeedEntry([laurent], "St-Laurent at Claude B. Aubry room")?.entry.key,
    ).toBe("saint-laurent");
  });

  it("breaks exact ties by file order and returns null on no match", () => {
    const tied = [
      entry({ key: "a", match: ["ab"] }),
      entry({ key: "b", match: ["bc"] }),
    ];
    expect(matchSeedEntry(tied, "abc")?.entry.key).toBe("a");
    expect(matchSeedEntry(tied, "Telephone, Canada")).toBeNull();
  });
});

describe("seedBoundsError", () => {
  const base = entry({ key: "k" });
  it("accepts Ottawa points including the box edges", () => {
    expect(seedBoundsError({ ...base, lat: 45.4, lng: -75.7 })).toBeNull();
    expect(seedBoundsError({ ...base, lat: 44.9, lng: -76.4 })).toBeNull();
    expect(seedBoundsError({ ...base, lat: 45.6, lng: -75.2 })).toBeNull();
  });

  it("rejects out-of-box and non-finite coordinates", () => {
    for (const coords of [
      { lat: 44.8, lng: -75.7 },
      { lat: 45.7, lng: -75.7 },
      { lat: 45.4, lng: -76.5 },
      { lat: 45.4, lng: -75.1 },
      { lat: Number.NaN, lng: -75.7 },
    ]) {
      expect(seedBoundsError({ ...base, ...coords })).toContain("outside Ottawa");
    }
  });
});

describe("planVenueUpdates", () => {
  const entries = [
    entry({ key: "greely", match: ["Greely at"], lat: 45.1, lng: -75.1 }),
  ];
  const rows = [
    { id: "u1", name: "Greely at Carol Parker Room", lat: null, lng: null },
    { id: "u2", name: "Greely at Meeting Room", lat: null, lng: null },
    // Existing coordinates are sacred, even when the seed matches.
    { id: "keep", name: "Greely at Old Room", lat: 45.0, lng: -75.0 },
    // Half-null rows are incomplete: reported missing, never overwritten.
    { id: "half", name: "Greely at Half Room", lat: 45.0, lng: null },
    { id: "nomatch", name: "Telephone, Canada", lat: null, lng: null },
  ];
  const counts = new Map([
    ["u1", 14],
    ["u2", 3],
    ["keep", 50],
    ["half", 2],
    ["nomatch", 9],
  ]);

  it("updates null-coord matches, never overwrites, sorts the missing", () => {
    const plan = planVenueUpdates(rows, entries, counts);
    expect(plan.updates.map((u) => u.id)).toEqual(["u1", "u2"]);
    expect(plan.updates[0]).toMatchObject({ key: "greely", lat: 45.1, lng: -75.1 });
    expect(plan.stillMissing.map((r) => r.id)).toEqual(["nomatch", "half"]);
    expect(plan.stillMissing[0]).toMatchObject({ liveEvents: 9 });
    expect(plan.unmatchedEntries).toEqual([]);
  });

  it("lists seed entries that matched no venue", () => {
    const plan = planVenueUpdates(rows, [...entries, entry({ key: "zzz" })], counts);
    expect(plan.unmatchedEntries).toEqual(["zzz"]);
  });
});

describe("resolveNewVenueCoords", () => {
  const entries = [
    entry({ key: "greely", match: ["Greely at"], lat: 45.1, lng: -75.1 }),
  ];

  it("uses the seed match without touching the geocoder", async () => {
    let calls = 0;
    const coords = await resolveNewVenueCoords(
      "Greely at New Room",
      "Greely at New Room",
      entries,
      async () => {
        calls++;
        return { lat: 0, lng: 0, confidence: 1 };
      },
    );
    expect(coords).toEqual({ lat: 45.1, lng: -75.1 });
    expect(calls).toBe(0);
  });

  it("falls back to the geocoder exactly as before on a seed miss", async () => {
    const seen: string[] = [];
    const coords = await resolveNewVenueCoords(
      "Somewhere New",
      "Somewhere New",
      entries,
      async (query) => {
        seen.push(query);
        return { lat: 45.2, lng: -75.2, confidence: 0.5 };
      },
    );
    expect(seen).toEqual(["Somewhere New, Ottawa, ON"]);
    expect(coords).toEqual({ lat: 45.2, lng: -75.2, confidence: 0.5 });
  });

  it("geocodes nothing for an empty query on a seed miss", async () => {
    let calls = 0;
    const coords = await resolveNewVenueCoords("Somewhere New", "", entries, async () => {
      calls++;
      return { lat: 0, lng: 0, confidence: 1 };
    });
    expect(coords).toEqual({ lat: undefined, lng: undefined, confidence: undefined });
    expect(calls).toBe(0);
  });
});

describe("seed file", () => {
  it("loads valid entries with unique keys, all in bounds", () => {
    const entries = loadSeedEntries();
    expect(entries.length).toBeGreaterThan(40);
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
    for (const e of entries) {
      expect(seedBoundsError(e)).toBeNull();
      for (const m of e.match) {
        expect(normalizeVenueName(m).length).toBeGreaterThan(0);
      }
    }
    const greely = entries.find((e) => e.key === "ottawa-public-library-greely");
    expect(greely).toMatchObject({ lat: 45.2623, lng: -75.5567, verified: true });
  });

  it("pins the unverified set (map-check queue)", () => {
    const unverified = loadSeedEntries()
      .filter((e) => !e.verified)
      .map((e) => e.key)
      .sort();
    expect(unverified).toEqual([
      "great-canadian-theatre-company",
      "ottawa-art-gallery",
      "westboro-farmers-market",
    ]);
  });
});
