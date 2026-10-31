"use client";

import { useEffect, useRef, useState } from "react";
import type { Preferences } from "@seatpop/shared";
import EmptyState from "@/components/empty-state";
import ErrorBanner from "@/components/error-banner";
import HouseholdPanel from "@/components/household-panel";
import ResultsList from "@/components/results-list";
import {
  fetchRecommend,
  parseProfile,
  type Diagnosis,
  type RecommendItemView,
  type RecommendMetaView,
} from "@/lib/api";
import {
  deleteFeedback,
  getJwt,
  hideEvent,
  isSaved,
  loadHidden,
  loadSaved,
  postFeedback,
  toggleSaved,
  unhideEvent,
  type SavedSnapshot,
} from "@/lib/feedback";
import {
  SAMPLE_HOUSEHOLD,
  householdSummary,
  loadHousehold,
  saveHousehold,
} from "@/lib/household";

/**
 * For you: opens straight into the sample household (guest mode, no
 * sign-up) and searches on load. Saves and hides persist on this device
 * for guests and mirror to the API when a JWT is present.
 */
export default function Home() {
  const [prefs, setPrefs] = useState<Preferences>(SAMPLE_HOUSEHOLD);
  const [items, setItems] = useState<RecommendItemView[]>([]);
  const [meta, setMeta] = useState<RecommendMetaView | null>(null);
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState<"search" | "parse" | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState<SavedSnapshot[]>([]);
  const [hidden, setHidden] = useState<Record<string, string>>({});
  const [showHidden, setShowHidden] = useState(false);
  const [syncNotes, setSyncNotes] = useState<Record<string, string>>({});
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const started = useRef(false);

  async function search(next: Preferences): Promise<void> {
    setBusy("search");
    setBanner("");
    setDiagnosis(null);
    try {
      const data = await fetchRecommend(next);
      setItems(data.items);
      setMeta(data.meta);
      saveHousehold(next);
      if (data.items.length === 0) {
        setDiagnosing(true);
        try {
          const diagnosed = await fetchRecommend(next, true);
          setDiagnosis(diagnosed.diagnosis ?? null);
        } catch {
          setDiagnosis(null);
        } finally {
          setDiagnosing(false);
        }
      }
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "recommend failed");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setSaved(loadSaved());
    setHidden(loadHidden());
    const stored = loadHousehold();
    const initial = stored ?? SAMPLE_HOUSEHOLD;
    if (stored) setPrefs(stored);
    void search(initial);
  }, []);

  async function parse(): Promise<void> {
    if (text.trim() === "") return;
    setBusy("parse");
    setBanner("");
    try {
      const data = await parseProfile(text);
      setPrefs(data.prefs);
      saveHousehold(data.prefs);
      await search(data.prefs);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "parse failed");
    } finally {
      setBusy(null);
    }
  }

  async function toggleSave(item: RecommendItemView): Promise<void> {
    const next = toggleSaved(saved, item);
    setSaved(next);
    const jwt = getJwt();
    if (!jwt) return;
    try {
      if (isSaved(next, item.event_id)) {
        await postFeedback(jwt, item.event_id, "saved");
      } else {
        await deleteFeedback(jwt, item.event_id);
      }
      setSyncNotes((notes) => {
        const rest = { ...notes };
        delete rest[item.event_id];
        return rest;
      });
    } catch {
      setSyncNotes((notes) => ({
        ...notes,
        [item.event_id]: "Kept on this device; sync failed.",
      }));
    }
  }

  async function hide(item: RecommendItemView, reason: string): Promise<void> {
    setHidden((current) => hideEvent(current, item.event_id, reason));
    const jwt = getJwt();
    if (!jwt) return;
    try {
      await postFeedback(jwt, item.event_id, "not_for_us", reason);
    } catch {
      setSyncNotes((notes) => ({
        ...notes,
        [item.event_id]: "Hidden on this device; sync failed.",
      }));
    }
  }

  async function unhide(eventId: string): Promise<void> {
    setHidden((current) => unhideEvent(current, eventId));
    const jwt = getJwt();
    if (!jwt) return;
    try {
      await deleteFeedback(jwt, eventId);
    } catch {
      // The verdict stays server-side; local state rules this device.
    }
  }

  const visible = items.filter((item) => !hidden[item.event_id]);
  const hiddenVisible = items.filter((item) => hidden[item.event_id]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">For you</h1>
        <button
          type="button"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((open) => !open)}
          className="rounded border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700"
        >
          {panelOpen ? "Hide household" : "Edit my household"}
        </button>
      </div>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
        {panelOpen
          ? "Sample household loaded — edit it or search straight away."
          : householdSummary(prefs)}
      </p>

      {panelOpen && (
        <HouseholdPanel
          prefs={prefs}
          onChange={setPrefs}
          onSearch={() => void search(prefs)}
          onReset={() => {
            setPrefs(SAMPLE_HOUSEHOLD);
            void search(SAMPLE_HOUSEHOLD);
          }}
          busy={busy !== null}
        />
      )}

      <section aria-label="Describe your family" className="mt-4">
        <label htmlFor="hh-text" className="text-sm font-semibold">
          Or describe your family (shortcut)
        </label>
        <textarea
          id="hh-text"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Two kids (7 and 10) who love music, Saturday mornings, under $25, near K1S. Don't include names."
          className="mt-1 w-full rounded border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="button"
          onClick={() => void parse()}
          disabled={busy !== null || text.trim() === ""}
          className="mt-2 rounded border border-neutral-300 px-4 py-2 text-sm disabled:opacity-40 dark:border-neutral-700"
        >
          {busy === "parse" ? "Parsing…" : "Parse and search"}
        </button>
      </section>

      {banner !== "" && (
        <ErrorBanner message={banner} onRetry={() => void search(prefs)} />
      )}

      {busy === "search" && items.length === 0 && (
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300" role="status">
          Searching…
        </p>
      )}

      {meta && meta.warnings.length > 0 && (
        <ul className="mt-4 list-disc pl-5 text-sm text-neutral-600 dark:text-neutral-300">
          {meta.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {meta && items.length === 0 && (
        <EmptyState
          prefs={prefs}
          diagnosis={diagnosis}
          diagnosing={diagnosing}
          onApply={(next) => {
            setPrefs(next);
            void search(next);
          }}
          onResetSample={() => {
            setPrefs(SAMPLE_HOUSEHOLD);
            void search(SAMPLE_HOUSEHOLD);
          }}
        />
      )}

      {visible.length > 0 && meta && (
        <ResultsList
          items={visible}
          reranked={meta.reranked}
          prefs={prefs}
          savedIds={new Set(saved.map((entry) => entry.item.event_id))}
          syncNotes={syncNotes}
          onToggleSave={(item) => void toggleSave(item)}
          onNotForUs={(item, reason) => void hide(item, reason)}
        />
      )}

      {meta && items.length > 0 && visible.length === 0 && (
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">
          All {items.length} pick{items.length === 1 ? " is" : "s are"} hidden.
        </p>
      )}

      {hiddenVisible.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            aria-expanded={showHidden}
            onClick={() => setShowHidden((show) => !show)}
            className="text-sm underline"
          >
            {showHidden
              ? "Hide hidden picks"
              : `Show hidden picks (${hiddenVisible.length})`}
          </button>
          {showHidden && (
            <ul className="mt-2 space-y-2">
              {hiddenVisible.map((item) => (
                <li
                  key={item.event_id}
                  className="flex items-center justify-between gap-2 rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800"
                >
                  <span>
                    {item.title}{" "}
                    <span className="text-neutral-500">
                      ({hidden[item.event_id]})
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void unhide(item.event_id)}
                    className="rounded border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700"
                  >
                    Unhide
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}
