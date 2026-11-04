"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Preferences } from "@seatpop/shared";
import BookingCapture from "@/components/booking-capture";
import BookingChecklist from "@/components/booking-checklist";
import EventCard from "@/components/event-card";
import RemindMe from "@/components/remind-me";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/Skeleton";
import type { RecommendItemView } from "@/lib/api";
import {
  deleteFeedback,
  fetchSavedIds,
  getJwt,
  hideEvent,
  isSaved,
  loadHidden,
  loadSaved,
  postFeedback,
  toggleSaved,
  type SavedSnapshot,
} from "@/lib/feedback";
import { SAMPLE_HOUSEHOLD, loadHousehold } from "@/lib/household";

/**
 * Saved: snapshots kept on this device (guests and signed-in alike),
 * plus signed-in verdicts synced from the API that have no snapshot
 * (e.g. saved on another device) as compact rows to the detail page.
 */
export default function SavedPage() {
  const [ready, setReady] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>(SAMPLE_HOUSEHOLD);
  const [saved, setSaved] = useState<SavedSnapshot[]>([]);
  const [apiOnly, setApiOnly] = useState<string[]>([]);
  const [syncNotes, setSyncNotes] = useState<Record<string, string>>({});
  const [syncFailed, setSyncFailed] = useState(false);

  useEffect(() => {
    const snapshots = loadSaved();
    setSaved(snapshots);
    setPrefs(loadHousehold() ?? SAMPLE_HOUSEHOLD);
    const jwt = getJwt();
    if (!jwt) {
      setReady(true);
      return;
    }
    fetchSavedIds(jwt)
      .then((rows) => {
        const have = new Set(snapshots.map((entry) => entry.item.event_id));
        setApiOnly(rows.map((row) => row.event_id).filter((id) => !have.has(id)));
      })
      .catch(() => setSyncFailed(true))
      .finally(() => setReady(true));
  }, []);

  async function toggleSave(item: RecommendItemView): Promise<void> {
    setSaved((current) => toggleSaved(current, item));
    const jwt = getJwt();
    if (jwt) {
      try {
        await deleteFeedback(jwt, item.event_id);
      } catch {
        setSyncNotes((notes) => ({
          ...notes,
          [item.event_id]: "Removed on this device; sync failed.",
        }));
      }
    }
  }

  async function hide(item: RecommendItemView, reason: string): Promise<void> {
    setSaved((current) =>
      isSaved(current, item.event_id) ? toggleSaved(current, item) : current,
    );
    hideEvent(loadHidden(), item.event_id, reason);
    const jwt = getJwt();
    if (jwt) {
      try {
        await postFeedback(jwt, item.event_id, "not_for_us", reason);
      } catch {
        setSyncNotes((notes) => ({
          ...notes,
          [item.event_id]: "Hidden on this device; sync failed.",
        }));
      }
    }
  }

  if (!ready) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6">
        <h1 className="text-2xl font-bold">Saved</h1>
        <div aria-hidden="true" className="mt-4 space-y-4">
          <Skeleton tone="blush" className="h-36" />
          <Skeleton tone="sky" className="h-36" />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-extrabold">Saved</h1>
        <Badge tone="navy">{saved.length + apiOnly.length}</Badge>
      </div>
      {syncFailed && (
        <p className="mt-2 text-sm font-semibold text-amber-800 dark:text-amber-400">
          Couldn&apos;t load synced saves — showing this device.
        </p>
      )}
      {saved.length === 0 && apiOnly.length === 0 && (
        <Card className="mt-4 text-center">
          <span
            aria-hidden="true"
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blush-tint"
          >
            <Icon name="heart" className="h-8 w-8 text-blush-ink" />
          </span>
          <p className="mt-3 text-sm text-muted">
            Nothing saved yet. Tap Save on an activity you like.
          </p>
        </Card>
      )}
      {saved.length > 0 && (
        <div className="mt-4 space-y-4">
          {saved.map((entry) => (
            <div key={entry.item.event_id}>
              <EventCard
                item={entry.item}
                prefs={prefs}
                saved
                syncNote={syncNotes[entry.item.event_id] ?? null}
                onToggleSave={(item) => void toggleSave(item)}
                onNotForUs={(item, reason) => void hide(item, reason)}
              />
              <RemindMe item={entry.item} />
              <BookingChecklist item={entry.item} />
              <BookingCapture item={entry.item} />
            </div>
          ))}
        </div>
      )}
      {apiOnly.length > 0 && (
        <div className="mt-4">
          <h2 className="text-sm font-semibold">Saved on another device</h2>
          <ul className="mt-2 space-y-2">
            {apiOnly.map((id) => (
              <li
                key={id}
                className="rounded border border-line bg-surface p-2 text-sm"
              >
                <Link className="underline" href={`/events/${id}`}>
                  Open saved event
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
