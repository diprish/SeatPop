/** Pure display formatting for event cards (client-safe, tested). */

function dayLabel(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("weekday")} ${get("month")} ${get("day")}`;
}

function timeLabel(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  }).format(date);
}

/**
 * Event-local range: "Sat Oct 31 · 10:00 AM–11:00 AM" (ends_at when
 * present and after the start), else "Sat Oct 31 · 10:00 AM". Multi-day
 * events name both ends. Never a UTC string.
 */
export function formatWhenRange(
  starts_at: string,
  ends_at: string | null,
  timezone: string,
): string {
  const start = new Date(starts_at);
  const startDay = dayLabel(start, timezone);
  const startTime = timeLabel(start, timezone);
  if (!ends_at) return `${startDay} · ${startTime}`;
  const end = new Date(ends_at);
  if (!(end.getTime() > start.getTime())) return `${startDay} · ${startTime}`;
  const endDay = dayLabel(end, timezone);
  const endTime = timeLabel(end, timezone);
  if (endDay === startDay) return `${startDay} · ${startTime}–${endTime}`;
  return `${startDay} · ${startTime} – ${endDay} · ${endTime}`;
}

export type PriceTone = "free" | "muted" | "paid";

export function priceBadgeClass(tone: PriceTone): string {
  if (tone === "free") {
    return "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100";
  }
  if (tone === "muted") {
    return "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300";
  }
  return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
}

export function formatDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(iso));
}

/**
 * City registration opening in America/Toronto: "Wed Mar 4 · 7:00 PM",
 * or "Wed Mar 4" for date-only windows (no invented time). Null when
 * the stored instant is invalid — callers hide the block instead of
 * showing a made-up date.
 */
export function formatWindowOpens(
  opensAt: string,
  dateOnly: boolean,
): string | null {
  const date = new Date(opensAt);
  if (Number.isNaN(date.getTime())) return null;
  const day = dayLabel(date, "America/Toronto");
  if (dateOnly) return day;
  return `${day} · ${timeLabel(date, "America/Toronto")}`;
}

/**
 * Card badge for a registration opening in America/Toronto:
 * "Registration opens Nov 17, 9:00 PM", or "Registration opens Nov 3"
 * for date-only windows (no invented time). Null when the stored
 * instant is invalid — callers hide the badge instead of showing a
 * made-up date.
 */
export function formatRegistrationBadge(
  opensAt: string,
  dateOnly: boolean,
): string | null {
  const date = new Date(opensAt);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Toronto",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const day = `${get("month")} ${get("day")}`;
  if (dateOnly) return `Registration opens ${day}`;
  return `Registration opens ${day}, ${timeLabel(date, "America/Toronto")}`;
}

/** One-line quote preview (the detail page shows the full verbatim text). */
export function truncateQuote(quote: string, max = 120): string {
  const flat = quote.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

export function priceTone(price_kind: string): PriceTone {
  if (price_kind === "free") return "free";
  if (price_kind === "unknown") return "muted";
  return "paid";
}

/** Badge text for source-policy free (SQL labels it "free (per OPL)"). */
export const POLICY_BADGE_LABEL = "Free · per OPL policy";

/** Source-policy price: the SQL label ends in "(per OPL)". */
export function isPolicyPrice(priceLabel: string): boolean {
  return priceLabel.endsWith("(per OPL)");
}

/**
 * Card badge text: policy free reads "Free · per OPL policy";
 * everything else shows the SQL label verbatim ("Free", "$12.00",
 * "Price not stated").
 */
export function priceBadgeLabel(priceLabel: string): string {
  return isPolicyPrice(priceLabel) ? POLICY_BADGE_LABEL : priceLabel;
}

const MONTHS_WORD = /\b[Mm][Oo][Nn][Tt][Hh][Ss]?(?![a-z])/;
const MOIS_WORD = /\b[Mm][Oo][Ii][Ss](?![a-z])/;

/**
 * Age display, with a safety net for months stored as years: when the
 * largest stated age is in [5, 36) and the listing text says
 * month(s)/mois, the stored numbers are months-magnitudes — a
 * months-quoted age can never legitimately reach 5 as years (the same
 * ceiling verifyAge enforces) — so the label reads months, not years.
 * Converted rows (max under 5) render as years, and magnitudes of 36+
 * are years (36 months would have converted to 3). Months magnitudes
 * under 5 are indistinguishable from years here; the deterministic
 * repair script owns those. Frequency words ("every month") beside
 * years-scale ages can misfire — rare, and visibly quotable.
 */
export function ageLine(item: {
  age_min: number | null;
  age_max: number | null;
  title?: string | null;
  description?: string | null;
  age_text?: string | null;
}): string | null {
  const { age_min, age_max } = item;
  if (age_min === null && age_max === null) return null;
  const magnitude = age_max ?? age_min;
  const text = [item.title ?? "", item.description ?? "", item.age_text ?? ""]
    .join("\n");
  const months =
    magnitude !== null &&
    magnitude >= 5 &&
    magnitude < 36 &&
    (MONTHS_WORD.test(text) || MOIS_WORD.test(text));
  const suffix = months ? " months" : "";
  if (age_min !== null && age_max !== null) {
    return age_min === age_max
      ? `Age ${age_min}${suffix}`
      : `Ages ${age_min}–${age_max}${suffix}`;
  }
  if (age_min !== null) return `Ages ${age_min}+${suffix}`;
  return `Ages up to ${age_max}${suffix}`;
}

export function formatDistance(km: number | null): string | null {
  if (km === null || !Number.isFinite(km) || km < 0) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

/**
 * Model reasons sometimes embed raw UTC instants ("starts
 * 2026-10-31T14:00"). Render those event-local instead; anything that
 * isn't a valid instant passes through untouched.
 */
const ISO_DATETIME = /\b(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?\b/g;

export function formatReasonDates(reason: string, timezone: string): string {
  return reason.replace(
    ISO_DATETIME,
    (
      whole: string,
      year: string,
      month: string,
      day: string,
      hour: string,
      minute: string,
      second: string | undefined,
    ) => {
      const date = new Date(
        `${year}-${month}-${day}T${hour}:${minute}:${second ?? "00"}Z`,
      );
      if (Number.isNaN(date.getTime())) return whole;
      return `${dayLabel(date, timezone)}, ${timeLabel(date, timezone)}`;
    },
  );
}

export interface ReasonPart {
  text: string;
  mark: "stated" | "inferred" | null;
}

/** Splits a reason on its literal (stated)/(inferred) marks for styling. */
export function splitReasonMarks(reason: string): ReasonPart[] {
  const parts: ReasonPart[] = [];
  const re = /\((stated|inferred)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(reason)) !== null) {
    if (match.index > last) {
      parts.push({ text: reason.slice(last, match.index), mark: null });
    }
    parts.push({
      text: match[0],
      mark: match[1] === "inferred" ? "inferred" : "stated",
    });
    last = match.index + match[0].length;
  }
  if (last < reason.length) {
    parts.push({ text: reason.slice(last), mark: null });
  }
  return parts.filter((part) => part.text !== "");
}
