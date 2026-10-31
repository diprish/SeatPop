"use client";

import { useEffect, useRef, useState } from "react";
import { AGE_BANDS, type AgeBand, type Preferences } from "@seatpop/shared";
import ErrorBanner from "@/components/error-banner";
import ResultsList from "@/components/results-list";
import {
  fetchRecommend,
  type RecommendItemView,
  type RecommendMetaView,
} from "@/lib/api";
import { buildExplorePrefs, type ExploreFilters } from "@/lib/explore";
import {
  BAND_LABELS,
  SAMPLE_HOUSEHOLD,
  loadHousehold,
} from "@/lib/household";
import {
  getJwt,
  hideEvent,
  loadHidden,
  postFeedback,
} from "@/lib/feedback";
import { useFeedbackActions } from "@/lib/use-feedback-actions";

/**
 * Explore: the same recommend path narrowed by one band, free-only, and
 * distance, on the stored household context (area + availability).
 */
export default function ExplorePage() {
  const [base, setBase] = useState<Preferences>(SAMPLE_HOUSEHOLD);
  const [band, setBand] = useState<AgeBand | "any">("any");
  const [freeOnly, setFreeOnly] = useState(false);
  const [distance, setDistance] = useState("");
  const [items, setItems] = useState<RecommendItemView[]>([]);
  const [meta, setMeta] = useState<RecommendMetaView | null>(null);
  const [searchedPrefs, setSearchedPrefs] = useState<Preferences>(SAMPLE_HOUSEHOLD);
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState<Record<string, string>>({});
  const [syncNotes, setSyncNotes] = useState<Record<string, string>>({});
  const started = useRef(false);

  function noteSync(eventId: string, note: string | null): void {
    setSyncNotes((notes) => {
      const next = { ...notes };
      if (note === null) delete next[eventId];
      else next[eventId] = note;
      return next;
    });
  }

  const { saved, toggleSave } = useFeedbackActions(noteSync);

  function currentFilters(): ExploreFilters {
    const km = distance.trim() === "" ? undefined : Number(distance);
    return {
      band,
      freeOnly,
      distanceKm: km !== undefined && Number.isFinite(km) && km > 0 ? km : undefined,
    };
  }

  async function search(filters: ExploreFilters, context: Preferences): Promise<void> {
    const prefs = buildExplorePrefs(context, filters);
    setSearchedPrefs(prefs);
    setBusy(true);
    setBanner("");
    try {
      const data = await fetchRecommend(prefs);
      setItems(data.items);
      setMeta(data.meta);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "explore failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const stored = loadHousehold() ?? SAMPLE_HOUSEHOLD;
    setBase(stored);
    setHidden(loadHidden());
    void search({ band: "any", freeOnly: false, distanceKm: undefined }, stored);
  }, []);

  async function hide(item: RecommendItemView, reason: string): Promise<void> {
    setHidden((current) => hideEvent(current, item.event_id, reason));
    const jwt = getJwt();
    if (!jwt) return;
    try {
      await postFeedback(jwt, item.event_id, "not_for_us", reason);
    } catch {
      noteSync(item.event_id, "Hidden on this device; sync failed.");
    }
  }

  const distanceNeedsArea =
    distance.trim() !== "" && base.fsa === undefined;
  const visible = items.filter((item) => !hidden[item.event_id]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-bold">Explore</h1>
      <section aria-label="Filters" className="mt-4 rounded border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold">Age band</h2>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Age band">
          {(["any", ...AGE_BANDS] as const).map((option) => {
            const selected = band === option;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                onClick={() => setBand(option)}
                className={
                  selected
                    ? "rounded-full bg-black px-3 py-1 text-sm text-white dark:bg-white dark:text-black"
                    : "rounded-full border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700"
                }
              >
                {option === "any" ? "Any age" : BAND_LABELS[option]}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={freeOnly}
              onChange={(e) => setFreeOnly(e.target.checked)}
              className="h-4 w-4"
            />
            Free only
          </label>
          <div>
            <label htmlFor="ex-distance" className="text-sm font-semibold">
              Distance (km{base.fsa ? ` near ${base.fsa}` : ""})
            </label>
            <input
              id="ex-distance"
              type="number"
              inputMode="decimal"
              min={1}
              placeholder="Any"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              className="mt-1 w-28 rounded border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
            {distanceNeedsArea && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                Distance needs a household area — set one in For you.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void search(currentFilters(), base)}
            disabled={busy || distanceNeedsArea}
            className="rounded bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {busy ? "Searching…" : "Search"}
          </button>
        </div>
      </section>

      {banner !== "" && (
        <ErrorBanner
          message={banner}
          onRetry={() => void search(currentFilters(), base)}
        />
      )}

      {busy && items.length === 0 && (
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300" role="status">
          Searching…
        </p>
      )}

      {meta && visible.length === 0 && (
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">
          No events match these filters. Loosen a filter and try again.
        </p>
      )}

      {visible.length > 0 && meta && (
        <ResultsList
          items={visible}
          reranked={meta.reranked}
          prefs={searchedPrefs}
          savedIds={new Set(saved.map((entry) => entry.item.event_id))}
          syncNotes={syncNotes}
          onToggleSave={(item) => void toggleSave(item)}
          onNotForUs={(item, reason) => void hide(item, reason)}
        />
      )}
    </main>
  );
}
