"use client";

import { useState } from "react";
import type { RecommendItemView } from "@/lib/api";
import { formatWindowOpens } from "@/lib/format";
import {
  deleteReminderApi,
  deleteReminderLocal,
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "reminder failed");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "reminder delete failed");
    } finally {
      setBusy(false);
    }
  }

  if (reminder) {
    const when = formatWindowOpens(reminder.remind_at, false) ?? "soon";
    return (
      <div className="mt-2 text-sm">
        <p>
          Reminder set · {when}
          {reminder.basis === "registration_window"
            ? " (1 hour before registration opens)"
            : " (1 day before it starts)"}
        </p>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className="mt-1 rounded border border-line px-3 py-1 disabled:opacity-40"
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
        <button
          type="button"
          onClick={() => {
            setFormOpen(true);
            setError("");
          }}
          className="rounded border border-line px-3 py-1"
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
      <label htmlFor={`remind-email-${item.event_id}`} className="block font-semibold">
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
          className="rounded bg-primary px-4 py-1 font-semibold text-white disabled:opacity-40 dark:text-background"
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
          className="rounded border border-line px-3 py-1 disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
