import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RegistrationWindowsFileSchema,
  RegistrationWindowSchema,
} from "../src/registration-windows";

const SEED_URL = new URL(
  "../../../data/seed/city-registration-dates.json",
  import.meta.url,
);

const VALID_WINDOW = {
  scope: "test-scope",
  kind: "test-kind",
  opens_at: "2026-12-01T07:00:00-05:00",
  quote: "Registration opens December 1 at 7 am.",
  source_url: "https://example.test/city/registration",
};

describe("registration windows seed", () => {
  it("validates the committed seed file (windows may be empty)", () => {
    const parsed: unknown = JSON.parse(readFileSync(SEED_URL, "utf8"));
    const result = RegistrationWindowsFileSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it("accepts a well-formed window", () => {
    expect(RegistrationWindowSchema.safeParse(VALID_WINDOW).success).toBe(true);
  });

  it("rejects an unparseable opens_at", () => {
    const result = RegistrationWindowSchema.safeParse({
      ...VALID_WINDOW,
      opens_at: "someday soon",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-https source_url", () => {
    const result = RegistrationWindowSchema.safeParse({
      ...VALID_WINDOW,
      source_url: "http://example.test/city/registration",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty quote", () => {
    const result = RegistrationWindowSchema.safeParse({
      ...VALID_WINDOW,
      quote: "",
    });
    expect(result.success).toBe(false);
  });
});
