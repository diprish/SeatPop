import { describe, expect, it } from "vitest";
import { planDescriptionClean } from "../src/clean-descriptions/plan";

describe("planDescriptionClean", () => {
  it("flags only rows whose text changes", () => {
    const updates = planDescriptionClean([
      { id: "clean", description: "Already clean text." },
      { id: "null", description: null },
      { id: "dirty", description: "treats.Friday &amp; fun" },
    ]);
    expect(updates).toEqual([
      {
        id: "dirty",
        before: "treats.Friday &amp; fun",
        after: "treats. Friday & fun",
      },
    ]);
  });

  it("plans nothing for an already-clean store (idempotent)", () => {
    const rows = [
      { id: "a", description: "Plain text." },
      { id: "b", description: null },
    ];
    expect(planDescriptionClean(rows)).toEqual([]);
    // And its own output never re-plans.
    const once = planDescriptionClean([
      { id: "a", description: "x.&nbsp;y" },
    ]);
    expect(once).toHaveLength(1);
    const after = (once[0] as { after: string }).after;
    expect(planDescriptionClean([{ id: "a", description: after }])).toEqual(
      [],
    );
  });
});
