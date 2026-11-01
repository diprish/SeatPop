import { branchOf } from "@seatpop/shared";
import { normalizeTitle } from "../ingest/dedupe";

/**
 * Series collapse (worker/recommend): one card per recurring event.
 *
 * Rows sharing a normalized title and venue collapse into a single slot
 * when their dates form a weekly or regular pattern. The slot ranks at
 * its best member's scored position but displays the next (soonest)
 * occurrence plus "+N more dates". One series occupies one top-10 slot.
 *
 * Hard constraints stay per-occurrence: grouping only ever sees SQL
 * candidates, every one of which already passed the time-window filter
 * (and the rest) on its own date. Grouping never pulls in, invents, or
 * hides an occurrence — output rows are always a subset of the input.
 */

export interface SeriesRow {
  event_id: string;
  title: string;
  starts_at: string;
  venue_name: string | null;
}

export interface SeriesSlot<T> {
  /** Displayed occurrence: the soonest. */
  row: T;
  /** Later occurrences, soonest first (empty for singles). */
  more: T[];
}

/** Series identity: normalized title + normalized full venue name. */
export function seriesKey(row: SeriesRow): string {
  return [
    normalizeTitle(row.title),
    normalizeTitle(row.venue_name ?? ""),
  ].join("|");
}

/**
 * Vote identity: normalized title + normalized venue BRANCH (rooms of
 * one branch vote as one series). Venue-less events key on the title
 * alone. Pure (tested); the votes API derives it server-side from the
 * event row so clients never construct keys.
 */
export function voteSeriesKey(
  title: string,
  venueName: string | null,
): string {
  return [normalizeTitle(title), normalizeTitle(branchOf(venueName))].join(
    "|",
  );
}

const DAY_MS = 86_400_000;

function gapDays(earlier: string, later: string): number | null {
  const ms = new Date(later).getTime() - new Date(earlier).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  // Rounded: DST transitions make weekly gaps 7 days ± an hour.
  return Math.round(ms / DAY_MS);
}

/**
 * Weekly or regular cadence over time-sorted starts. Pairs need a 6–8
 * day gap (one interval proves nothing else); 3+ need all gaps in 6–8
 * days (weekly) or all gaps equal in whole days (daily, biweekly…).
 * Anything else — random one-offs sharing a title — stays ungrouped.
 */
export function hasSeriesPattern(sortedStarts: string[]): boolean {
  if (sortedStarts.length < 2) return false;
  const gaps: number[] = [];
  for (let i = 1; i < sortedStarts.length; i++) {
    const gap = gapDays(
      sortedStarts[i - 1] as string,
      sortedStarts[i] as string,
    );
    if (gap === null) return false;
    gaps.push(gap);
  }
  if (gaps.length === 1) {
    const only = gaps[0] as number;
    return only >= 6 && only <= 8;
  }
  if (gaps.every((gap) => gap >= 6 && gap <= 8)) return true;
  return gaps.every((gap) => gap === gaps[0]);
}

/**
 * Title family: the first word of the normalized title, ignoring
 * variant suffixes ("Babytime", "Babytime & Stay and Play", and
 * "Babytime followed by a Play and Stay" are one family). Series
 * collapse already merges identical titles; this is about
 * similar-title variants that would otherwise stack in the top 10.
 * First-word grouping also merges distinct programs sharing a lead
 * word ("Lego Club" / "Lego Robotics") — spreading those apart still
 * serves a varied top 10, so the rule keeps them together.
 */
export function titleFamily(title: string): string {
  const cut = [" & ", " | ", " / ", " - ", " (", ": "]
    .map((sep) => title.indexOf(sep))
    .filter((index) => index > 0);
  const head = cut.length > 0 ? title.slice(0, Math.min(...cut)) : title;
  return normalizeTitle(head).split(" ")[0] ?? "";
}

/** True when inserting key at index completes a run longer than maxRun. */
function completesRun(
  keys: string[],
  index: number,
  key: string,
  maxRun: number,
): boolean {
  let left = 0;
  for (let i = index - 1; i >= 0 && keys[i] === key; i--) left++;
  let right = 0;
  for (let i = index; i < keys.length && keys[i] === key; i++) right++;
  return left + 1 + right > maxRun;
}

/**
 * Cap consecutive same-family items at maxRun (default 2), stable:
 * items that would overrun sink to the earliest gap at or after their
 * original rank that takes them without completing a run. Idempotent —
 * an already-diverse list passes through untouched. Degrades
 * gracefully when one family owns the list (leftovers append in
 * order, runs and all).
 */
export function limitConsecutiveRuns<T>(
  items: T[],
  keyOf: (item: T) => string,
  maxRun = 2,
): T[] {
  const out: T[] = [];
  const outKeys: string[] = [];
  const pending: Array<{ item: T; from: number }> = [];
  for (const item of items) {
    const key = keyOf(item);
    if (completesRun(outKeys, outKeys.length, key, maxRun)) {
      pending.push({ item, from: out.length });
    } else {
      out.push(item);
      outKeys.push(key);
    }
  }
  for (const { item, from } of pending) {
    const key = keyOf(item);
    let placed = false;
    for (let index = from; index <= outKeys.length; index++) {
      if (!completesRun(outKeys, index, key, maxRun)) {
        out.splice(index, 0, item);
        outKeys.splice(index, 0, key);
        placed = true;
        break;
      }
    }
    if (!placed) {
      out.push(item);
      outKeys.push(key);
    }
  }
  return out;
}

/**
 * Group scored rows (twins-collapsed) into series slots. Multi-member
 * groups occupy consecutive slots from their first-seen (best-scored)
 * position; members without a cadence return as singles there.
 */
export function groupSeries<T extends SeriesRow>(
  rows: T[],
): Array<SeriesSlot<T>> {
  const groups = new Map<string, { first: number; members: T[] }>();
  rows.forEach((row, index) => {
    const key = seriesKey(row);
    const group = groups.get(key);
    if (group) group.members.push(row);
    else groups.set(key, { first: index, members: [row] });
  });
  const ordered = [...groups.values()].sort((a, b) => a.first - b.first);
  const slots: Array<SeriesSlot<T>> = [];
  for (const group of ordered) {
    if (group.members.length < 2) {
      slots.push({ row: group.members[0] as T, more: [] });
      continue;
    }
    const byTime = [...group.members].sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
    );
    if (!hasSeriesPattern(byTime.map((member) => member.starts_at))) {
      for (const member of group.members) {
        slots.push({ row: member, more: [] });
      }
      continue;
    }
    const [next, ...rest] = byTime;
    slots.push({ row: next as T, more: rest });
  }
  return slots;
}
