import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rest, type Deps } from "../src/seed-registration/run";
import {
  loadRegistrationSeed,
  torontoMidnightIso,
  validateWindow,
  type WindowInput,
} from "../src/seed-registration/seed";

function window(overrides: Partial<WindowInput> = {}): WindowInput {
  return {
    scope: "Testville Aquatics",
    kind: "swimming",
    opens_at: "2031-03-04T19:00:00-05:00",
    quote: "Registration opens March 4 at 7 pm.",
    source_url: "https://example.test/registration",
    ...overrides,
  };
}

describe("torontoMidnightIso", () => {
  it("uses EST in winter and EDT in summer", () => {
    expect(torontoMidnightIso("2031-01-15")).toBe("2031-01-15T00:00:00-05:00");
    expect(torontoMidnightIso("2031-07-15")).toBe("2031-07-15T00:00:00-04:00");
  });

  it("puts transition midnights on the correct side", () => {
    // 2026: spring forward Mar 8 (midnight EST), fall back Nov 1 (midnight EDT).
    expect(torontoMidnightIso("2026-03-08")).toBe("2026-03-08T00:00:00-05:00");
    expect(torontoMidnightIso("2026-03-09")).toBe("2026-03-09T00:00:00-04:00");
    expect(torontoMidnightIso("2026-11-01")).toBe("2026-11-01T00:00:00-04:00");
    expect(torontoMidnightIso("2026-11-02")).toBe("2026-11-02T00:00:00-05:00");
  });

  it("rejects non-dates", () => {
    expect(torontoMidnightIso("2031-02-30")).toBeNull();
    expect(torontoMidnightIso("03/04/2031")).toBeNull();
    expect(torontoMidnightIso("2031-13-01")).toBeNull();
    expect(torontoMidnightIso("2031-03-04T19:00:00-05:00")).toBeNull();
  });
});

describe("validateWindow", () => {
  it("accepts zoned datetimes", () => {
    const checked = validateWindow(window(), 0);
    expect(checked).toEqual({
      ok: true,
      window: {
        scope: "Testville Aquatics",
        kind: "swimming",
        opens_at: "2031-03-05T00:00:00.000Z",
        opens_date_only: false,
        quote: "Registration opens March 4 at 7 pm.",
        source_url: "https://example.test/registration",
        label: null,
      },
    });
  });

  it("keeps the label, trimming it and nulling blanks", () => {
    const checked = validateWindow(window({ label: "  Swim  " }), 0);
    expect(checked).toEqual({
      ok: true,
      window: expect.objectContaining({ label: "Swim" }),
    });
    const blank = validateWindow(window({ label: "   " }), 0);
    expect(blank).toEqual({
      ok: true,
      window: expect.objectContaining({ label: null }),
    });
  });

  it("accepts bare dates as Toronto midnights flagged date-only", () => {
    const checked = validateWindow(window({ opens_at: "2031-07-15" }), 0);
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.window.opens_at).toBe("2031-07-15T00:00:00-04:00");
      expect(checked.window.opens_date_only).toBe(true);
    }
  });

  it("rejects empty scope, empty quote, and non-https sources", () => {
    expect(validateWindow(window({ scope: "  " }), 3)).toMatchObject({
      ok: false,
      error: "window 3: empty scope",
    });
    expect(validateWindow(window({ quote: "" }), 4)).toMatchObject({
      ok: false,
      error: "window 4: empty quote",
    });
    expect(
      validateWindow(window({ source_url: "http://example.test/x" }), 5),
    ).toMatchObject({ ok: false });
    expect(validateWindow(window({ source_url: "not a url" }), 5)).toMatchObject(
      { ok: false },
    );
  });

  it("rejects naive datetimes and bad dates", () => {
    expect(
      validateWindow(window({ opens_at: "2031-03-04 19:00" }), 1),
    ).toMatchObject({ ok: false });
    expect(validateWindow(window({ opens_at: "2031-02-30" }), 2)).toMatchObject(
      { ok: false },
    );
    expect(validateWindow(window({ opens_at: "soon" }), 2)).toMatchObject({
      ok: false,
    });
  });
});

describe("loadRegistrationSeed", () => {
  function writeSeed(body: unknown): URL {
    const dir = mkdtempSync(path.join(tmpdir(), "seatpop-regseed-"));
    const file = path.join(dir, "city-registration-dates.json");
    writeFileSync(file, JSON.stringify(body));
    return pathToFileURL(file);
  }

  it("loads valid windows and lists every invalid row", () => {
    const url = writeSeed({
      schemaVersion: 1,
      windows: [window(), window({ scope: "", opens_at: "soon" })],
    });
    expect(() => loadRegistrationSeed(url)).toThrow(/window 1: empty scope/);
  });

  it("rejects the wrong schema version", () => {
    const url = writeSeed({ schemaVersion: 2, windows: [] });
    expect(() => loadRegistrationSeed(url)).toThrow(/invalid/);
  });

  it("accepts an empty window list (nothing transcribed yet)", () => {
    const url = writeSeed({ schemaVersion: 1, windows: [] });
    expect(loadRegistrationSeed(url)).toEqual([]);
  });

  it("loads the committed City transcription verbatim", () => {
    const windows = loadRegistrationSeed();
    expect(windows).toHaveLength(3);
    expect(windows[0]).toEqual({
      scope: "City of Ottawa Recreation",
      kind: "listings_visible",
      opens_at: "2026-11-03T00:00:00-05:00",
      opens_date_only: true,
      quote: "View online November 3.",
      source_url:
        "https://ottawa.ca/en/recreation-and-parks/register-courses-and-camps/registration-terms-and-cancellations/registration-dates",
      label: "Winter activities",
    });
    expect(windows[1]).toEqual({
      scope: "City of Ottawa Recreation",
      kind: "registration_opens",
      opens_at: "2026-11-18T02:00:00.000Z",
      opens_date_only: false,
      quote: "All winter swimming activities November 17 at 9 pm.",
      source_url:
        "https://ottawa.ca/en/recreation-and-parks/register-courses-and-camps/registration-terms-and-cancellations/registration-dates",
      label: "All winter swimming activities",
    });
    expect(windows[2]).toEqual({
      scope: "City of Ottawa Recreation",
      kind: "registration_opens",
      opens_at: "2026-11-20T02:00:00.000Z",
      opens_date_only: false,
      quote: "All winter activities November 19 at 9 pm.",
      source_url:
        "https://ottawa.ca/en/recreation-and-parks/register-courses-and-camps/registration-terms-and-cancellations/registration-dates",
      label: "All winter activities",
    });
  });
});

describe("rest", () => {
  const deps: Deps = { url: "https://example.test", serviceKey: "k" };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves undefined on empty bodies with a compound minimal prefer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(
      rest(deps, "registration_windows", "?on_conflict=x", {
        method: "POST",
        body: {},
        prefer: "return=minimal,resolution=merge-duplicates",
      }),
    ).resolves.toBeUndefined();
  });

  it("parses JSON bodies otherwise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([{ id: "r1" }])),
    );
    await expect(rest(deps, "sources", "?x=1")).resolves.toEqual([
      { id: "r1" },
    ]);
  });
});

describe("migration 0020", () => {
  it("adds the window label column", () => {
    const migration = readFileSync(
      new URL("../../supabase/migrations/0020_window_labels.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain("alter table public.registration_windows");
    expect(migration).toContain("add column label text");
  });
});
