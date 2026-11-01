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

const THUMB_CLASS =
  "min-touch rounded-full border px-3 text-sm disabled:opacity-40";

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

  function thumbClass(pressed: boolean): string {
    return pressed
      ? `${THUMB_CLASS} border-primary bg-primary/10 font-semibold`
      : `${THUMB_CLASS} border-line`;
  }

  return (
    <div className="mt-2">
      <p className="text-sm font-semibold">Worth it?</p>
      {summary === undefined && !loadFailed && (
        <p
          role="status"
          className="mt-1 text-sm text-muted"
        >
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
          {summary === null
            ? "Be the first to say if it was worth it"
            : worthLine(summary)}
        </p>
      )}
      <div
        role="group"
        aria-label="Cast your vote"
        className="mt-1 flex flex-wrap gap-2"
      >
        <button
          type="button"
          aria-pressed={myVote === 1}
          aria-label={`Worth it: ${title}`}
          disabled={busy}
          onClick={() => void vote(1, tags)}
          className={thumbClass(myVote === 1)}
        >
          👍 Worth it
        </button>
        <button
          type="button"
          aria-pressed={myVote === -1}
          aria-label={`Not worth it: ${title}`}
          disabled={busy}
          onClick={() => void vote(-1, tags)}
          className={thumbClass(myVote === -1)}
        >
          👎 Not worth it
        </button>
        <button
          type="button"
          aria-expanded={tagsOpen}
          onClick={() => setTagsOpen((open) => !open)}
          className={`${THUMB_CLASS} border-line`}
        >
          Tags{tags.length > 0 ? ` (${tags.length})` : ""}…
        </button>
      </div>
      {tagsOpen && (
        <div
          role="group"
          aria-label="Vote tags"
          className="mt-2 flex flex-wrap gap-2"
        >
          {VOTE_TAGS.map((tag) => {
            const pressed = tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={pressed}
                disabled={busy}
                onClick={() => toggleTag(tag)}
                className={
                  pressed
                    ? `${THUMB_CLASS} border-primary bg-primary/10 text-sm font-semibold`
                    : `${THUMB_CLASS} border-line text-sm`
                }
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}
      {voteError !== "" && (
        <p
          role="alert"
          className="mt-1 text-sm text-red-700 dark:text-red-300"
        >
          {voteError}
        </p>
      )}
    </div>
  );
}
