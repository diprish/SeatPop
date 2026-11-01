/**
 * Registration-window matching (worker/recommend): which registration
 * opening, if any, an event shows. A window matches when its scope
 * names one of the event's listing sources (case-insensitive, trimmed),
 * its kind is registration_opens (a listings_visible row is a viewing
 * notice, never a registration opening — returning it would mislabel
 * the City's date), and, for swim-labeled windows, the event's title or
 * category says swim. Among matches the soonest upcoming opening wins.
 * Past and invalid windows never show — the app states no date it
 * cannot stand behind.
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
}

const SWIM = /swim/i;

function eventSaysSwim(event: WindowEvent | undefined): boolean {
  if (!event) return false;
  return (
    SWIM.test(event.title) ||
    (event.category !== null && SWIM.test(event.category))
  );
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
    return !Number.isNaN(opensMs) && opensMs >= nowMs;
  });
  upcoming.sort(
    (a, b) => Date.parse(a.opens_at) - Date.parse(b.opens_at),
  );
  return upcoming[0] ?? null;
}
