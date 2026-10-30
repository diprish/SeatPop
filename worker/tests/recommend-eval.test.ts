import { describe, expect, it } from "vitest";
import { parseWonderGrades } from "../src/recommend/eval-run";

describe("wonder grade parsing", () => {
  it("parses grades for every candidate id", () => {
    const grades = parseWonderGrades(
      JSON.stringify([
        { event_id: "e1", relevance: 3 },
        { event_id: "e2", relevance: 0 },
      ]),
      new Set(["e1", "e2"]),
    );
    expect(grades).toEqual(
      new Map([
        ["e1", 3],
        ["e2", 0],
      ]),
    );
  });

  it("discards unknown ids and keeps first grades on duplicates", () => {
    const grades = parseWonderGrades(
      `[{"event_id": "e1", "relevance": 2}, {"event_id": "zzz", "relevance": 3}, {"event_id": "e1", "relevance": 0}]`,
      new Set(["e1"]),
    );
    expect(grades).toEqual(new Map([["e1", 2]]));
  });

  it("throws on missing ids, bad rows, and non-JSON", () => {
    expect(() =>
      parseWonderGrades(JSON.stringify([{ event_id: "e1", relevance: 2 }]), new Set(["e1", "e2"])),
    ).toThrow(/ungraded/);
    expect(() =>
      parseWonderGrades(JSON.stringify([{ event_id: "e1", relevance: 5 }]), new Set(["e1"])),
    ).toThrow(/validation/);
    expect(() => parseWonderGrades("no grades here", new Set(["e1"]))).toThrow(
      /array/,
    );
  });
});
