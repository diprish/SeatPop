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
  return "bg-neutral-900 text-white dark:bg-white dark:text-black";
}

export function formatDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(iso));
}

export function priceTone(price_kind: string): PriceTone {
  if (price_kind === "free") return "free";
  if (price_kind === "unknown") return "muted";
  return "paid";
}

export function ageLine(item: {
  age_min: number | null;
  age_max: number | null;
}): string | null {
  const { age_min, age_max } = item;
  if (age_min === null && age_max === null) return null;
  if (age_min !== null && age_max !== null) {
    return age_min === age_max ? `Age ${age_min}` : `Ages ${age_min}–${age_max}`;
  }
  if (age_min !== null) return `Ages ${age_min}+`;
  return `Ages up to ${age_max}`;
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
