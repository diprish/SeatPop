/** Default venue time zone (Ottawa). */
export const DEFAULT_TIMEZONE = "America/Toronto";

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export interface ZonedLocal {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
}

/** Offset of an IANA zone at one instant, in minutes east of UTC. */
function offsetMinutesAt(instantUtcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instantUtcMs));
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - instantUtcMs) / 60000);
}

/**
 * Interpret a wall-clock time in an IANA zone as a UTC ISO instant.
 * Resolves the zone offset iteratively so DST is handled. Ambiguous or
 * skipped local times (DST transitions) resolve to one side; documented,
 * not exact there.
 */
export function zonedLocalToUtc(local: ZonedLocal, timeZone: string): string {
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`invalid time zone: ${timeZone}`);
  }
  const { year, month, day, hour, minute, second = 0 } = local;
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let utcMs = wallAsUtc;
  for (let i = 0; i < 3; i++) {
    utcMs = wallAsUtc - offsetMinutesAt(utcMs, timeZone) * 60000;
  }
  return new Date(utcMs).toISOString();
}
