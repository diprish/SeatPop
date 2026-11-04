import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the /about page (this repo has no DOM test
// harness): one h1, the three pillar headings, honest model and limits
// copy, and every link resolving to a real route or an https URL.
const ABOUT = readFileSync(
  new URL("../src/app/about/page.tsx", import.meta.url),
  "utf8",
);
const FOOTER = readFileSync(
  new URL("../src/components/site-footer.tsx", import.meta.url),
  "utf8",
);
const HOME = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");

function hrefs(src: string): string[] {
  const found: string[] = [];
  for (const match of src.matchAll(/href="([^"]+)"/g)) {
    found.push(match[1]);
  }
  return found;
}

// True when an internal href maps onto a page under src/app,
// following [param] segments for dynamic routes.
function routeExists(href: string): boolean {
  const segments = href.split("/").filter((part) => part !== "");
  let dir = new URL("../src/app/", import.meta.url);
  for (const segment of segments) {
    const entries = new Set(readdirSync(dir));
    if (entries.has(segment)) {
      dir = new URL(`./${segment}/`, dir);
      continue;
    }
    const dynamic = [...entries].find(
      (entry) => entry.startsWith("[") && entry.endsWith("]"),
    );
    if (!dynamic) return false;
    dir = new URL(`./${dynamic}/`, dir);
  }
  return existsSync(new URL("./page.tsx", dir));
}

describe("about page markup", () => {
  it("mounts one h1 with the subhead and metadata title", () => {
    expect(ABOUT).toContain("<h1");
    expect(ABOUT.match(/<h1/g)).toHaveLength(1);
    expect(ABOUT).toContain("How SeatPop works");
    // The subhead wraps one source line; JSX renders it as one sentence.
    expect(ABOUT).toContain(
      "Activities for every age in your household, matched to each person",
    );
    expect(ABOUT).toContain("and checked against the listing.");
    expect(ABOUT).toContain('title: "How it works"');
  });

  it("keeps the three pillar headings", () => {
    for (const title of [
      "We check every fact against the listing",
      "Your limits are rules, not suggestions",
      "See why we picked it",
    ]) {
      expect(ABOUT).toContain(title);
    }
  });

  it("keeps the try-it steps, model rows, and honest limits", () => {
    expect(ABOUT).toContain("Try it in 30 seconds");
    expect(ABOUT).toContain("Open the sample household");
    for (const name of [
      "muse-spark-1.3-contributor",
      "meta-models/muse-spark-open-1026",
      "muse-spark-1.3",
      "muse-wonder-1.0",
    ]) {
      expect(ABOUT).toContain(name);
    }
    expect(ABOUT).toContain("Baseten · public text only");
    expect(ABOUT).toContain("Meta Model API");
    expect(ABOUT).toContain("Under the hood");
    expect(ABOUT).toContain("<details");
    expect(ABOUT).toContain("Mostly library programs, plus a few City recreation");
    expect(ABOUT).toContain("entered by hand");
    expect(ABOUT).toContain("See the measured accuracy");
    expect(ABOUT).toContain("Only age groups, never names");
  });

  it("links every href to a real route or an https URL", () => {
    const links = hrefs(ABOUT);
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      if (href.startsWith("https://")) continue;
      expect(href.startsWith("/")).toBe(true);
      expect(routeExists(href)).toBe(true);
    }
  });

  it("links the footer and the home hero to /about", () => {
    expect(FOOTER).toContain('href="/about"');
    expect(FOOTER).toContain("How it works");
    expect(HOME).toContain('href="/about"');
    expect(HOME).toContain("New here?");
    expect(HOME).toContain("See how it works");
  });
});
