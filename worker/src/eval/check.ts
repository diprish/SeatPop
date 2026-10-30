import { existsSync, readFileSync } from "node:fs";
import { isDirectExecution } from "../script-entry";
import { evalReportPath } from "./paths";
import { EvalReportSchema, checkReportGate } from "./report";

/**
 * `npm run eval:check` (a CI step): fail when any recorded eval run shows
 * false-free > 0 or wrong-price > 0. Reads the committed report only —
 * no network, no keys — so it runs identically in CI and locally. With
 * no report committed yet the gate passes: there is no eval run to judge.
 */

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "seatpop eval:check: fail if any recorded eval run has price errors.\n" +
        "usage: npm run eval:check --workspace @seatpop/worker",
    );
    return 0;
  }
  const reportPath = evalReportPath();
  if (!existsSync(reportPath)) {
    console.log(
      `eval:check: no report at ${reportPath} yet; gate passes (no eval runs recorded)`,
    );
    return 0;
  }
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    console.error(`eval:check: ${reportPath} is not valid JSON`);
    return 1;
  }
  const parsed = EvalReportSchema.safeParse(json);
  if (!parsed.success) {
    console.error(
      `eval:check: ${reportPath} failed schema validation: ` +
        parsed.error.issues.map((issue) => issue.message).join("; "),
    );
    return 1;
  }
  const gate = checkReportGate(parsed.data);
  if (!gate.ok) {
    for (const offender of gate.offenders) {
      console.error(
        `eval:check: FAIL ${offender.key}: false_free=${offender.falseFree} ` +
          `wrong_price=${offender.wrongPrice}`,
      );
    }
    return 1;
  }
  console.log(
    `eval:check: PASS (${parsed.data.models.length} recorded model run(s), ` +
      `zero price errors across all)`,
  );
  return 0;
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await main().catch((error: unknown) => {
    console.error(
      `eval:check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  });
  process.exit(exitCode);
}
