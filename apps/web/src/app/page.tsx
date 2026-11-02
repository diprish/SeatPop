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
  loadHidden,
  postFeedback,
  unhideEvent,
} from "@/lib/feedback";
import { useFeedbackActions } from "@/lib/use-feedback-actions";
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
  const [hidden, setHidden] = useState<Record<string, string>>({});
  const [showHidden, setShowHidden] = useState(false);
  const [syncNotes, setSyncNotes] = useState<Record<string, string>>({});

  function noteSync(eventId: string, note: string | null): void {
    setSyncNotes((notes) => {
      const next = { ...notes };
      if (note === null) delete next[eventId];
      else next[eventId] = note;
      return next;
    });
  }

  const { saved, toggleSave } = useFeedbackActions(noteSync);
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
      setPanelOpen(false);
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
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">For you</h1>
        <button
          type="button"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((open) => !open)}
          className="rounded border border-line px-3 py-1 text-sm"
        >
          {panelOpen ? "Hide household" : "Edit my household"}
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">
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
          className="mt-1 w-full rounded border border-line bg-surface p-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void parse()}
          disabled={busy !== null || text.trim() === ""}
          className="mt-2 rounded border border-line px-4 py-2 text-sm disabled:opacity-40"
        >
          {busy === "parse" ? "Parsing…" : "Parse and search"}
        </button>
      </section>

      {banner !== "" && (
        <ErrorBanner message={banner} onRetry={() => void search(prefs)} />
      )}

      {busy === "search" && items.length === 0 && (
        <p className="mt-4 text-sm text-muted" role="status">
          Searching…
        </p>
      )}

      {meta && meta.warnings.length > 0 && (
        <ul className="mt-4 list-disc pl-5 text-sm text-muted">
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
        <p className="mt-4 text-sm text-muted">
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
                  className="flex items-center justify-between gap-2 rounded border border-line bg-surface p-2 text-sm"
                >
                  <span>
                    {item.title}{" "}
                    <span className="text-muted">
                      ({hidden[item.event_id]})
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void unhide(item.event_id)}
                    className="rounded border border-line px-2 py-0.5 text-xs"
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
