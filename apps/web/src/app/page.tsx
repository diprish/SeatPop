"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Preferences } from "@seatpop/shared";
import EmptyState from "@/components/empty-state";
import ErrorBanner from "@/components/error-banner";
import HouseholdPanel from "@/components/household-panel";
import HouseholdSheet from "@/components/household-sheet";
import ResultsList from "@/components/results-list";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/Skeleton";
import { hueForBand } from "@/components/ui/hue";
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
  BAND_LABELS,
  SAMPLE_HOUSEHOLD,
  budgetDollars,
  dedupeMembers,
  isSampleHousehold,
  loadHousehold,
  saveHousehold,
} from "@/lib/household";

const HERO_STEPS = [
  { circle: "bg-blush-solid", label: "Tell us who's coming" },
  { circle: "bg-lemon-solid", label: "We match every age" },
  { circle: "bg-mint-solid", label: "Book and get reminded" },
];

/** Shown only while the prefs in use are the built-in sample. */
function SampleHouseholdNote() {
  return (
    <div className="mb-2">
      <Badge tone="lavender" icon="sparkle">
        Sample household
      </Badge>
      <p className="mt-1 text-sm text-muted">
        This is an example family. Edit it to see picks for yours.
      </p>
    </div>
  );
}

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
  const [sheetOpen, setSheetOpen] = useState(false);
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
      // The parser returns one member per person mentioned; the
      // household keeps one chip per band ("two kids" -> one Kids).
      const parsed = dedupeMembers(data.prefs);
      setPrefs(parsed);
      saveHousehold(parsed);
      await search(parsed);
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

  const isSample = isSampleHousehold(prefs);
  const visible = items.filter((item) => !hidden[item.event_id]);
  const hiddenVisible = items.filter((item) => hidden[item.event_id]);
  const budget = budgetDollars(prefs);
  const windowCount = Object.values(prefs.availability ?? {}).reduce(
    (count, parts) => count + (parts?.length ?? 0),
    0,
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <Card>
        <h1 className="text-2xl font-extrabold lg:text-3xl">
          What&apos;s on for your{" "}
          <span className="text-rainbow">whole family?</span>
        </h1>
        <p className="mt-2 text-muted">
          Free and paid activities for every age in Ottawa, matched to each
          person, booked before they fill up.
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

      <div className="mt-4 lg:hidden">
        {isSample && <SampleHouseholdNote />}
        <div className="flex flex-wrap gap-2" aria-label="Household summary">
          {prefs.members.map((member, index) => (
            <Badge
              key={`${member.age_band}:${index}`}
              tone={hueForBand(member.age_band)}
              solid
            >
              {BAND_LABELS[member.age_band]}
            </Badge>
          ))}
          {prefs.fsa && <Badge tone="neutral">{prefs.fsa}</Badge>}
          {prefs.max_distance_km !== undefined && (
            <Badge tone="sky" solid>
              ≤ {prefs.max_distance_km} km
            </Badge>
          )}
          {prefs.free_only ? (
            <Badge tone="mint" solid>
              Free only
            </Badge>
          ) : (
            budget !== undefined && (
              <Badge tone="mint" solid>
                ≤ ${budget}
              </Badge>
            )
          )}
          {windowCount > 0 && (
            <Badge tone="lavender" solid>
              {windowCount} {windowCount === 1 ? "time" : "times"}
            </Badge>
          )}
        </div>
        <Button
          variant="secondary"
          hue="lavender"
          className="mt-3 w-full"
          onClick={() => setSheetOpen(true)}
        >
          <Icon name="filter" className="h-4 w-4" />
          Edit household and filters
        </Button>
      </div>

      {banner !== "" && (
        <ErrorBanner message={banner} onRetry={() => void search(prefs)} />
      )}

      <div className="mt-6 lg:grid lg:grid-cols-[350px_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="hidden lg:block">
          <div className="lg:sticky lg:top-24">
            {isSample && <SampleHouseholdNote />}
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
          </div>
        </div>

        <div>
          <section
            aria-label="Describe your family"
            className="rounded-card border border-line bg-surface p-4 shadow-card"
          >
            <label htmlFor="hh-text" className="text-sm font-bold">
              Or describe your family (shortcut)
            </label>
            <textarea
              id="hh-text"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Two kids (7 and 10) who love music, Saturday mornings, under $25, near K1S. Don't include names."
              className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-surface p-2 text-sm text-ink placeholder:text-faint"
            />
            <Button
              className="mt-2"
              onClick={() => void parse()}
              disabled={busy !== null || text.trim() === ""}
            >
              {busy === "parse" ? "Parsing…" : "Parse and search"}
            </Button>
          </section>

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
                Searching…
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

      {sheetOpen && (
        <HouseholdSheet
          prefs={prefs}
          onChange={setPrefs}
          onSearch={() => void search(prefs)}
          onReset={() => {
            setPrefs(SAMPLE_HOUSEHOLD);
            void search(SAMPLE_HOUSEHOLD);
          }}
          busy={busy !== null}
          resultCount={visible.length}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </main>
  );
}
