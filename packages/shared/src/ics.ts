/**
 * ICS building (client-safe, shared by the per-booking download and the
 * family feed route): RFC 5545 text escaping, 75-octet line folding,
 * CRLF endings. Times are UTC instants; callers resolve which start/end
 * pair is honest via resolveIcsTimes.
 */

export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold one content line to 75 octets (continuations: 74 + space). */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  let first = true;
  const flush = (): void => {
    chunks.push(current);
    current = "";
    currentBytes = 0;
    first = false;
  };
  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    const limit = first ? 75 : 74;
    if (currentBytes + charBytes > limit && current !== "") flush();
    current += char;
    currentBytes += charBytes;
  }
  flush();
  return chunks.join("\r\n ");
}

export function toIcsUtc(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`not a date/time: ${iso}`);
  return `${new Date(ms).toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`;
}

export interface IcsEventInput {
  uid: string;
  summary: string;
  start: string;
  end: string | null;
  location?: string | null;
  description?: string | null;
  url?: string | null;
}

export function buildEventIcs(event: IcsEventInput, dtstamp: string): string {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${toIcsUtc(dtstamp)}`,
    `DTSTART:${toIcsUtc(event.start)}`,
  ];
  if (event.end !== null) lines.push(`DTEND:${toIcsUtc(event.end)}`);
  lines.push(`SUMMARY:${escapeIcsText(event.summary)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  if (event.description)
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push("END:VEVENT");
  return lines.map(foldIcsLine).join("\r\n");
}

export function buildFeedIcs(
  events: IcsEventInput[],
  dtstamp: string = new Date().toISOString(),
): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SeatPop//Bookings//EN",
    ...events.map((event) => buildEventIcs(event, dtstamp)),
    "END:VCALENDAR",
  ].join("\r\n");
}

/**
 * Which start/end pair a booking honestly claims: the confirmation's
 * parsed start wins, but the listed end only applies when the parsed
 * start is absent or the same instant (a mismatch-saved booking keeps
 * no borrowed end time). Mirrors the bookings_for_feed CASE in
 * migration 0017 — keep both in sync.
 */
export function resolveIcsTimes(
  parsedStartsAt: string | null,
  itemStartsAt: string,
  itemEndsAt: string | null,
): { start: string; end: string | null } {
  if (parsedStartsAt === null || Number.isNaN(Date.parse(parsedStartsAt))) {
    return { start: itemStartsAt, end: itemEndsAt };
  }
  const sameInstant =
    Date.parse(parsedStartsAt) === Date.parse(itemStartsAt);
  return {
    start: parsedStartsAt,
    end: sameInstant ? itemEndsAt : null,
  };
}
