/**
 * SeatPop worker skeleton. Scheduled jobs (crawls, extraction, reminders)
 * land here in later phases; every script runs with tsx.
 */
function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("seatpop worker: no jobs scheduled yet (phase 0 skeleton).");
    console.log("usage: npm run start --workspace @seatpop/worker [--help]");
    return 0;
  }
  console.log("seatpop worker: ok, nothing scheduled.");
  return 0;
}

process.exit(main());
