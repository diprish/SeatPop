import {
  DAY_PARTS,
  fitLevelsForHousehold,
  hourInPart,
  type AgeBand,
  type DayPart,
  type Preferences,
} from "@seatpop/shared";
import type { EventDetailView, RecommendItemView } from "./api";
import { isPolicyPrice, priceBadgeLabel } from "./format";

/**
 * "Why this?" rows: each matched field with its value and, when the
 * detail payload is loaded, the verbatim evidence quote behind it.
 * Client-safe and fully tested; every row states only what the data
 * says (a null detail simply yields null quotes).
 */

export interface WhyRow {
  field: string;
  detail: string;
  quote: string | null;
}

function quoteFor(
  detail: EventDetailView | null,
  ...fields: string[]
): string | null {
  if (!detail?.evidence) return null;
  for (const field of fields) {
    const quote = detail.evidence[field]?.quote;
    if (quote) return quote;
  }
  return null;
}

function capitalize(word: string): string {
  return word.slice(0, 1).toUpperCase() + word.slice(1);
}

function eventWeekdayPart(
  starts_at: string,
  timezone: string,
): { weekday: string; part: DayPart } {
  const date = new Date(starts_at);
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: timezone,
  })
    .format(date)
    .toLowerCase();
  const hour =
    Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone: timezone,
      }).format(date),
    ) % 24;
  const part = DAY_PARTS.find((candidate) => hourInPart(hour, candidate));
  return { weekday, part: part ?? "night" };
}

export function computeWhy(
  item: RecommendItemView,
  prefs: Preferences,
  detail: EventDetailView | null,
): WhyRow[] {
  const rows: WhyRow[] = [];

  if (item.age_min !== null || item.age_max !== null) {
    const levels = fitLevelsForHousehold(
      { age_min: item.age_min, age_max: item.age_max },
      prefs.members,
    );
    const bandsAt = (want: string): AgeBand[] => {
      const bands: AgeBand[] = [];
      prefs.members.forEach((member, index) => {
        if (levels[index] === want && !bands.includes(member.age_band)) {
          bands.push(member.age_band);
        }
      });
      return bands;
    };
    const exact = bandsAt("exact");
    const adjacent = bandsAt("adjacent");
    const parts: string[] = [];
    if (exact.length > 0) parts.push(`Fits ${exact.join(", ")}`);
    if (adjacent.length > 0) {
      const noun = adjacent.length > 1 ? "age bands" : "age band";
      parts.push(`Close to the ${adjacent.join(", ")} ${noun}`);
    }
    rows.push({
      field: "Age",
      detail: parts.length > 0 ? parts.join("; ") : "Overlaps no member band",
      quote: quoteFor(detail, "age_min", "age_max"),
    });
  } else {
    rows.push({
      field: "Age",
      detail: item.age_flag
        ? `No stated ages (${item.age_flag})`
        : "No stated ages — matched on defaults",
      quote: null,
    });
  }

  // Loaded detail is the authority on price basis; when quotes failed
  // to load, the SQL label still identifies policy prices.
  const fromPolicy =
    detail?.price_basis === "source_policy" ||
    (detail === null && isPolicyPrice(item.price_label));
  const basis = fromPolicy
    ? " — from the venue's stated policy, not the listing"
    : "";
  rows.push({
    field: "Price",
    detail: `${priceBadgeLabel(item.price_label)}${basis}`,
    quote: detail?.price_evidence_quote ?? quoteFor(detail, "price_kind"),
  });

  if (item.distance_km !== null) {
    const limit =
      prefs.max_distance_km !== undefined && prefs.fsa
        ? ` (limit ${prefs.max_distance_km} km from ${prefs.fsa})`
        : " (no limit set)";
    rows.push({
      field: "Distance",
      detail: `${item.distance_km.toFixed(1)} km away${limit}`,
      quote: null,
    });
  }

  const when = eventWeekdayPart(item.starts_at, item.timezone);
  const whenLabel = `${capitalize(when.weekday)} ${when.part}`;
  const constrained =
    prefs.availability && Object.keys(prefs.availability).length > 0;
  rows.push({
    field: "Time",
    detail: constrained ? `${whenLabel} — in your windows` : `${whenLabel} — any time works`,
    quote: null,
  });

  if (prefs.language.length > 0 || item.language) {
    let detailText: string;
    if (!item.language) {
      detailText = "Unstated — never excludes";
    } else if (prefs.language.length > 0) {
      detailText = `${item.language} — matches`;
    } else {
      detailText = item.language;
    }
    rows.push({
      field: "Language",
      detail: detailText,
      quote: quoteFor(detail, "language"),
    });
  }

  if (prefs.accessibility.length > 0) {
    rows.push({
      field: "Accessibility",
      detail:
        item.accessibility.length > 0
          ? `States: ${item.accessibility.join(", ")}`
          : "Unstated — never excludes",
      quote: quoteFor(detail, "accessibility"),
    });
  }

  if (prefs.interests.length > 0) {
    const tags = item.tags.map((tag) => tag.toLowerCase());
    const hits = prefs.interests.filter((interest) => {
      const needle = interest.toLowerCase();
      return tags.some((tag) => tag.includes(needle) || needle.includes(tag));
    });
    rows.push({
      field: "Interests",
      detail:
        hits.length > 0
          ? `Matches: ${hits.join(", ")}`
          : "No tag overlap (ranked lower, not excluded)",
      quote: null,
    });
  }

  return rows;
}
