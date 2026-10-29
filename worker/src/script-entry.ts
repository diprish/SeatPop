import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * True when the calling module is the executed script (argv[1] resolves to
 * it). Every worker script gates its main() on this so importing helpers
 * from a script (tests, other scripts) never runs it or exits the process.
 */
export function isDirectExecution(moduleUrl: string): boolean {
  return (
    process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)
  );
}
