import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractPageLinks, visibleText } from "../src/ingest/html";

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

  it("extracts same-host anchor links with text, skipping the rest", () => {
    const links = extractPageLinks(
      [
        '<a href="/winter"><b>Winter</b> Concert</a>',
        '<a href="https://example.test/summer?x=1">Summer</a>',
        '<a href="/winter">Winter Concert</a>',
        '<a href="https://other.test/x">Elsewhere</a>',
        '<a href="mailto:a@example.test">Mail</a>',
        '<a href="#top">Top</a>',
      ].join(" "),
      "https://example.test/whats-on",
    );
    expect(links).toEqual([
      { text: "Winter Concert", url: "https://example.test/winter" },
      { text: "Summer", url: "https://example.test/summer?x=1" },
    ]);
  });
});
