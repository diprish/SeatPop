"use client";

import { useState } from "react";
import type { RecommendItemView } from "@/lib/api";
import { formatWindowOpens } from "@/lib/format";
import {
  deleteReminderApi,
  deleteReminderLocal,
  friendlyReminderError,
  loadReminders,
  postReminder,
  saveReminderLocal,
  type ReminderLocal,
} from "@/lib/reminders";

interface RemindMeProps {
  item: Pick<RecommendItemView, "event_id">;
}

/**
 * Remind me: one email about this saved event, nothing else. The address
 * is stored only for this reminder (service-role reads only) and the
 * delete token stays on this device for one-click delete.
 */
export default function RemindMe({ item }: RemindMeProps) {
  const [reminder, setReminder] = useState<ReminderLocal | null>(
    () => loadReminders()[item.event_id] ?? null,
  );
  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const created = await postReminder(item.event_id, email);
      const local: ReminderLocal = {
        id: created.id,
        token: created.delete_token,
        remind_at: created.remind_at,
        basis: created.basis,
      };
      setReminder(saveReminderLocal(loadReminders(), item.event_id, local)[item.event_id] ?? null);
      setFormOpen(false);
      setEmail("");
    } catch (error) {
      setError(friendlyReminderError(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!reminder) return;
    setBusy(true);
    setError("");
    try {
      await deleteReminderApi(reminder.id, reminder.token);
      setReminder(null);
      deleteReminderLocal(loadReminders(), item.event_id);
    } catch {
      setError("Couldn't delete that reminder. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (reminder) {
    const when = formatWindowOpens(reminder.remind_at, false);
    const confirmation =
      reminder.basis === "registration_window"
        ? when === null
          ? "We'll email you ahead of time"
          : `We'll email you before registration opens, ${when}`
        : "We'll email you the day before";
    return (
      <div className="mt-2 text-sm">
        <p className="font-semibold">Reminder set</p>
        <p className="mt-1">{confirmation}</p>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className="mt-1 inline-flex min-h-[44px] items-center rounded-full border-2 border-line px-4 text-sm font-semibold transition-colors duration-200 motion-reduce:transition-none disabled:opacity-40"
        >
          {busy ? "Deleting…" : "Delete reminder"}
        </button>
        {error !== "" && (
          <p className="mt-1 text-sm text-red-700 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (!formOpen) {
    return (
      <div className="mt-2 text-sm">
        <p className="font-semibold">Add a reminder</p>
        <button
          type="button"
          onClick={() => {
            setFormOpen(true);
            setError("");
          }}
          className="mt-1 inline-flex min-h-[44px] items-center rounded-full border-2 border-line px-4 text-sm font-semibold transition-colors duration-200 motion-reduce:transition-none"
        >
          Remind me
        </button>
      </div>
    );
  }

  return (
    <form
      className="mt-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <p className="font-semibold">Add a reminder</p>
      <label htmlFor={`remind-email-${item.event_id}`} className="mt-1 block font-semibold">
        Email for this reminder only
      </label>
      <input
        id={`remind-email-${item.event_id}`}
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={busy}
        className="mt-1 w-full max-w-xs rounded border border-line bg-surface p-2 disabled:opacity-40"
      />
      <p className="mt-1 text-xs text-muted">
        One email about this event, nothing else. Your address is stored
        only for this reminder and you can delete it anytime.
      </p>
      {error !== "" && (
        <p className="mt-1 text-sm text-red-700 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={busy || email.trim() === ""}
          className="inline-flex min-h-[44px] items-center rounded-full bg-primary px-4 text-sm font-semibold text-white transition-colors duration-200 motion-reduce:transition-none disabled:opacity-40 dark:text-background"
        >
          {busy ? "Setting…" : "Set reminder"}
        </button>
        <button
          type="button"
          onClick={() => {
            setFormOpen(false);
            setError("");
          }}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center rounded-full border-2 border-line px-4 text-sm font-semibold transition-colors duration-200 motion-reduce:transition-none disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
