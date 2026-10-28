import { describe, expect, it } from "vitest";
import type { Fetcher } from "../src/ingest/fetcher";
import { extractMatchingLinks, fetchIndexPages } from "../src/ingest/linkindex";

describe("link index", () => {
  it("extracts matching same-host links without duplicates", () => {
    const links = extractMatchingLinks(
      "https://example.test/index",
      `<a href="/events/a">a</a><a href="https://example.test/events/b">b</a>` +
        `<a href="https://other.test/events/c">c</a><a href="/about">d</a>` +
        `<a href="/events/a">a2</a>`,
      "/events/",
    );
    expect(links).toEqual([
      "https://example.test/events/a",
      "https://example.test/events/b",
    ]);
  });

  it("rejects invalid patterns", () => {
    expect(() =>
      extractMatchingLinks("https://example.test/", "", "(["),
    ).toThrow("invalid linkPattern");
  });

  it("includes subdomains only when allowed", () => {
    const html = `<a href="https://sub.example.test/e/a">a</a><a href="https://other.test/e/b">b</a>`;
    expect(
      extractMatchingLinks("https://example.test/index", html, "/e/"),
    ).toEqual([]);
    expect(
      extractMatchingLinks("https://example.test/index", html, "/e/", {
        allowSubdomains: true,
      }),
    ).toEqual(["https://sub.example.test/e/a"]);
  });

  it("fetches extra pages by template and skips failures", async () => {
    const seen: string[] = [];
    const fetcher = {
      fetchText: (url: string) => {
        seen.push(url);
        if (url.endsWith("page=2")) {
          return Promise.reject(new Error("HTTP 500"));
        }
        return Promise.resolve({
          status: 200,
          url,
          text: `body of ${url}`,
          notModified: false,
        });
      },
    } as unknown as Fetcher;
    const pages = await fetchIndexPages(fetcher, "https://example.test/index", {
      template: "https://example.test/index?page={n}",
      from: 1,
      to: 3,
    });
    expect(seen).toEqual([
      "https://example.test/index",
      "https://example.test/index?page=1",
      "https://example.test/index?page=2",
      "https://example.test/index?page=3",
    ]);
    expect(pages.map((p) => p.url)).toEqual([
      "https://example.test/index",
      "https://example.test/index?page=1",
      "https://example.test/index?page=3",
    ]);
  });
});
