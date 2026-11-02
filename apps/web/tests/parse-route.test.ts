import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the parse route (no Next harness): parse
// failures answer a friendly line with raw detail logged server-side,
// never raw zod text in the response body.
const ROUTE = readFileSync(
  new URL("../src/app/api/profile/parse/route.ts", import.meta.url),
  "utf8",
);

describe("profile parse route errors", () => {
  it("answers friendly and keeps raw detail server-side", () => {
    expect(ROUTE).toContain(
      "Couldn't read that description. Pick who's coming with the chips instead.",
    );
    expect(ROUTE).toContain("console.error(");
    expect(ROUTE).not.toContain("error: `profile parse failed");
  });
});
