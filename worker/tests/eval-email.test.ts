import { describe, expect, it } from "vitest";
import {
  parseGoldenEmailsJsonl,
  scoreEmailDecisions,
} from "../src/eval/email";

describe("email metrics", () => {
  it("counts junk emails the system turned into events", () => {
    const golden = parseGoldenEmailsJsonl(
      [
        JSON.stringify({ email_id: "junk-1", is_junk: true }),
        JSON.stringify({ email_id: "junk-2", is_junk: true }),
        JSON.stringify({ email_id: "real-1", is_junk: false }),
      ].join("\n") + "\n",
    );
    const result = scoreEmailDecisions(golden, [
      { email_id: "junk-1", created: true },
      { email_id: "junk-2", created: false },
      { email_id: "real-1", created: true },
      { email_id: "unknown", created: true },
    ]);
    expect(result).toEqual({
      total: 3,
      junkTotal: 2,
      falseCreations: 1,
      falseCreationIds: ["junk-1"],
    });
  });

  it("scores a clean run at zero", () => {
    const golden = parseGoldenEmailsJsonl(
      `${JSON.stringify({ email_id: "junk-1", is_junk: true })}\n`,
    );
    const result = scoreEmailDecisions(golden, [
      { email_id: "junk-1", created: false },
    ]);
    expect(result.falseCreations).toBe(0);
    expect(result.falseCreationIds).toEqual([]);
  });
});
