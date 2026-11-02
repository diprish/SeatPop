import {
  DAY_PARTS,
  WEEKDAYS,
  type AgeBand,
  type DayPart,
  type Preferences,
  type Weekday,
} from "@seatpop/shared";
import {
  hueForBand,
  hueForDayPart,
  type Hue,
} from "../components/ui/hue";

/**
 * Household sentence (For-you 2c): plain-code phrases from the current
 * prefs — no model call. Segments alternate literal text with hue pills
 * that open the matching filter control. Clauses vanish when unset.
 */

export type SentencePillTarget =
  | "members"
  | "distance"
  | "budget"
  | "availability";

export type SentenceSegment =
  | { kind: "text"; text: string }
  | {
      kind: "pill";
      text: string;
      hue: Hue;
      target: SentencePillTarget;
      band?: AgeBand;
    };

const MEMBER_PHRASE: Record<AgeBand, string> = {
  baby: "a baby",
  preschool: "a preschooler",
  kids: "a 6–12 kid",
  teens: "a teen",
  adults: "an adult",
  seniors: "a senior",
};

const DAY_FULL: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const DAY_SHORT: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

function joinText(items: string[], separator: string, last: string): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(separator)}${last}${items[items.length - 1] as string}`;
}

function joinSegments(
  items: SentenceSegment[],
  separator: string,
  last: string,
): SentenceSegment[] {
  if (items.length <= 1) return items;
  const out: SentenceSegment[] = [];
  items.forEach((item, index) => {
    if (index > 0) {
      out.push({
        kind: "text",
        text: index === items.length - 1 ? last : separator,
      });
    }
    out.push(item);
  });
  return out;
}

function dollars(cents: number): string {
  const value = cents / 100;
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function daysLabel(days: Weekday[]): string {
  const set = new Set(days);
  if (days.length === 7) return "daily";
  if (days.length === 2 && set.has("sat") && set.has("sun")) return "weekend";
  const weekdays: Weekday[] = ["mon", "tue", "wed", "thu", "fri"];
  if (days.length === 5 && weekdays.every((day) => set.has(day))) {
    return "weekday";
  }
  if (days.length === 1) return DAY_FULL[days[0] as Weekday];
  return joinText(
    days.map((day) => DAY_SHORT[day]),
    ", ",
    " and ",
  );
}

/** Availability clause pills (no "free on" prefix): one pill per day-group part. */
function availabilitySegments(
  availability: Preferences["availability"],
): SentenceSegment[] {
  if (!availability) return [];
  const days = WEEKDAYS.filter(
    (day) => (availability[day]?.length ?? 0) > 0,
  );
  if (days.length === 0) return [];
  const partsOf = (day: Weekday): DayPart[] =>
    [...(availability[day] ?? [])].sort(
      (a, b) => DAY_PARTS.indexOf(a) - DAY_PARTS.indexOf(b),
    );
  // Whole-week whole-day coverage filters nothing: read as unset.
  if (
    days.length === 7 &&
    days.every((day) => partsOf(day).length === DAY_PARTS.length)
  ) {
    return [];
  }
  const groups = new Map<string, { days: Weekday[]; parts: DayPart[] }>();
  for (const day of days) {
    const parts = partsOf(day);
    const group = groups.get(parts.join(","));
    if (group) group.days.push(day);
    else groups.set(parts.join(","), { days: [day], parts });
  }
  const out: SentenceSegment[] = [];
  for (const { days: groupDays, parts } of groups.values()) {
    if (out.length > 0) out.push({ kind: "text", text: "; " });
    const label = daysLabel(groupDays);
    parts.forEach((part, index) => {
      if (index > 0) out.push({ kind: "text", text: " and " });
      out.push({
        kind: "pill",
        text: `${label} ${part}s`,
        hue: hueForDayPart(part),
        target: "availability",
      });
    });
  }
  return out;
}

function budgetPill(prefs: Preferences): SentenceSegment | null {
  if (prefs.free_only) {
    return { kind: "pill", text: "spending nothing", hue: "mint", target: "budget" };
  }
  if (prefs.max_price_cents === undefined) return null;
  return {
    kind: "pill",
    text: `spending under ${dollars(prefs.max_price_cents)}`,
    hue: "mint",
    target: "budget",
  };
}

function distancePill(prefs: Preferences): SentenceSegment | null {
  const km = prefs.max_distance_km;
  const fsa = prefs.fsa;
  if (km === undefined && fsa === undefined) return null;
  const text =
    km !== undefined && fsa !== undefined
      ? `within ${km} km of ${fsa}`
      : fsa !== undefined
        ? `near ${fsa}`
        : `within ${km as number} km`;
  return { kind: "pill", text, hue: "sky", target: "distance" };
}

export function buildSentence(prefs: Preferences): SentenceSegment[] {
  const members = prefs.members.map(
    (member): SentenceSegment => ({
      kind: "pill",
      text: MEMBER_PHRASE[member.age_band],
      hue: hueForBand(member.age_band),
      target: "members",
      band: member.age_band,
    }),
  );
  const clauses: SentenceSegment[][] = [];
  const availability = availabilitySegments(prefs.availability);
  if (availability.length > 0) {
    clauses.push([{ kind: "text", text: "free on " }, ...availability]);
  }
  const budget = budgetPill(prefs);
  if (budget) clauses.push([budget]);
  const distance = distancePill(prefs);
  if (distance) clauses.push([distance]);
  if (members.length === 0 && clauses.length === 0) {
    return [{ kind: "text", text: "Tell us who's coming to get picks." }];
  }
  const out: SentenceSegment[] = [{ kind: "text", text: "We're " }];
  out.push(...joinSegments(members, ", ", " and "));
  for (const clause of clauses) {
    if (out.length > 1) out.push({ kind: "text", text: ", " });
    out.push(...clause);
  }
  out.push({ kind: "text", text: "." });
  return out;
}

/** Plain-text rendering (tests, previews). */
export function sentenceText(prefs: Preferences): string {
  return buildSentence(prefs)
    .map((segment) => segment.text)
    .join("");
}
