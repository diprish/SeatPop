import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { visibleText } from "../src/ingest/html";

const FIXTURE = new URL("./fixtures/page.html", import.meta.url);

describe("html adapter", () => {
  it("extracts visible text without scripts, styles or comments", () => {
    const text = visibleText(readFileSync(FIXTURE, "utf8"));
    expect(text).toContain("Community Fair");
    expect(text).toContain("games & food");
    expect(text).not.toContain("tracking");
    expect(text).not.toContain("color: red");
    expect(text).not.toContain("a comment");
  });
});
