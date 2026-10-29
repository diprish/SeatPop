import { describe, expect, it } from "vitest";
import {
  ENRICHED_FIELDS,
  ENRICH_PROMPT_VERSION,
  ENRICH_TEMPERATURE,
  EnrichmentOutputSchema,
  buildEnrichmentMessages,
  loadEnrichPrompt,
} from "../src/enrichment";

describe("enrichment prompt", () => {
  it("loads the versioned prompt with the free rule", () => {
    expect(ENRICH_PROMPT_VERSION).toBe("enrich.v2");
    expect(ENRICH_TEMPERATURE).toBe(0.3);
    const prompt = loadEnrichPrompt();
    expect(prompt).toContain("enrich.v2");
    expect(prompt).toContain("free");
    expect(prompt).toContain("no charge");
    expect(prompt).toContain("Never infer");
  });

  it("builds deterministic messages per event, date and pass", () => {
    const input = {
      title: "Winter Concert",
      description: "Music.",
      venueName: "Grand Hall",
      today: "2026-10-28",
      pass: 1,
    };
    const messages = buildEnrichmentMessages(input);
    expect(messages).toEqual(buildEnrichmentMessages(input));
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("VOTING PASS: 1");
    // Venue name travels; the street address has no parameter to travel in.
    expect(messages[1].content).toContain("VENUE: Grand Hall");
    const pass2 = buildEnrichmentMessages({ ...input, pass: 2 });
    expect(pass2[1].content).toContain("VOTING PASS: 2");
    expect(pass2).not.toEqual(messages);
  });

  it("covers 17 extracted fields and strips unknown keys", () => {
    expect(ENRICHED_FIELDS).toHaveLength(17);
    expect(ENRICHED_FIELDS).toContain("price_kind");
    const parsed = EnrichmentOutputSchema.safeParse({
      price_kind: { value: "free", quote: "Admission is free." },
      is_free: true,
      ages: "all",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("is_free" in parsed.data).toBe(false);
      expect("ages" in parsed.data).toBe(false);
      expect(parsed.data.price_kind?.value).toBe("free");
    }
  });
});
