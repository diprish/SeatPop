/** Pure display formatting for event cards (client-safe, tested). */

export function formatWhen(starts_at: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(starts_at));
}

export type PriceTone = "free" | "muted" | "paid";

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
