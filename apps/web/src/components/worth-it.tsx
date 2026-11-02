"use client";

import { useEffect, useState } from "react";
import {
  castVote,
  fetchVotesSummary,
  getMyVote,
  setMyVote,
  VOTE_TAGS,
  type VotesSummary,
} from "@/lib/votes";
import { Badge } from "./ui/Badge";
import { Chip } from "./ui/Chip";

/**
 * Worth-it control, shared by event cards and the detail page: thumbs
 * up/down plus optional fixed-vocabulary tag chips. Counts render only
 * from the API summary (hidden below 3 votes server-side) — never
 * placeholders. Re-votes update the same series row.
 */

function worthLine(summary: VotesSummary): string {
  if (summary.up === 0) return "No parents say it's worth it yet";
  return summary.up === 1
    ? "1 parent says it's worth it"
    : `${summary.up} parents say it's worth it`;
}

export default function WorthIt({
  eventId,
  title,
}: {
  eventId: string;
  title: string;
}) {
  const [summary, setSummary] = useState<VotesSummary | null | undefined>(
    undefined,
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [myVote, setMyVoteState] = useState<1 | -1 | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voteError, setVoteError] = useState("");

  useEffect(() => {
    setMyVoteState(getMyVote(eventId));
    setSummary(undefined);
    setLoadFailed(false);
    fetchVotesSummary(eventId).then(
      (loaded) => setSummary(loaded),
      () => setLoadFailed(true),
    );
  }, [eventId]);

  async function vote(direction: 1 | -1, nextTags: string[]): Promise<void> {
    setBusy(true);
    setVoteError("");
    try {
      await castVote(eventId, direction, nextTags);
      setMyVote(eventId, direction);
      setMyVoteState(direction);
      setSummary(await fetchVotesSummary(eventId));
      setLoadFailed(false);
    } catch (error) {
      setVoteError(error instanceof Error ? error.message : "vote failed");
    } finally {
      setBusy(false);
    }
  }

  function toggleTag(tag: string): void {
    const next = tags.includes(tag)
      ? tags.filter((current) => current !== tag)
      : [...tags, tag];
    setTags(next);
    // Tags stage until the first vote, then save on every toggle.
    if (myVote !== null && !busy) void vote(myVote, next);
  }

  return (
    <div className="mt-3">
      <p className="text-sm font-bold">Worth it?</p>
      {summary === undefined && !loadFailed && (
        <p role="status" className="mt-1 text-sm text-muted">
          Loading votes…
        </p>
      )}
      {loadFailed && (
        <p className="mt-1 text-sm text-muted">
          Couldn&apos;t load votes.{" "}
          <button
            type="button"
            onClick={() => {
              setLoadFailed(false);
              setSummary(undefined);
              fetchVotesSummary(eventId).then(
                (loaded) => setSummary(loaded),
                () => setLoadFailed(true),
              );
            }}
            className="underline"
          >
            Retry
          </button>
        </p>
      )}
      {summary !== undefined && !loadFailed && (
        <p className="mt-1 text-sm text-muted">
          {summary === null ? "Be the first to say if it was worth it" : worthLine(summary)}
        </p>
      )}
      <div role="group" aria-label="Cast your vote" className="mt-2 flex flex-wrap gap-2">
        <Chip
          hue="mint"
          size="sm"
          selected={myVote === 1}
          aria-label={`Worth it: ${title}`}
          disabled={busy}
          onClick={() => void vote(1, tags)}
        >
          👍 Worth it
          {summary !== undefined && summary !== null && (
            <Badge tone="neutral">{summary.up}</Badge>
          )}
        </Chip>
        <Chip
          hue="mint"
          size="sm"
          selected={myVote === -1}
          aria-label={`Not worth it: ${title}`}
          disabled={busy}
          onClick={() => void vote(-1, tags)}
        >
          👎 Not worth it
          {summary !== undefined && summary !== null && (
            <Badge tone="neutral">{summary.down}</Badge>
          )}
        </Chip>
        <button
          type="button"
          aria-expanded={tagsOpen}
          onClick={() => setTagsOpen((open) => !open)}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border-2 border-line px-4 text-sm font-semibold transition-colors duration-200 motion-reduce:transition-none"
        >
          Tags{tags.length > 0 ? ` (${tags.length})` : ""}…
        </button>
      </div>
      {tagsOpen && (
        <div role="group" aria-label="Vote tags" className="mt-2 flex flex-wrap gap-2">
          {VOTE_TAGS.map((tag) => (
            <Chip
              key={tag}
              hue="mint"
              size="sm"
              selected={tags.includes(tag)}
              disabled={busy}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </Chip>
          ))}
        </div>
      )}
      {voteError !== "" && (
        <p role="alert" className="mt-1 text-sm font-semibold text-blush-ink">
          {voteError}
        </p>
      )}
    </div>
  );
}
