import { describe, expect, it } from "vitest";
import {
  EMBED_DIMS,
  embedTextFor,
  localEmbed,
  startsWithinDays,
  toVectorLiteral,
} from "../src/enrich/embed";

const NOW = Date.parse("2026-10-28T12:00:00.000Z");

describe("enrich embeddings", () => {
  it("embeds summary plus tags, title as fallback", () => {
    expect(embedTextFor("Craft hour. ", ["crafts", "kids"], "Title")).toBe(
      "Craft hour. crafts kids",
    );
    expect(embedTextFor(null, ["music"], "Winter Concert")).toBe(
      "Winter Concert music",
    );
    expect(embedTextFor("  ", [], "Winter Concert")).toBe("Winter Concert");
  });

  it("gates the 30-day start window", () => {
    expect(startsWithinDays("2026-11-21T00:00:00.000Z", NOW)).toBe(true);
    expect(startsWithinDays("2026-11-27T12:00:00.000Z", NOW)).toBe(true);
    expect(startsWithinDays("2026-11-28T12:00:00.001Z", NOW)).toBe(false);
    expect(startsWithinDays("2026-10-27T12:00:00.000Z", NOW)).toBe(false);
    expect(startsWithinDays("not a date", NOW)).toBe(false);
  });

  it("formats pgvector literals and rejects wrong dims", () => {
    const vec = new Array<number>(EMBED_DIMS).fill(0.5);
    const literal = toVectorLiteral(vec);
    expect(literal.startsWith("[0.5,0.5")).toBe(true);
    expect(literal.endsWith("]")).toBe(true);
    expect(() => toVectorLiteral([0.1, 0.2])).toThrow(/384/);
    expect(() =>
      toVectorLiteral(new Array<number>(EMBED_DIMS).fill(Number.NaN)),
    ).toThrow(/384/);
  });

  it("returns empty for empty input without loading the model", async () => {
    const vectors = await localEmbed([], async () => {
      throw new Error("must not be called");
    });
    expect(vectors).toEqual([]);
  });

  it("delegates batches to an injected embedder", async () => {
    const seen: string[][] = [];
    const vectors = await localEmbed(["a", "b"], async (texts) => {
      seen.push(texts);
      return texts.map(() => new Array<number>(EMBED_DIMS).fill(0));
    });
    expect(vectors).toHaveLength(2);
    expect(seen).toEqual([["a", "b"]]);
  });
});
