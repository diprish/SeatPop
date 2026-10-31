"use client";

import { useEffect, useRef, useState } from "react";
import type { Preferences } from "@seatpop/shared";
import ErrorBanner from "@/components/error-banner";
import HouseholdPanel from "@/components/household-panel";
import ResultsList from "@/components/results-list";
import {
  fetchRecommend,
  parseProfile,
  type RecommendMetaView,
  type RecommendItemView,
} from "@/lib/api";
import {
  SAMPLE_HOUSEHOLD,
  householdSummary,
  loadHousehold,
  saveHousehold,
} from "@/lib/household";

/**
 * For you: opens straight into the sample household (guest mode, no
 * sign-up) and searches on load. The household panel edits prefs
 * directly; the text box stays as a parse shortcut.
 */
export default function Home() {
  const [prefs, setPrefs] = useState<Preferences>(SAMPLE_HOUSEHOLD);
  const [items, setItems] = useState<RecommendItemView[]>([]);
  const [meta, setMeta] = useState<RecommendMetaView | null>(null);
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState<"search" | "parse" | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [text, setText] = useState("");
  const started = useRef(false);

  async function search(next: Preferences): Promise<void> {
    setBusy("search");
    setBanner("");
    try {
      const data = await fetchRecommend(next);
      setItems(data.items);
      setMeta(data.meta);
      saveHousehold(next);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "recommend failed");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
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
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">
          No events matched this household. Loosen the filters above and try again.
        </p>
      )}

      {items.length > 0 && meta && (
        <ResultsList items={items} reranked={meta.reranked} />
      )}
    </main>
  );
}
