"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Preferences } from "@seatpop/shared";
import EventCard from "@/components/event-card";
import RemindMe from "@/components/remind-me";
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
      <main className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="text-2xl font-bold">Saved</h1>
        <p className="mt-2 text-sm" role="status">
          Loading…
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-bold">Saved</h1>
      {syncFailed && (
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
          Couldn&apos;t load synced saves — showing this device.
        </p>
      )}
      {saved.length === 0 && apiOnly.length === 0 && (
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          Nothing saved yet. Tap Save on any pick in{" "}
          <Link className="underline" href="/">
            For you
          </Link>
          .
        </p>
      )}
      {saved.length > 0 && (
        <div className="mt-4 space-y-3">
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
                className="rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800"
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
