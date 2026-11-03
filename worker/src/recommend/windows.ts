/**
 * Registration-window matching (worker/recommend): which registration
 * opening, if any, an event shows. A window matches when its scope
 * names one of the event's listing sources (case-insensitive, trimmed),
 * its kind is registration_opens (a listings_visible row is a viewing
 * notice, never a registration opening — returning it would mislabel
 * the City's date), and, for swim-labeled windows, the event's title or
 * category says swim. The event must also start after the opening —
 * never imply registration is opening for a course that already began
 * — and when the window's label names a season session (winter, spring,
 * summer, fall), the event's own title or description must name that
 * same season: a session-date row after the opening cannot prove its
 * term started there. Among matches the soonest upcoming opening wins.
 * Past and invalid windows never show, and without usable event timing
 * nothing matches — the app states no date it cannot stand behind.
 */

export interface RegistrationWindow {
  scope: string;
  kind: string;
  opens_at: string;
  opens_date_only: boolean;
  quote: string;
  source_url: string;
  label: string | null;
}

export interface WindowEvent {
  title: string;
  category: string | null;
  /** ISO start; the badge needs the event to begin after the opening. */
  starts_at?: string | null;
  /** Session words ("winter") may live here rather than the title. */
  description?: string | null;
}

const SWIM = /swim/i;

const SEASONS = ["winter", "spring", "summer", "fall", "autumn"] as const;

function eventSaysSwim(event: WindowEvent | undefined): boolean {
  if (!event) return false;
  return (
    SWIM.test(event.title) ||
    (event.category !== null && SWIM.test(event.category))
  );
}

/** The season session a label names ("All winter activities" -> winter). */
function labelSeason(label: string | null): string | null {
  if (!label) return null;
  return (
    SEASONS.find((season) => new RegExp(`\\b${season}\\b`, "i").test(label)) ??
    null
  );
}

/** The event row claims the season in its own title or description. */
function eventSaysSeason(event: WindowEvent, season: string): boolean {
  const text = `${event.title} ${event.description ?? ""}`;
  return new RegExp(`\\b${season}\\b`, "i").test(text);
}

export function matchWindow(
  windows: RegistrationWindow[],
  sourceNames: string[],
  nowMs: number = Date.now(),
  event?: WindowEvent,
): RegistrationWindow | null {
  const names = new Set(
    sourceNames
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name !== ""),
  );
  if (names.size === 0) return null;
  const upcoming = windows.filter((window) => {
    if (!names.has(window.scope.trim().toLowerCase())) return false;
    if (window.kind !== "registration_opens") return false;
    if (
      window.label !== null &&
      SWIM.test(window.label) &&
      !eventSaysSwim(event)
    ) {
      return false;
    }
    const opensMs = Date.parse(window.opens_at);
    if (Number.isNaN(opensMs) || opensMs < nowMs) return false;
    // No event, or no usable event start, means no badge: the row
    // cannot prove its term begins after this opening.
    if (!event) return false;
    const startMs =
      event.starts_at == null ? Number.NaN : Date.parse(event.starts_at);
    if (Number.isNaN(startMs) || startMs <= opensMs) return false;
    // A session-labeled opening needs the session claimed in the
    // event's own words — a later session date alone proves nothing
    // about when the term began.
    const season = labelSeason(window.label);
    if (season !== null && !eventSaysSeason(event, season)) return false;
    return true;
  });
  upcoming.sort(
    (a, b) => Date.parse(a.opens_at) - Date.parse(b.opens_at),
  );
  return upcoming[0] ?? null;
}
