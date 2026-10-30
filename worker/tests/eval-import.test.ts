import { describe, expect, it } from "vitest";
import {
  LABELING_COLUMNS,
  importCsvToGolden,
  parseAmountCell,
  parseGoldenJsonl,
} from "../src/eval/golden";

const HEADER = [...LABELING_COLUMNS].join(",");

/** Build a 16-cell row: fixed context + exactly 10 label cells. */
function labelRow(id: string, labels: string[]): string {
  if (labels.length !== 10) throw new Error("labelRow needs 10 cells");
  return [id, `Title ${id}`, "Text.", "Hall", "S", "arts", ...labels].join(
    ",",
  );
}

const BLANK = ["", "", "", "", "", "", "", "", "x", ""];
const DONE = (labels: string[]): string[] => {
  const out = [...labels];
  out[8] = "x";
  return out;
};

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n") + "\n";
}

describe("amount cells", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["25", { minCents: 2500, maxCents: 2500 }],
    ["$25", { minCents: 2500, maxCents: 2500 }],
    ["$25.00", { minCents: 2500, maxCents: 2500 }],
    ["$25.5", { minCents: 2550, maxCents: 2550 }],
    ["$1,200", { minCents: 120000, maxCents: 120000 }],
    ["  $30  ", { minCents: 3000, maxCents: 3000 }],
    ["10-20", { minCents: 1000, maxCents: 2000 }],
    ["$10-$20", { minCents: 1000, maxCents: 2000 }],
    ["$10–$20", { minCents: 1000, maxCents: 2000 }],
    ["10 to 20", { minCents: 1000, maxCents: 2000 }],
  ])("%s parses", (cell, expected) => {
    expect(parseAmountCell(cell as string)).toEqual({
      ok: true,
      value: expected,
    });
  });

  it.each(["lots", "20-10", "-5", "25.999", "10-", "$", "10-20-30"])(
    "%s is rejected",
    (cell) => {
      expect(parseAmountCell(cell).ok).toBe(false);
    },
  );
});

describe("csv import", () => {
  it("accepts a fully labeled row", () => {
    const result = importCsvToGolden(
      csv(
        'e1,Winter Concert,"Tickets $15 at the door. Ages 10-12.",Grand Hall,Chamberfest,music,10,12,paid,$15,,English,drop-in,,x,',
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({
      event_id: "e1",
      title: "Winter Concert",
      description: "Tickets $15 at the door. Ages 10-12.",
      venue_name: "Grand Hall",
      source: "Chamberfest",
      category: "music",
      labels: {
        age_min: 10,
        age_max: 12,
        price_kind: "paid",
        amount_min_cents: 1500,
        amount_max_cents: 1500,
        setting: null,
        language: "English",
        registration_hint: "drop-in",
        accessibility: [],
      },
    });
  });

  it("maps blanks to nulls, unknown kind, and empty lists", () => {
    const result = importCsvToGolden(csv(labelRow("e2", BLANK)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0]?.labels).toEqual({
      age_min: null,
      age_max: null,
      price_kind: "unknown",
      amount_min_cents: null,
      amount_max_cents: null,
      setting: null,
      language: null,
      registration_hint: null,
      accessibility: [],
    });
  });

  it("splits accessibility on semicolons", () => {
    const result = importCsvToGolden(
      csv(
        labelRow("e3", DONE(["", "", "", "", "", "", "", "wheelchair accessible; ASL", "", ""])),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0]?.labels.accessibility).toEqual([
      "wheelchair accessible",
      "ASL",
    ]);
  });

  it("lists every invalid row with line numbers and writes nothing", () => {
    const result = importCsvToGolden(
      csv(
        labelRow("e1", BLANK),
        labelRow("e2", DONE(["ten", "", "", "", "", "", "", "", "", ""])),
        labelRow("e3", DONE(["12", "10", "", "", "", "", "", "", "", ""])),
        labelRow("e4", DONE(["", "", "gratis", "", "", "", "", "", "", ""])),
        labelRow("e5", DONE(["", "", "", "lots", "", "", "", "", "", ""])),
        labelRow("e6", ["", "", "", "", "", "", "", "", "", ""]),
        "e7,Short,Text.",
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(6);
    const byLine = new Map(result.errors.map((e) => [e.line, e]));
    expect(byLine.get(3)?.eventId).toBe("e2");
    expect(byLine.get(3)?.reasons.join(" ")).toContain("age_min");
    expect(byLine.get(4)?.reasons.join(" ")).toContain("above age_max");
    expect(byLine.get(5)?.reasons.join(" ")).toContain("price_kind");
    expect(byLine.get(6)?.reasons.join(" ")).toContain("amount");
    expect(byLine.get(7)?.reasons.join(" ")).toContain("labeled");
    expect(byLine.get(8)?.reasons.join(" ")).toContain("columns");
  });

  it("rejects duplicate event ids and a wrong header", () => {
    const dup = importCsvToGolden(
      csv(labelRow("e1", BLANK), labelRow("e1", BLANK)),
    );
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.errors[0]?.reasons.join(" ")).toContain("duplicate");

    const header = importCsvToGolden("event_id,title\n");
    expect(header.ok).toBe(false);
  });

  it("reports spreadsheet line numbers past comments and wrapped cells", () => {
    const wrapped = [
      "e1",
      "Wrapped",
      '"line one\nline two"',
      "Hall",
      "S",
      "arts",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "x",
      "",
    ].join(",");
    const text = [
      "# RULE: label only what the text says",
      "# more instructions",
      HEADER,
      wrapped,
      labelRow("e2", DONE(["ten", "", "", "", "", "", "", "", "", ""])),
    ].join("\n");
    const result = importCsvToGolden(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    // Comments (1-2), header (3), e1 spans lines 4-5, so e2 starts at 6.
    expect(result.errors[0]?.line).toBe(6);
    expect(result.errors[0]?.eventId).toBe("e2");
  });
});

describe("golden jsonl", () => {
  it("parses labeled events and skips blank lines", () => {
    const events = parseGoldenJsonl(
      [
        "",
        JSON.stringify({
          event_id: "e1",
          title: "T",
          description: null,
          venue_name: null,
          source: "S",
          category: null,
          labels: {
            age_min: null,
            age_max: null,
            price_kind: "unknown",
            amount_min_cents: null,
            amount_max_cents: null,
            setting: null,
            language: null,
            registration_hint: null,
            accessibility: [],
          },
        }),
        "",
      ].join("\n"),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.event_id).toBe("e1");
  });

  it("throws with the offending line number", () => {
    const valid = JSON.stringify({
      event_id: "e1",
      title: "T",
      description: null,
      venue_name: null,
      source: "S",
      category: null,
      labels: {
        age_min: null,
        age_max: null,
        price_kind: "unknown",
        amount_min_cents: null,
        amount_max_cents: null,
        setting: null,
        language: null,
        registration_hint: null,
        accessibility: [],
      },
    });
    expect(() => parseGoldenJsonl(`${valid}\nnot json\n`)).toThrow(
      /line 2.*not valid JSON/,
    );
    expect(() => parseGoldenJsonl('{"event_id":"e1"}\n')).toThrow(/line 1/);
  });
});
