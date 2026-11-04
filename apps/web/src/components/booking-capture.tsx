"use client";

import { useState } from "react";
import type { RecommendItemView } from "@/lib/api";
import { Button } from "./ui/Button";
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
    } catch {
      setError("Couldn't read that confirmation. Try again.");
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
    } catch {
      setError("Couldn't save that booking. Try again.");
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
    } catch {
      setError("Couldn't delete that booking. Try again.");
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
          className="mt-1 inline-flex min-h-[44px] items-center rounded-full border-2 border-line px-4 text-sm font-semibold transition-colors duration-200 motion-reduce:transition-none disabled:opacity-40"
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
          className="inline-flex min-h-[44px] items-center rounded-full border-2 border-line px-4 text-sm font-semibold transition-colors duration-200 motion-reduce:transition-none"
        >
          Add confirmation
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-card border-2 border-dashed border-line bg-surface p-4 text-sm">
      <label
        htmlFor={`booking-paste-${item.event_id}`}
        className="block font-bold"
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
        className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-surface p-2 text-ink placeholder:text-faint disabled:opacity-40"
      />
      <p className="mt-1 text-xs text-muted">
        Paste only the confirmation — names, payment details, and contact
        info are discarded after reading and never stored.
      </p>
      {error !== "" && (
        <p className="mt-1 text-sm text-red-700 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <Button
          onClick={() => void parse()}
          disabled={busy !== null || text.trim() === ""}
        >
          {busy === "parse" ? "Reading…" : "Read confirmation"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setFormOpen(false);
            setError("");
            setParsed(null);
          }}
          disabled={busy !== null}
        >
          Cancel
        </Button>
      </div>
      {parsed && (
        <div className="mt-3 rounded border border-line bg-surface p-3">
          <p className="font-semibold">Check before saving</p>
          <p className="mt-1">
            Confirmation id: {parsed.booking.confirmation_id ?? "not found"}
          </p>
          {parsed.booking.confirmation_quote && (
            <p className="text-xs italic text-muted">
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
            <p className="text-xs italic text-muted">
              “{parsed.booking.datetime_quote}”
            </p>
          )}
          <p className="mt-1">
            Listed time:{" "}
            {formatWhenRange(item.starts_at, item.ends_at, item.timezone)}
          </p>
          {parsed.mismatch && (
            <p
              className="mt-1 font-semibold text-amber-800 dark:text-amber-400"
              role="alert"
            >
              The pasted date does not match this event — save only if you
              booked a different occurrence.
            </p>
          )}
          <Button
            onClick={() => void save()}
            disabled={busy !== null}
            className="mt-2"
          >
            {busy === "save" ? "Saving…" : "Confirm booking"}
          </Button>
        </div>
      )}
    </div>
  );
}
