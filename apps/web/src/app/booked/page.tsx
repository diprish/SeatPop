"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buildEventIcs, resolveIcsTimes } from "@seatpop/shared";
import ErrorBanner from "@/components/error-banner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
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
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-extrabold">Booked</h1>
        <Badge tone="navy">{entries.length}</Badge>
      </div>
      {error !== "" && (
        <div className="mt-3">
          <ErrorBanner message={error} onRetry={() => setError("")} />
        </div>
      )}
      {entries.length === 0 ? (
        <Card className="mt-4 text-center text-sm">
          <span
            aria-hidden="true"
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-sky-tint"
          >
            <Icon name="ticket" className="h-8 w-8 text-sky-ink" />
          </span>
          <p className="mt-3">No bookings yet.</p>
          <p className="mt-1">
            <Link className="underline" href="/saved">
              Book from a saved event
            </Link>
          </p>
        </Card>
      ) : (
        <div className="mt-4 space-y-4">
          {entries.map((entry) => {
            const times = resolveIcsTimes(
              entry.starts_at,
              entry.item.starts_at,
              entry.item.ends_at,
            );
            return (
              <article
                key={entry.booking_id}
                className="rounded-card border border-line bg-surface p-4 shadow-card transition-all duration-200 motion-reduce:transition-none motion-reduce:hover:translate-y-0 hover:-translate-y-0.5"
              >
                <h2 className="text-lg font-bold">
                  <Link
                    className="hover:underline"
                    href={`/events/${entry.item.event_id}`}
                  >
                    {entry.item.title}
                  </Link>
                </h2>
                <p className="mt-1 flex items-center gap-2 text-sm text-muted">
                  <Icon name="calendar" className="h-4 w-4 shrink-0 text-sky-ink" />
                  {formatWhenRange(times.start, times.end, entry.item.timezone)}
                  {entry.item.venue_name ? ` · ${entry.item.venue_name}` : ""}
                </p>
                <p className="mt-2">
                  {entry.confirmation_id ? (
                    <Badge tone="mint" solid>
                      Confirmation {entry.confirmation_id}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">No confirmation id</Badge>
                  )}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => download(entry)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-line px-4 text-sm font-semibold transition-colors duration-200 motion-reduce:transition-none"
                  >
                    <Icon name="calendar" className="h-4 w-4" />
                    Download .ics
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(entry.item.event_id, entry)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-line px-4 text-sm font-semibold transition-colors duration-200 motion-reduce:transition-none"
                  >
                    <Icon name="close" className="h-4 w-4" />
                    Delete booking
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {feedToken && entries.length > 0 && (
        <section
          aria-label="Family calendar feed"
          className="mt-6 rounded-card border border-line bg-surface p-4 text-sm shadow-card"
        >
          <h2 className="font-bold">Family calendar feed</h2>
          <p className="mt-1 text-muted">
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
              className="min-h-[44px] w-full rounded-xl border border-line bg-surface p-2 text-xs"
            />
            <Button
              onClick={() => void copyFeed()}
              className="shrink-0"
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </section>
      )}
    </main>
  );
}
