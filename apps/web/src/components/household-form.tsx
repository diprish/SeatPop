"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AGE_BANDS, type AgeBand, type Preferences } from "@seatpop/shared";
import AvailabilityGrid from "./availability-grid";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { Field } from "./ui/Field";
import { hueForBand } from "./ui/hue";
import { BAND_LABELS, setFsa, toggleAvailability } from "@/lib/household";
import {
  BUDGET_DOLLARS,
  LAST_BAND_NOTICE,
  WITHIN_KM,
  applyBudgetValue,
  applyWithinValue,
  budgetSelectValue,
  canShowPicks,
  countTimeSlots,
  distanceAreaError,
  fsaFieldError,
  normaliseFsaInput,
  timeSlotsSummary,
  toggleBand,
  withinSelectValue,
} from "@/lib/household-form";

const SELECT =
  "mt-1 min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink";

/** Plain household form: chips, fields, an Any-time disclosure, submit. */
export default function HouseholdForm({
  prefs,
  onChange,
  onShowPicks,
  onReset,
  busy,
  isSample,
  serverPostalError,
}: {
  prefs: Preferences;
  onChange: (next: Preferences) => void;
  onShowPicks: () => void;
  onReset: () => void;
  busy: boolean;
  isSample: boolean;
  /** API 400 "unknown area" mapped back onto the field. */
  serverPostalError: string | null;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const postalRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    setNotice(null);
  }, [prefs]);
  useEffect(() => {
    if (serverPostalError) postalRef.current?.focus();
  }, [serverPostalError]);

  function toggle(band: AgeBand): void {
    const next = toggleBand(prefs, band);
    setNotice(next.notice);
    if (next.notice === null) onChange(next.prefs);
  }

  function clearTimes(): void {
    const next = { ...prefs };
    delete next.availability;
    onChange(next);
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (prefs.members.length === 0) setNotice(LAST_BAND_NOTICE);
    if (!canShowPicks(prefs)) {
      postalRef.current?.focus();
      return;
    }
    onShowPicks();
  }

  const within = withinSelectValue(prefs);
  const budget = budgetSelectValue(prefs);
  const postalError =
    fsaFieldError(prefs.fsa) ??
    distanceAreaError(prefs) ??
    serverPostalError ??
    undefined;

  return (
    <form onSubmit={handleSubmit} aria-label="Who's coming">
      <h2 className="text-lg font-extrabold">Who&apos;s coming?</h2>
      <p className="mt-1 text-sm text-muted">
        Pick everyone who&apos;ll join. We match activities to each person.
      </p>
      {isSample && (
        <div className="mt-2">
          <Badge tone="lavender" icon="sparkle">
            Sample household
          </Badge>
          <p className="mt-1 text-sm text-muted">
            This is an example family. Edit it to see picks for yours.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Ages">
        {AGE_BANDS.map((band: AgeBand) => {
          const selected = prefs.members.some(
            (member) => member.age_band === band,
          );
          return (
            <Chip
              key={band}
              hue={hueForBand(band)}
              selected={selected}
              aria-label={`${BAND_LABELS[band]}, ${selected ? "selected" : "not selected"}`}
              onClick={() => toggle(band)}
            >
              {BAND_LABELS[band]}
            </Chip>
          );
        })}
      </div>
      <p aria-live="polite" className="mt-1 min-h-5 text-sm font-semibold text-blush-ink">
        {notice ?? ""}
      </p>

      <div className="mt-2 grid gap-3 md:grid-cols-3">
        <Field
          inputRef={postalRef}
          id="hf-postal"
          name="postal"
          label="Postal area"
          icon="pin"
          type="text"
          inputMode="text"
          autoComplete="off"
          maxLength={3}
          placeholder="K2S"
          value={prefs.fsa ?? ""}
          onChange={(e) =>
            onChange(setFsa(prefs, normaliseFsaInput(e.target.value)))
          }
          error={postalError}
          className="uppercase"
        />
        <div>
          <label htmlFor="hf-within" className="block text-sm font-semibold">
            Within
          </label>
          <select
            id="hf-within"
            name="within"
            className={SELECT}
            value={within.value}
            onChange={(e) => onChange(applyWithinValue(prefs, e.target.value))}
          >
            {WITHIN_KM.map((km) => (
              <option key={km} value={String(km)}>
                {km} km
              </option>
            ))}
            {within.custom && (
              <option value={within.custom.value}>{within.custom.label}</option>
            )}
            <option value="any">Any</option>
          </select>
        </div>
        <div>
          <label htmlFor="hf-budget" className="block text-sm font-semibold">
            Budget
          </label>
          <select
            id="hf-budget"
            name="budget"
            className={SELECT}
            value={budget.value}
            onChange={(e) => onChange(applyBudgetValue(prefs, e.target.value))}
          >
            <option value="free">Free</option>
            {BUDGET_DOLLARS.map((dollars) => (
              <option key={dollars} value={String(dollars)}>
                up to ${dollars}
              </option>
            ))}
            {budget.custom && (
              <option value={budget.custom.value}>{budget.custom.label}</option>
            )}
            <option value="any">Any</option>
          </select>
        </div>
      </div>

      <details className="mt-3 rounded-xl border border-line px-3">
        <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-bold">
          {timeSlotsSummary(prefs.availability)}
        </summary>
        <div className="pb-3">
          <AvailabilityGrid
            availability={prefs.availability}
            onToggle={(day, part) =>
              onChange(toggleAvailability(prefs, day, part))
            }
          />
          <Button
            variant="ghost"
            onClick={clearTimes}
            disabled={countTimeSlots(prefs.availability) === 0}
          >
            Clear
          </Button>
        </div>
      </details>

      <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
        <Button type="submit" disabled={busy} className="w-full md:w-auto">
          {busy ? "Finding picks…" : "Show picks"}
        </Button>
        <Button variant="ghost" onClick={onReset} disabled={busy}>
          Reset to sample
        </Button>
      </div>
    </form>
  );
}
