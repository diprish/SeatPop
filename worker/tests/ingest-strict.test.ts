import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { strictEnrichFailed } from "../src/enrich/run";
import { strictFailures, type IngestReport } from "../src/ingest/run";

function report(statuses: string[]): IngestReport {
  return {
    dryRun: false,
    sources: statuses.map((status, index) => ({
      name: `source-${index}`,
      kind: "rss",
      fetched: 0,
      upcoming: 0,
      inserted: 0,
      linked: 0,
      skippedUnchanged: 0,
      status,
    })),
  };
}

describe("ingest strict failures", () => {
  it("passes ok, robots-disallowed, and rehearsal outcomes", () => {
    expect(
      strictFailures(report(["ok", "robots-disallowed", "dry-run", "no-store"])),
    ).toEqual([]);
  });

  it("fails errors, no-retry HTTP, and unknown kinds loudly", () => {
    const failures = strictFailures(
      report([
        "ok",
        "error: socket hang up",
        "http-500-no-retry",
        "unknown kind: gopher",
        "no adapter for kind: gopher",
      ]),
    );
    expect(failures.map((failure) => failure.status)).toEqual([
      "error: socket hang up",
      "http-500-no-retry",
      "unknown kind: gopher",
      "no adapter for kind: gopher",
    ]);
  });

  it("fails unknown future statuses by default", () => {
    expect(strictFailures(report(["mystery-new-status"]))).toHaveLength(1);
  });
});

describe("enrich strict failure", () => {
  it("fails only when events produced no usable pass", () => {
    expect(strictEnrichFailed(0)).toBe(false);
    expect(strictEnrichFailed(3)).toBe(true);
  });
});

describe("crawl workflow", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/crawl.yml", import.meta.url),
    "utf8",
  );

  it("runs daily and on manual dispatch", () => {
    expect(workflow).toContain("cron:");
    expect(workflow).toContain("workflow_dispatch:");
  });

  it("runs ingest then enrich, both strict", () => {
    const ingest = workflow.indexOf("npm run ingest");
    const enrich = workflow.indexOf("npm run enrich");
    expect(ingest).toBeGreaterThan(-1);
    expect(enrich).toBeGreaterThan(ingest);
    expect(workflow).toContain("ingest --workspace @seatpop/worker -- --strict");
    expect(workflow).toContain("enrich --workspace @seatpop/worker -- --strict");
  });

  it("wires secrets by name, never by value", () => {
    for (const name of [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "MODEL_API_KEY",
      "BASETEN_API_KEY",
      "LLM_MAX_USD_TOTAL",
      "LLM_MAX_USD_DAILY_LIVE",
      "BASETEN_MAX_USD_TOTAL",
    ]) {
      expect(workflow).toContain(`secrets.${name}`);
    }
    // Per-run caps are code-forced ($2 extract / $5 enrich); wiring the
    // secret would silently do nothing, so it must stay out.
    expect(workflow).not.toContain("LLM_MAX_USD_PER_RUN");
  });
});
