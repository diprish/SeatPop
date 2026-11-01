"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buildEventIcs, resolveIcsTimes } from "@seatpop/shared";
import ErrorBanner from "@/components/error-banner";
import {
  deleteBookingApi,
  deleteBookingLocal,
  loadBookings,
  loadFeedToken,
  type BookingLocal,
} from "@/lib/booking";
import { formatWhenRange } from "@/lib/format";

function downloadIcs(filename: string, ics: string): void {
  const blob = new Blob([ics], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function BookedPage() {
  const [bookings, setBookings] = useState<Record<string, BookingLocal>>({});
  const [feedToken, setFeedToken] = useState<string | null>(null);
  const [feedUrl, setFeedUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setBookings(loadBookings());
    const token = loadFeedToken();
    setFeedToken(token);
    if (token) {
      setFeedUrl(`${window.location.origin}/api/bookings/feed?token=${token}`);
    }
  }, []);

  const entries = Object.values(bookings).sort((a, b) =>
    (a.starts_at ?? a.item.starts_at).localeCompare(
      b.starts_at ?? b.item.starts_at,
    ),
  );

  function download(entry: BookingLocal): void {
    setError("");
    try {
      const times = resolveIcsTimes(
        entry.starts_at,
        entry.item.starts_at,
        entry.item.ends_at,
      );
      const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//SeatPop//Bookings//EN",
        buildEventIcs(
          {
            uid: `${entry.booking_id}@seatpop`,
            summary: entry.item.title,
            start: times.start,
            end: times.end,
            location: entry.item.venue_name,
            description: entry.confirmation_id
              ? `Confirmation ${entry.confirmation_id} · Booked via SeatPop`
              : "Booked via SeatPop",
            url: entry.item.source_url,
          },
          new Date().toISOString(),
        ),
        "END:VCALENDAR",
      ].join("\r\n");
      downloadIcs(`booking-${entry.booking_id.slice(0, 8)}.ics`, ics);
    } catch (err) {
      setError(err instanceof Error ? err.message : "download failed");
    }
  }

  async function remove(eventId: string, entry: BookingLocal): Promise<void> {
    setError("");
    try {
      await deleteBookingApi(entry.booking_id, entry.delete_token);
      setBookings(deleteBookingLocal(loadBookings(), eventId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "booking delete failed");
    }
  }

  async function copyFeed(): Promise<void> {
    setCopied(false);
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
    } catch {
      setError("copy failed — select the URL manually");
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-bold">Booked</h1>
      {error !== "" && (
        <div className="mt-3">
          <ErrorBanner message={error} onRetry={() => setError("")} />
        </div>
      )}
      {entries.length === 0 ? (
        <div className="mt-4 text-sm">
          <p>No bookings yet.</p>
          <p className="mt-1">
            <Link className="underline" href="/saved">
              Book from a saved event
            </Link>
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {entries.map((entry) => {
            const times = resolveIcsTimes(
              entry.starts_at,
              entry.item.starts_at,
              entry.item.ends_at,
            );
            return (
              <article
                key={entry.booking_id}
                className="rounded border border-neutral-200 p-3 dark:border-neutral-800"
              >
                <h2 className="font-semibold">
                  <Link
                    className="underline"
                    href={`/events/${entry.item.event_id}`}
                  >
                    {entry.item.title}
                  </Link>
                </h2>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
                  {formatWhenRange(times.start, times.end, entry.item.timezone)}
                  {entry.item.venue_name ? ` · ${entry.item.venue_name}` : ""}
                </p>
                <p className="mt-1 text-sm">
                  {entry.confirmation_id
                    ? `Confirmation ${entry.confirmation_id}`
                    : "No confirmation id"}
                </p>
                <div className="mt-2 flex gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => download(entry)}
                    className="rounded border border-neutral-300 px-3 py-1 dark:border-neutral-700"
                  >
                    Download .ics
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(entry.item.event_id, entry)}
                    className="rounded border border-neutral-300 px-3 py-1 dark:border-neutral-700"
                  >
                    Delete booking
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {feedToken && entries.length > 0 && (
        <section aria-label="Family calendar feed" className="mt-6 text-sm">
          <h2 className="font-semibold">Family calendar feed</h2>
          <p className="mt-1 text-neutral-600 dark:text-neutral-300">
            Subscribe in any calendar app. Keep this URL private — anyone
            with it can read your bookings.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              readOnly
              value={feedUrl}
              aria-label="Family calendar feed URL"
              onFocus={(event) => event.target.select()}
              className="w-full rounded border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              type="button"
              onClick={() => void copyFeed()}
              className="shrink-0 rounded border border-neutral-300 px-3 py-1 dark:border-neutral-700"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
