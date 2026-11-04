import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Static pins for the Worth-it control and its two hosts. */

const control = readFileSync(
  new URL("../src/components/worth-it.tsx", import.meta.url),
  "utf8",
);
const card = readFileSync(
  new URL("../src/components/event-card.tsx", import.meta.url),
  "utf8",
);
const detail = readFileSync(
  new URL("../src/app/events/[id]/page.tsx", import.meta.url),
  "utf8",
);

describe("worth-it control", () => {
  it("renders thumbs with pressed state and honest count lines", () => {
    expect(control).toContain("selected={myVote === 1}");
    expect(control).toContain("selected={myVote === -1}");
    expect(control).toContain("Been before? Was it worth it?");
    expect(control).toContain("parents say it's worth it");
    expect(control).toContain("Be the first to vote");
  });

  it("pills the votes in mint with count badges", () => {
    expect(control).toContain('hue="mint"');
    expect(control).toContain("<Badge tone=\"neutral\">{summary.up}</Badge>");
    expect(control).toContain("<Badge tone=\"neutral\">{summary.down}</Badge>");
    expect(control).toContain("Worth it: ${title}");
    expect(control).toContain("Not worth it: ${title}");
  });

  it("offers the fixed tag chips with no free-text input", () => {
    expect(control).toContain("VOTE_TAGS.map");
    expect(control).not.toContain("<textarea");
    expect(control).not.toContain("<input");
  });

  it("loads, votes, and retries through the votes API only", () => {
    expect(control).toContain("fetchVotesSummary(eventId)");
    expect(control).toContain("castVote(eventId, direction, nextTags)");
    expect(control).toContain("Retry");
  });

  it("lives on both the card and the detail page", () => {
    expect(card).toContain("<WorthIt eventId={item.event_id}");
    expect(detail).toContain("<WorthIt eventId={detail.id}");
  });
});
