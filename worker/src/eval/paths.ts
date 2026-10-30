import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Eval data directory: worker/eval/ (golden files, labeling CSV, report
 * JSON). Overridable with EVAL_DIR for tests and experiments.
 */
export function evalDataDir(): string {
  const override = process.env["EVAL_DIR"]?.trim();
  if (override) return path.resolve(override);
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "eval");
}

export function labelingCsvPath(): string {
  return path.join(evalDataDir(), "labeling.csv");
}

export function goldenDir(): string {
  return path.join(evalDataDir(), "golden");
}

export function goldenEventsPath(): string {
  return path.join(goldenDir(), "events.jsonl");
}

export function evalReportPath(): string {
  return path.join(evalDataDir(), "report.json");
}

/** Repo-root docs/eval-report.md (the human-readable report). */
export function docsReportPath(): string {
  return path.resolve(evalDataDir(), "..", "..", "docs", "eval-report.md");
}

/** The web app's renderable copy (served statically from public/). */
export function webReportPath(): string {
  return path.resolve(
    evalDataDir(),
    "..",
    "..",
    "apps",
    "web",
    "public",
    "eval-report.json",
  );
}
