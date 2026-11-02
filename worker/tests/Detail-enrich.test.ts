import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeEvidence, verifyAge, verifyAmount } from "@seatpop/shared";
import {
  HttpNoRetry,
  RobotsDisallowed,
} from "../src/ingest/fetcher";
import { visibleText } from "../src/ingest/html";
import { sanitizeText } from "@seatpop/shared";
import {
  clampDetailLimit,
  classifyFetchError,
  detailBeatsFeed,
  MAX_PAGES_PER_RUN,
  needsDetailText,
  sameSite,
  strictDetailFailed,
} from "../src/detail-enrich/plan";
import { DETAIL_SOURCES } from "../src/detail-enrich/sources";

function fixture(name: string): string {
  return readFileSync(
    new URL(`./fixtures/detail/${name}`, import.meta.url),
    "utf8",
  );
}

function stripped(name: string): string {
  return sanitizeText(visibleText(fixture(name)));
}

describe("needsDetailText", () => {
  it("fires on empty or sub-200-char feed text", () => {
    expect(needsDetailText(null)).toBe(true);
    expect(needsDetailText("")).toBe(true);
    expect(needsDetailText("x".repeat(199))).toBe(true);
    expect(needsDetailText("x".repeat(200))).toBe(false);
    expect(needsDetailText("x".repeat(500))).toBe(false);
  });
});

describe("sameSite", () => {
  const cases: Array<[string, string, boolean]> = [
    ["https://oaggao.ca/events/?ical=1", "https://oaggao.ca/events/foo", true],
    ["https://oaggao.ca/x", "https://www.oaggao.ca/y", true],
    [
      "https://www.chamberfest.com/event/",
      "https://chamberfest.com/event/2026/x",
      true,
    ],
    ["https://OAGGAO.CA/x", "https://oaggao.ca/y", true],
    ["https://oaggao.ca/x", "https://tickets.example.com/y", false],
    ["not a url", "https://oaggao.ca/x", false],
    ["https://oaggao.ca/x", "not a url", false],
  ];
  it.each(cases)("sameSite(%s, %s) === %s", (feed, page, expected) => {
    expect(sameSite(feed, page)).toBe(expected);
  });
});

describe("detailBeatsFeed", () => {
  it("never stores empty or feed-destroying text", () => {
    expect(detailBeatsFeed("", null)).toBe(false);
    expect(detailBeatsFeed("", "feed words")).toBe(false);
    expect(detailBeatsFeed("Loading…", null)).toBe(true);
    expect(detailBeatsFeed("Loading…", "a much longer feed text")).toBe(false);
    expect(detailBeatsFeed("official page text", "feed")).toBe(true);
    expect(detailBeatsFeed("same size", "same size")).toBe(true);
  });
});

describe("clampDetailLimit", () => {
  it("defaults to the 150/run cap and never exceeds it", () => {
    expect(MAX_PAGES_PER_RUN).toBe(150);
    expect(clampDetailLimit(undefined)).toBe(150);
    expect(clampDetailLimit(10)).toBe(10);
    expect(clampDetailLimit(999)).toBe(150);
  });
});

describe("classifyFetchError", () => {
  it("treats robots and 403 as skips, everything else as failure", () => {
    expect(classifyFetchError(new RobotsDisallowed("https://x.test/"))).toBe(
      "robots",
    );
    expect(classifyFetchError(new HttpNoRetry("https://x.test/", 403))).toBe(
      "forbidden",
    );
    expect(classifyFetchError(new Error("HTTP 500"))).toBe("error");
    expect(classifyFetchError("bogus")).toBe("error");
  });
});

describe("strictDetailFailed", () => {
  it("fails strict runs on any failure", () => {
    expect(strictDetailFailed(0)).toBe(false);
    expect(strictDetailFailed(1)).toBe(true);
  });
});

describe("fixture stripping", () => {
  it("keeps page content and drops scripts, styles, and chrome", () => {
    const text = stripped("chamberfest-concert.html");
    expect(text).toContain("Tickets $45");
    expect(text).toContain("Ages 12");
    expect(text).not.toContain("dataLayer");
    expect(text).not.toContain("color: blue");
  });

  it("marks thin and shell pages honestly", () => {
    const thin = stripped("thin-event.html");
    expect(thin.length).toBeGreaterThan(0);
    expect(thin.length).toBeLessThan(200);
    expect(needsDetailText(thin)).toBe(true);
    expect(stripped("empty-shell.html")).toBe("");
  });
});

