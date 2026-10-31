"use client";

import {
  AGE_BANDS,
  DAY_PARTS,
  WEEKDAYS,
  type DayPart,
  type Preferences,
  type Weekday,
} from "@seatpop/shared";
import {
  BAND_LABELS,
  addMember,
  budgetDollars,
  isFsaValid,
  removeMember,
  setBudgetDollars,
  setDistanceKm,
  setFreeOnly,
  setFsa,
  toggleAvailability,
} from "@/lib/household";

interface HouseholdPanelProps {
  prefs: Preferences;
  onChange: (next: Preferences) => void;
  onSearch: () => void;
  onReset: () => void;
  busy: boolean;
}

function capitalize(word: string): string {
  return word.slice(0, 1).toUpperCase() + word.slice(1);
}

export default function HouseholdPanel({
  prefs,
  onChange,
  onSearch,
  onReset,
  busy,
}: HouseholdPanelProps) {
  const fsaInvalid = prefs.fsa !== undefined && !isFsaValid(prefs.fsa);
  const distanceNeedsArea =
    prefs.max_distance_km !== undefined && prefs.fsa === undefined;
  const canSearch =
    !busy && prefs.members.length > 0 && !fsaInvalid && !distanceNeedsArea;

  function onBudgetInput(value: string): void {
    if (value.trim() === "") {
      onChange(setBudgetDollars(prefs, undefined));
      return;
    }
    const dollars = Number(value);
    onChange(setBudgetDollars(prefs, Number.isFinite(dollars) ? dollars : undefined));
  }

  function onDistanceInput(value: string): void {
    if (value.trim() === "") {
      onChange(setDistanceKm(prefs, undefined));
      return;
    }
    const km = Number(value);
    onChange(setDistanceKm(prefs, Number.isFinite(km) ? km : undefined));
  }

  return (
    <section aria-label="Edit my household" className="mt-4 rounded border border-neutral-200 p-4 dark:border-neutral-800">
      <div>
        <h2 className="text-sm font-semibold">Members (age bands only, never names)</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {AGE_BANDS.map((band) => (
            <button
              key={band}
              type="button"
              onClick={() => onChange(addMember(prefs, band))}
              aria-label={`Add ${BAND_LABELS[band]}`}
              className="rounded-full border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700"
            >
              + {BAND_LABELS[band]}
            </button>
          ))}
        </div>
        {prefs.members.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Household members">
            {prefs.members.map((member, index) => (
              <li
                key={`${member.age_band}:${index}`}
                className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-3 py-1 text-sm dark:bg-neutral-800"
              >
                {BAND_LABELS[member.age_band]}
                <button
                  type="button"
                  aria-label={`Remove ${BAND_LABELS[member.age_band]}`}
                  onClick={() => onChange(removeMember(prefs, index))}
                  className="text-neutral-500 dark:text-neutral-400"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="hh-fsa" className="text-sm font-semibold">
            Area (FSA)
          </label>
          <input
            id="hh-fsa"
            type="text"
            inputMode="text"
            autoComplete="off"
            maxLength={3}
            placeholder="K2S"
            value={prefs.fsa ?? ""}
            onChange={(e) => onChange(setFsa(prefs, e.target.value))}
            className="mt-1 w-full rounded border border-neutral-300 p-2 text-sm uppercase dark:border-neutral-700 dark:bg-neutral-900"
          />
          {fsaInvalid && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              3 characters like K2S.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="hh-distance" className="text-sm font-semibold">
            Distance (km)
          </label>
          <input
            id="hh-distance"
            type="number"
            inputMode="decimal"
            min={1}
            placeholder="Any"
            value={prefs.max_distance_km ?? ""}
            onChange={(e) => onDistanceInput(e.target.value)}
            className="mt-1 w-full rounded border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          {distanceNeedsArea && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              Distance needs an area (FSA).
            </p>
          )}
        </div>
        <div>
          <label htmlFor="hh-budget" className="text-sm font-semibold">
            Budget per event ($)
          </label>
          <input
            id="hh-budget"
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="Any"
            value={budgetDollars(prefs) ?? ""}
            onChange={(e) => onBudgetInput(e.target.value)}
            className="mt-1 w-full rounded border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
        <div className="flex items-end pb-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={prefs.free_only}
              onChange={(e) => onChange(setFreeOnly(prefs, e.target.checked))}
              className="h-4 w-4"
            />
            Free only
          </label>
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-semibold">
          Availability (leave empty for any time)
        </legend>
        <div className="mt-2 space-y-2">
          {WEEKDAYS.map((day: Weekday) => (
            <div key={day} className="flex items-center gap-2">
              <span className="w-10 text-xs text-neutral-500 dark:text-neutral-400">
                {capitalize(day)}
              </span>
              <div className="flex flex-wrap gap-1">
                {DAY_PARTS.map((part: DayPart) => {
                  const selected = prefs.availability?.[day]?.includes(part) ?? false;
                  return (
                    <button
                      key={part}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onChange(toggleAvailability(prefs, day, part))}
                      className={
                        selected
                          ? "rounded-full bg-black px-2 py-1 text-xs text-white dark:bg-white dark:text-black"
                          : "rounded-full border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
                      }
                    >
                      {capitalize(part)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onSearch}
          disabled={!canSearch}
          className="flex-1 rounded bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {busy ? "Searching…" : "Find activities"}
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={busy}
          className="rounded border border-neutral-300 px-4 py-2 text-sm disabled:opacity-40 dark:border-neutral-700"
        >
          Reset to sample
        </button>
        {prefs.members.length === 0 && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            Add at least one member to search.
          </p>
        )}
      </div>
    </section>
  );
}
