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
    throw new Error(json.error ?? `reminder failed (${response.status})`);
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
