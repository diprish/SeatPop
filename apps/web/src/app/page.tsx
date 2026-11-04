"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Preferences } from "@seatpop/shared";
import EmptyState from "@/components/empty-state";
import ErrorBanner from "@/components/error-banner";
import HouseholdForm from "@/components/household-form";
import PerPersonResults from "@/components/per-person-results";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
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
  dedupeMembers,
  isSampleHousehold,
  loadHousehold,
  saveHousehold,
} from "@/lib/household";
import {
  OTTAWA_FSA_MESSAGE,
  isUnknownAreaError,
} from "@/lib/household-form";

const HERO_STEPS = [
  { circle: "bg-blush-solid", label: "Tell us who's coming" },
  { circle: "bg-lemon-solid", label: "See what fits each person" },
  { circle: "bg-mint-solid", label: "Register on the official page, and we'll remind you" },
];

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
  const [text, setText] = useState("");
  const [hidden, setHidden] = useState<Record<string, string>>({});
  const [showHidden, setShowHidden] = useState(false);
  const [showShortcut, setShowShortcut] = useState(false);
  const [syncNotes, setSyncNotes] = useState<Record<string, string>>({});
  const [areaError, setAreaError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  function handleFormChange(next: Preferences): void {
    setAreaError(null);
    setPrefs(next);
  }

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
    setAreaError(null);
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
      // An "unknown area" 400 lands back on the postal field, never
      // the generic panel. Previous results stay, nothing clears.
      const message = error instanceof Error ? error.message : "";
      if (isUnknownAreaError(message)) {
        setAreaError(OTTAWA_FSA_MESSAGE);
      } else {
        setBanner(
          items.length > 0
            ? "Couldn't load picks. Your previous results are unchanged."
            : "Couldn't load picks. Try again.",
        );
      }
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
      // The parser returns one member per person mentioned; the
      // household keeps one chip per band ("two kids" -> one Kids).
      const parsed = dedupeMembers(data.prefs);
      setPrefs(parsed);
      saveHousehold(parsed);
      await search(parsed);
    } catch {
      setBanner(
        "Couldn't understand that description. Try short phrases like 'two kids, Saturday mornings'.",
      );
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

  const isSample = isSampleHousehold(prefs);
  const visible = items.filter((item) => !hidden[item.event_id]);
  const hiddenVisible = items.filter((item) => hidden[item.event_id]);
  const reloading = busy === "search" && items.length > 0;

  function revealResults(): void {
    const node = resultsRef.current;
    if (!node) return;
    const smooth =
      typeof window !== "undefined" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    node.focus({ preventScroll: true });
  }

  function showPicks(): void {
    void search(prefs);
    revealResults();
  }

  function resetToSample(): void {
    setPrefs(SAMPLE_HOUSEHOLD);
    void search(SAMPLE_HOUSEHOLD);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <Card>
        <h1 className="text-2xl font-extrabold lg:text-3xl">
          What&apos;s on for your{" "}
          <span className="text-rainbow">whole family?</span>
        </h1>
        <p className="mt-2 text-muted">
          Free and paid activities for every age in Ottawa, matched to each
          person, with registration dates so you never miss one.
        </p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-3">
          {HERO_STEPS.map((step, index) => (
            <li key={step.label} className="flex items-center gap-2 text-sm font-semibold">
              <span
                aria-hidden="true"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-navy ${step.circle}`}
              >
                {index + 1}
              </span>
              {step.label}
            </li>
          ))}
        </ol>
      </Card>
      <p className="mt-2 text-sm text-muted">
        New here?{" "}
        <Link className="font-bold underline underline-offset-4" href="/about">
          See how it works
        </Link>
      </p>

      <div className="mt-4">
        <Card>
          <HouseholdForm
            prefs={prefs}
            onChange={handleFormChange}
            onShowPicks={showPicks}
            onReset={resetToSample}
            busy={busy !== null}
            isSample={isSample}
            serverPostalError={areaError}
          />
          <div className="mt-3">
            <Button
              variant="ghost"
              aria-expanded={showShortcut}
              aria-controls="shortcut-panel"
              onClick={() => setShowShortcut((show) => !show)}
            >
              Or just tell us about your family
            </Button>
            <section
              id="shortcut-panel"
              aria-label="Describe your family"
              className={showShortcut ? "mt-2" : "hidden"}
            >
              <label htmlFor="hh-text" className="text-sm font-bold">
                Tell us about your family
              </label>
              <textarea
                id="hh-text"
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Two kids, 7 and 10, who love music. Saturday mornings, under $25, near K1S. No names needed."
                className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-surface p-2 text-sm text-ink placeholder:text-faint"
              />
              <Button
                className="mt-2"
                onClick={() => void parse()}
                disabled={busy !== null || text.trim() === ""}
              >
                {busy === "parse" ? "Finding activities…" : "Find activities"}
              </Button>
            </section>
          </div>
        </Card>
      </div>

      {banner !== "" && (
        <ErrorBanner message={banner} onRetry={() => void search(prefs)} />
      )}

      <div className="mt-6">
        <div
          id="results"
          ref={resultsRef}
          tabIndex={-1}
          aria-busy={busy === "search"}
          className={`scroll-mt-20 transition-opacity duration-200 motion-reduce:transition-none ${reloading ? "opacity-60" : ""}`}
        >
          {reloading && (
            <p className="text-sm text-muted" role="status">
              Finding activities…
            </p>
          )}

          {meta && meta.warnings.length > 0 && (
            <ul className="mt-4 list-disc pl-5 text-sm text-muted">
              {meta.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          {busy === "search" && items.length === 0 && (
            <div className="mt-4">
              <p className="text-sm text-muted" role="status">
                Finding activities…
              </p>
              <div aria-hidden="true" className="mt-2 space-y-4">
                <Skeleton tone="blush" className="h-36" />
                <Skeleton tone="sky" className="h-36" />
                <Skeleton tone="lavender" className="h-36" />
              </div>
            </div>
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
            <PerPersonResults
              items={visible}
              reranked={meta.reranked}
              prefs={prefs}
              savedIds={new Set(saved.map((entry) => entry.item.event_id))}
              syncNotes={syncNotes}
              onToggleSave={(item) => void toggleSave(item)}
              onNotForUs={(item, reason) => void hide(item, reason)}
              onApply={(next) => {
                setPrefs(next);
                void search(next);
              }}
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
                className="inline-flex min-h-[44px] items-center text-sm underline"
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
                        className="inline-flex min-h-[44px] items-center rounded-full border-2 border-line px-4 text-sm font-semibold"
                      >
                        Unhide
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

    </main>
  );
}
