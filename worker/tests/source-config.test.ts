import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  optionsForSource,
  validateSourceOptions,
} from "../src/ingest/source-config";

const seeds = JSON.parse(
  readFileSync(new URL("../src/ingest/sources.json", import.meta.url), "utf8"),
) as Array<{ name: string }>;

describe("source config", () => {
  it("validates every entry", () => {
    expect(() => validateSourceOptions()).not.toThrow();
  });

  it("covers every seeded source with a default category", () => {
    expect(seeds.length).toBeGreaterThan(0);
    for (const seed of seeds) {
      expect(
        optionsForSource(seed.name).category,
        `missing category for ${seed.name}`,
      ).toBeDefined();
    }
  });

  it("flags no-ToU sources for the no-training route only", () => {
    for (const name of [
      "Dovercourt Recreation",
      "Ottawa Public Library",
      "Ottawa Public Library (Baby)",
      "Ottawa Art Gallery",
      "Ottawa Farmers' Market",
      "Great Canadian Theatre Company",
      "Ottawa Chamberfest",
      "Ottawa Little Theatre",
      "Diefenbunker",
    ]) {
      expect(optionsForSource(name).noTrainingRoute, name).toBe(true);
    }
    // Federal copyright terms found: Meta-hosted models stay allowed.
    for (const name of [
      "Canadian Museum of Nature",
      "Canadian War Museum",
      "Canadian Museum of History",
    ]) {
      expect(optionsForSource(name).noTrainingRoute, name).toBeUndefined();
    }
  });
});
