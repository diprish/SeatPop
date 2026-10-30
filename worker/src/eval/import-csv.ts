import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isDirectExecution } from "../script-entry";
import { importCsvToGolden } from "./golden";
import { goldenDir, goldenEventsPath, labelingCsvPath } from "./paths";

/**
 * `npm run eval:import`: validate worker/eval/labeling.csv and write
 * golden/events.jsonl. Lists EVERY invalid row and writes nothing until
 * all rows are fixed — a golden set is all-or-nothing.
 */

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "seatpop eval:import: validate labeling.csv into golden/events.jsonl.\n" +
        "usage: npm run eval:import --workspace @seatpop/worker",
    );
    return 0;
  }
  const csvPath = labelingCsvPath();
  if (!existsSync(csvPath)) {
    console.error(
      `no labeling CSV at ${csvPath}; run eval:export first, then label every row`,
    );
    return 2;
  }
  const result = importCsvToGolden(readFileSync(csvPath, "utf8"));
  if (!result.ok) {
    console.error(
      `eval:import: ${result.errors.length} invalid row(s); writing nothing:`,
    );
    for (const error of result.errors) {
      const where =
        error.eventId === "" ? `line ${error.line}` : `line ${error.line} (${error.eventId})`;
      for (const reason of error.reasons) {
        console.error(`  ${where}: ${reason}`);
      }
    }
    return 1;
  }
  const out = goldenEventsPath();
  mkdirSync(goldenDir(), { recursive: true });
  writeFileSync(
    out,
    result.events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    "utf8",
  );
  const nonLibrary = result.events.filter(
    (event) => (event.category ?? "").toLowerCase() !== "library",
  ).length;
  console.log(
    `eval:import: ${result.events.length} golden event(s) ` +
      `(${nonLibrary} non-library) wrote ${out}`,
  );
  return 0;
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await main().catch((error: unknown) => {
    console.error(
      `eval:import failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  });
  process.exit(exitCode);
}
