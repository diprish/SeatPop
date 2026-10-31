// Copies eval snapshots into public/ for the Trust page (runs on predev
// and prebuild). Missing files are skipped — the page shows "pending" —
// never faked.
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pairs = [
  ["../../worker/recommend/eval-report.json", "public/recommend-eval.json"],
  [
    "../../worker/recommend/eval-report-fallback.json",
    "public/recommend-eval-fallback.json",
  ],
];

for (const [from, to] of pairs) {
  const src = path.join(webDir, from);
  if (!existsSync(src)) {
    console.log(`[seatpop] trust snapshot skipped (missing): ${from}`);
    continue;
  }
  copyFileSync(src, path.join(webDir, to));
  console.log(`[seatpop] trust snapshot copied: ${to}`);
}
