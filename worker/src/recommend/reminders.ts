import type { RegistrationWindow } from "./windows";

/**
 * Reminder scheduling (worker/recommend): pure rules shared by the web
 * route. remind_at is the registration opening minus 1 hour, or the
 * event start minus 1 day when no window matches. Email addresses are
 * validated/normalized here and never leave the route for a model.
 */

export type ReminderBasis = "registration_window" | "event_start";

export interface ReminderSchedule {
  remind_at: string;
  basis: ReminderBasis;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export function computeRemindAt(
  window: RegistrationWindow | null,
  startsAt: string,
): ReminderSchedule {
  if (window) {
    return {
      remind_at: new Date(Date.parse(window.opens_at) - HOUR_MS).toISOString(),
      basis: "registration_window",
    };
  }
  return {
    remind_at: new Date(Date.parse(startsAt) - DAY_MS).toISOString(),
    basis: "event_start",
  };
}

/** Trimmed, lowercased, plausibly-shaped — or null. Never logged. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
