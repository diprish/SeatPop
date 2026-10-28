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
});
