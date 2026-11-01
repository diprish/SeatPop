"use client";

import { useState } from "react";
import type { RecommendItemView } from "@/lib/api";
import {
  deleteBookingApi,
  deleteBookingLocal,
  loadBookings,
  loadFeedToken,
  newFeedToken,
  postBooking,
  postBookingParse,
  saveBookingLocal,
  saveFeedToken,
  type BookingLocal,
  type BookingParsed,
} from "@/lib/booking";
import { formatWhenRange } from "@/lib/format";

interface BookingCaptureProps {
  item: RecommendItemView;
}

/**
 * Confirmation capture: the user pastes the confirmation text, a model
 * extracts the id + date/time with verbatim quotes (anything
 * unverifiable comes back null), the user reviews the match against
 * the event's listed time, then confirms to save. The raw paste is
 * discarded after parsing — never stored.
 */
export default function BookingCapture({ item }: BookingCaptureProps) {
  const [booking, setBooking] = useState<BookingLocal | null>(
    () => loadBookings()[item.event_id] ?? null,
  );
  const [formOpen, setFormOpen] = useState(false);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<BookingParsed | null>(null);
  const [busy, setBusy] = useState<"parse" | "save" | null>(null);
  const [error, setError] = useState("");

  async function parse(): Promise<void> {
    setBusy("parse");
    setError("");
    setParsed(null);
    try {
      setParsed(await postBookingParse(text, item.starts_at));
    } catch (err) {
      setError(err instanceof Error ? err.message : "confirmation parse failed");
    } finally {
      setBusy(null);
    }
  }

  async function save(): Promise<void> {
    if (!parsed) return;
    setBusy("save");
    setError("");
    try {
      let feedToken = loadFeedToken();
      if (!feedToken) {
        feedToken = newFeedToken();
        saveFeedToken(feedToken);
      }
      const created = await postBooking({
        event_id: item.event_id,
        confirmation_id: parsed.booking.confirmation_id,
        starts_at: parsed.booking.starts_at,
        evidence: {
          confirmation_quote: parsed.booking.confirmation_quote,
          datetime_quote: parsed.booking.datetime_quote,
        },
        feed_token: feedToken,
      });
      const local: BookingLocal = {
        booking_id: created.id,
        delete_token: created.delete_token,
        confirmation_id: parsed.booking.confirmation_id,
        starts_at: parsed.booking.starts_at,
        confirmation_quote: parsed.booking.confirmation_quote,
        datetime_quote: parsed.booking.datetime_quote,
        item,
      };
      setBooking(
        saveBookingLocal(loadBookings(), item.event_id, local)[item.event_id] ??
          null,
      );
      setFormOpen(false);
      setText("");
      setParsed(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "booking failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove(): Promise<void> {
    if (!booking) return;
    setBusy("save");
    setError("");
    try {
      await deleteBookingApi(booking.booking_id, booking.delete_token);
      setBooking(null);
      deleteBookingLocal(loadBookings(), item.event_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "booking delete failed");
    } finally {
      setBusy(null);
    }
  }

  if (booking) {
    return (
      <div className="mt-2 text-sm">
        <p className="font-semibold">Booked</p>
        {booking.confirmation_id ? (
          <p>Confirmation {booking.confirmation_id}</p>
        ) : (
          <p>No confirmation id found in the paste.</p>
        )}
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy !== null}
          className="mt-1 rounded border border-neutral-300 px-3 py-1 disabled:opacity-40 dark:border-neutral-700"
        >
          {busy === "save" ? "Deleting…" : "Delete booking"}
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
            setParsed(null);
          }}
          className="rounded border border-neutral-300 px-3 py-1 dark:border-neutral-700"
        >
          Add confirmation
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 text-sm">
      <label
        htmlFor={`booking-paste-${item.event_id}`}
        className="block font-semibold"
      >
        Paste the confirmation text or email body
      </label>
      <textarea
        id={`booking-paste-${item.event_id}`}
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={busy !== null}
        placeholder="Confirmation #ABC123 for Saturday Storytime on March 8…"
        className="mt-1 w-full rounded border border-neutral-300 p-2 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900"
      />
      <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
        Paste only the confirmation — names, payment details, and contact
        info are discarded after reading and never stored.
      </p>
      {error !== "" && (
        <p className="mt-1 text-sm text-red-700 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void parse()}
          disabled={busy !== null || text.trim() === ""}
          className="rounded bg-black px-4 py-1 font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {busy === "parse" ? "Reading…" : "Read confirmation"}
        </button>
        <button
          type="button"
          onClick={() => {
            setFormOpen(false);
            setError("");
            setParsed(null);
          }}
          disabled={busy !== null}
          className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-40 dark:border-neutral-700"
        >
          Cancel
        </button>
      </div>
      {parsed && (
        <div className="mt-3 rounded border border-neutral-300 p-3 dark:border-neutral-700">
          <p className="font-semibold">Check before saving</p>
          <p className="mt-1">
            Confirmation id: {parsed.booking.confirmation_id ?? "not found"}
          </p>
          {parsed.booking.confirmation_quote && (
            <p className="text-xs italic text-neutral-600 dark:text-neutral-300">
              “{parsed.booking.confirmation_quote}”
            </p>
          )}
          <p className="mt-1">
            Date/time found:{" "}
            {parsed.booking.starts_at
              ? formatWhenRange(
                  parsed.booking.starts_at,
                  null,
                  item.timezone,
                )
              : "not found"}
          </p>
          {parsed.booking.datetime_quote && (
            <p className="text-xs italic text-neutral-600 dark:text-neutral-300">
              “{parsed.booking.datetime_quote}”
            </p>
          )}
          <p className="mt-1">
            Listed time:{" "}
            {formatWhenRange(item.starts_at, item.ends_at, item.timezone)}
          </p>
          {parsed.mismatch && (
            <p
              className="mt-1 font-semibold text-amber-700 dark:text-amber-400"
              role="alert"
            >
              The pasted date does not match this event — save only if you
              booked a different occurrence.
            </p>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy !== null}
            className="mt-2 rounded bg-black px-4 py-1 font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {busy === "save" ? "Saving…" : "Confirm booking"}
          </button>
        </div>
      )}
    </div>
  );
}
