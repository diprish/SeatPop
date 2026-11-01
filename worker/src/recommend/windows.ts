/**
 * Registration-window matching (worker/recommend): which owner-transcribed
 * City window, if any, an event shows. A window matches when its scope
 * names one of the event's listing sources (case-insensitive, trimmed);
 * among matches the soonest upcoming opening wins. Past and invalid
 * windows never show — the app states no date it cannot stand behind.
 */

export interface RegistrationWindow {
  scope: string;
  kind: string;
  opens_at: string;
  opens_date_only: boolean;
  quote: string;
  source_url: string;
}

export function matchWindow(
  windows: RegistrationWindow[],
  sourceNames: string[],
  nowMs: number = Date.now(),
): RegistrationWindow | null {
  const names = new Set(
    sourceNames
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name !== ""),
  );
  if (names.size === 0) return null;
  const upcoming = windows.filter((window) => {
    if (!names.has(window.scope.trim().toLowerCase())) return false;
    const opensMs = Date.parse(window.opens_at);
    return !Number.isNaN(opensMs) && opensMs >= nowMs;
  });
  upcoming.sort(
    (a, b) => Date.parse(a.opens_at) - Date.parse(b.opens_at),
  );
  return upcoming[0] ?? null;
}
