"use client";

import { useEffect, useRef, useState } from "react";
import { AGE_BANDS, type AgeBand, type Preferences } from "@seatpop/shared";
import ErrorBanner from "@/components/error-banner";
import ResultsList from "@/components/results-list";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { hueForBand } from "@/components/ui/hue";
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
      const message = error instanceof Error ? error.message : "";
      setBanner(
        /cap reached/i.test(message)
          ? "You've reached today's search limit — try again tomorrow."
          : "Couldn't load activities. Try again.",
      );
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
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-extrabold">Explore</h1>
      <section
        aria-label="Filters"
        className="mt-4 rounded-card border border-line bg-surface p-4 shadow-card"
      >
        <h2 className="text-sm font-bold">Age</h2>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Age">
          {(["any", ...AGE_BANDS] as const).map((option) => (
            <Chip
              key={option}
              hue={option === "any" ? "lavender" : hueForBand(option)}
              size="sm"
              selected={band === option}
              onClick={() => setBand(option)}
            >
              {option === "any" ? "Any age" : BAND_LABELS[option]}
            </Chip>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2 pb-2.5">
            <Toggle
              checked={freeOnly}
              onChange={setFreeOnly}
              label="Free only"
            />
            <span className="text-sm font-semibold">Free only</span>
          </div>
          <div className="w-36">
            <Field
              id="ex-distance"
              label={`How far (km${base.fsa ? ` from ${base.fsa}` : ""})`}
              icon="route"
              type="number"
              inputMode="decimal"
              min={1}
              placeholder="Any"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              hint={
                distanceNeedsArea
                  ? "Distance needs a household area — set one in For you."
                  : undefined
              }
            />
          </div>
          <Button
            onClick={() => void search(currentFilters(), base)}
            disabled={busy || distanceNeedsArea}
          >
            {busy ? "Finding activities…" : "Find activities"}
          </Button>
        </div>
      </section>

      {banner !== "" && (
        <ErrorBanner
          message={banner}
          onRetry={() => void search(currentFilters(), base)}
        />
      )}

      {busy && items.length === 0 && (
        <p className="mt-4 text-sm text-muted" role="status">
          Finding activities…
        </p>
      )}

      {meta && visible.length === 0 && (
        <p className="mt-4 text-sm text-muted">
          No events match these filters. Loosen a filter and try again.
        </p>
      )}

      {visible.length > 0 && meta && (
        <ResultsList
          items={visible}
          reranked={meta.reranked}
          layout="grid"
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