describe("detail text through the shared verifier", () => {
  const text = stripped("chamberfest-concert.html");
  const source = normalizeEvidence(`Quartet Luna\n${text}`);
  const priceLine =
    text.split("\n").find((line) => line.includes("$45")) ?? "";

  it("keeps prices with digits and currency in the quote", () => {
    expect(verifyAmount(4500, priceLine, source)).toBe(4500);
    expect(verifyAge(12, priceLine, source, { min: 0, max: 130 })).toBe(12);
  });

  it("drops prices the quote cannot support", () => {
    expect(verifyAmount(4500, "no digits here", source)).toBeNull();
    // Grounded and digit-bearing, but no currency token: still dropped.
    // (Not the date line: its venue smuggles "cent" into "Centre".)
    const doorsLine =
      text.split("\n").find((line) => line.includes("Doors open")) ?? "";
    expect(doorsLine).toContain("6:45");
    expect(verifyAmount(4500, doorsLine, source)).toBeNull();
  });
});

describe("migration 0022", () => {
  it("adds the description-source column defaulting to feed", () => {
    const migration = readFileSync(
      new URL(
        "../../supabase/migrations/0022_description_source.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain("add column description_source text");
    expect(migration).toContain("default 'feed'");
    expect(migration).toContain("check (description_source in ('feed', 'detail_page'))");
  });
});

describe("Detail allowlist verdicts", () => {
  it("holds a YES or accepted DECIDE per docs/sources.md", () => {
    const doc = readFileSync(
      new URL("../../docs/sources.md", import.meta.url),
      "utf8",
    );
    const approved = new Set<number>();
    for (const match of doc.matchAll(/^Approved: ([\d, ]+)\./gm)) {
      for (const raw of match[1].split(",")) {
        approved.add(Number(raw.trim()));
      }
    }
    expect(DETAIL_SOURCES).toHaveLength(5);
    for (const name of DETAIL_SOURCES) {
      const row = doc
        .split("\n")
        .find((line) => line.startsWith("| ") && line.includes(`| ${name} |`));
      expect(row, `${name} has a verdict row`).toBeDefined();
      const num = Number(/^\| (\d+) \|/.exec(row!)?.[1]);
      const accepted =
        row!.includes("**YES**") ||
        (row!.includes("DECIDE") && approved.has(num));
      expect(accepted, `${name} is YES or accepted DECIDE`).toBe(true);
      expect(row, `${name} is not dropped`).not.toMatch(/DROPPED|SKIPPED|NO-barred/);
    }
  });
});

describe("Detail-enrich wiring", () => {
  it("registers the npm script", () => {
    const pkg = readFileSync(
      new URL("../../worker/package.json", import.meta.url),
      "utf8",
    );
    expect(pkg).toContain('"detail-enrich": "tsx src/detail-enrich/run.ts"');
  });

  it("runs in the crawl workflow after ingest, before enrich, strict", () => {
    const workflow = readFileSync(
      new URL("../../.github/workflows/crawl.yml", import.meta.url),
      "utf8",
    );
    const ingest = workflow.indexOf("npm run ingest");
    const detail = workflow.indexOf("npm run detail-enrich");
    const enrich = workflow.indexOf("npm run enrich");
    expect(ingest).toBeGreaterThanOrEqual(0);
    expect(detail).toBeGreaterThan(ingest);
    expect(enrich).toBeGreaterThan(detail);
    expect(workflow).toContain("npm run detail-enrich --workspace @seatpop/worker -- --strict");
  });

  it("stores Detail-page provenance on write", () => {
    const run = readFileSync(
      new URL("../src/Detail-enrich/run.ts", import.meta.url),
      "utf8",
    );
    expect(run).toContain("description_source: \"detail_page\"");
    expect(run).toContain('description_source !== "detail_page"');
    expect(run).toContain("price paid/free:");
  });
});
