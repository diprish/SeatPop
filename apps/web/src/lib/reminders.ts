import { getJwt } from "./feedback";

/**
 * Reminder device state (client-safe): the delete token returned once at
 * creation, kept per event for one-click delete. The email itself is
 * never kept here — only the server row holds it.
 */

export const REMINDERS_KEY = "seatpop_reminders";

export interface ReminderLocal {
  id: string;
  token: string;
  remind_at: string;
  basis: string;
}

function readJson(key: string): Record<string, ReminderLocal> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, ReminderLocal>)
      : {};
  } catch {
    return {};
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: the session state still works.
  }
}

export function loadReminders(): Record<string, ReminderLocal> {
  return readJson(REMINDERS_KEY);
}

export function saveReminderLocal(
  current: Record<string, ReminderLocal>,
  eventId: string,
  reminder: ReminderLocal,
): Record<string, ReminderLocal> {
  const next = { ...current, [eventId]: reminder };
  writeJson(REMINDERS_KEY, next);
  return next;
}

export function deleteReminderLocal(
  current: Record<string, ReminderLocal>,
  eventId: string,
): Record<string, ReminderLocal> {
  const next = { ...current };
  delete next[eventId];
  writeJson(REMINDERS_KEY, next);
  return next;
}

export interface ReminderCreated {
  id: string;
  remind_at: string;
  basis: string;
  delete_token: string;
}

/** API failure carrying the HTTP status the copy mapper needs. */
export class ReminderApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ReminderApiError";
    this.status = status;
  }
}

const GENERIC_CREATE_ERROR = "Couldn't set that reminder. Try again.";

/**
 * Display copy for a failed reminder create: known 4xx server messages
 * get their friendly line, any other 4xx surfaces the server's own
 * wording, and only failures without a usable message (network errors,
 * 5xx) fall back to the generic line.
 */
export function friendlyReminderError(error: unknown): string {
  const status = error instanceof ReminderApiError ? error.status : null;
  const message = error instanceof Error ? error.message : "";
  switch (message) {
    case "that reminder time has already passed":
      return "This one starts too soon for a reminder. Reminders go out a day before, so pick an activity that's more than a day away.";
    case "too many pending reminders for this email (max 3 unsent)":
      return "You already have 3 reminders waiting for this email";
    case "a reminder is already set for this event and email":
      return "A reminder is already set for this one";
    default:
      break;
  }
  if (status !== null && status >= 400 && status < 500 && message !== "") {
    return message;
  }
  return GENERIC_CREATE_ERROR;
}

export async function postReminder(
  eventId: string,
  email: string,
): Promise<ReminderCreated> {
  const jwt = getJwt();
  const response = await fetch("/api/reminders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify({ event_id: eventId, email }),
  });
  const json = (await response.json()) as ReminderCreated & { error?: string };
  if (!response.ok) {
    throw new ReminderApiError(
      response.status,
      json.error ?? `reminder failed (${response.status})`,
    );
  }
  return json;
}

export async function deleteReminderApi(
  id: string,
  token: string,
): Promise<void> {
  const jwt = getJwt();
  const response = await fetch("/api/reminders", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify({ id, delete_token: token }),
  });
  const json = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? `reminder delete failed (${response.status})`);
  }
}
