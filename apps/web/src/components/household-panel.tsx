"use client";

import type { ReactNode } from "react";
import {
  AGE_BANDS,
  DAY_PARTS,
  WEEKDAYS,
  type AgeBand,
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
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { Field } from "./ui/Field";
import { Icon, type IconName } from "./ui/Icon";
import { Toggle } from "./ui/Toggle";
import {
  HUE_INK,
  HUE_SOLID_BORDER,
  hueForBand,
  hueForDayPart,
  type Hue,
} from "./ui/hue";

interface HouseholdPanelProps {
  prefs: Preferences;
  onChange: (next: Preferences) => void;
  /** Required unless hideActions (the sheet applies from its own bar). */
  onSearch?: () => void;
  onReset: () => void;
  busy: boolean;
  hideActions?: boolean;
}

function capitalize(word: string): string {
  return word.slice(0, 1).toUpperCase() + word.slice(1);
}

function SectionHeading({
  icon,
  hue,
  children,
}: {
  icon: IconName;
  hue: Hue;
  children: ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-bold">
      <Icon name={icon} className={`h-4 w-4 ${HUE_INK[hue]}`} />
      {children}
    </h2>
  );
}

const DISTANCE_QUICK = [2, 5, 10, 25];
const BUDGET_QUICK = [10, 25, 50];

export default function HouseholdPanel({
  prefs,
  onChange,
  onSearch,
  onReset,
  busy,
  hideActions = false,
}: HouseholdPanelProps) {
  const fsaInvalid = prefs.fsa !== undefined && !isFsaValid(prefs.fsa);
  const distanceNeedsArea =
    prefs.max_distance_km !== undefined && prefs.fsa === undefined;
  const canSearch =
    !busy && prefs.members.length > 0 && !fsaInvalid && !distanceNeedsArea;
  const budget = budgetDollars(prefs);

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

  function removeOne(band: AgeBand): void {
    const index = prefs.members.findIndex(
      (member) => member.age_band === band,
    );
    if (index >= 0) onChange(removeMember(prefs, index));
  }

  return (
    <section
      aria-label="Edit my household"
      className="rounded-card border border-line bg-surface p-4 shadow-card"
    >
      <div>
        <SectionHeading icon="users" hue="lavender">
          Who&apos;s coming
        </SectionHeading>
        <div className="mt-2 flex flex-wrap gap-2">
          {AGE_BANDS.map((band) => {
            const hue = hueForBand(band);
            const count = prefs.members.filter(
              (member) => member.age_band === band,
            ).length;
            if (count === 0) {
              return (
                <Chip
                  key={band}
                  hue={hue}
                  aria-label={`Add ${BAND_LABELS[band]}`}
                  onClick={() => onChange(addMember(prefs, band))}
                >
                  + {BAND_LABELS[band]}
                </Chip>
              );
            }
            return (
              <span
                key={band}
                role="group"
                aria-label={BAND_LABELS[band]}
                className="inline-flex items-center gap-1"
              >
                <Chip
                  hue={hue}
                  selected
                  showCheck={false}
                  aria-label={`Add ${BAND_LABELS[band]}`}
                  onClick={() => onChange(addMember(prefs, band))}
                >
                  {BAND_LABELS[band]}
                  {count > 1 ? ` ×${count}` : ""}
                </Chip>
                <button
                  type="button"
                  aria-label={`Remove ${BAND_LABELS[band]}`}
                  onClick={() => removeOne(band)}
                  className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border-2 text-lg font-bold ${HUE_SOLID_BORDER[hue]} ${HUE_INK[hue]}`}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      </div>

      <div className="mt-5">
        <SectionHeading icon="pin" hue="sky">
          Where
        </SectionHeading>
        <div className="mt-2">
          <Field
            id="hh-fsa"
            label="Area (FSA)"
            icon="pin"
            type="text"
            inputMode="text"
            autoComplete="off"
            maxLength={3}
            placeholder="K2S"
            value={prefs.fsa ?? ""}
            onChange={(e) => onChange(setFsa(prefs, e.target.value))}
            error={fsaInvalid ? "3 characters like K2S." : undefined}
            className="uppercase"
          />
        </div>
        <div
          className="mt-3 flex flex-wrap gap-2"
          role="group"
          aria-label="Distance quick picks"
        >
          {DISTANCE_QUICK.map((km) => (
            <Chip
              key={km}
              hue="sky"
              size="sm"
              selected={prefs.max_distance_km === km}
              onClick={() => onChange(setDistanceKm(prefs, km))}
            >
              {km} km
            </Chip>
          ))}
          <Chip
            hue="sky"
            size="sm"
            selected={prefs.max_distance_km === undefined}
            onClick={() => onChange(setDistanceKm(prefs, undefined))}
          >
            Any
          </Chip>
        </div>
        <div className="mt-3 w-36">
          <Field
            id="hh-distance"
            label="Custom distance (km)"
            icon="route"
            type="number"
            inputMode="decimal"
            min={1}
            placeholder="Any"
            value={prefs.max_distance_km ?? ""}
            onChange={(e) => onDistanceInput(e.target.value)}
            error={
              distanceNeedsArea ? "Distance needs an area (FSA)." : undefined
            }
          />
        </div>
      </div>

      <div className="mt-5">
        <SectionHeading icon="wallet" hue="mint">
          Budget
        </SectionHeading>
        <div
          className="mt-2 flex flex-wrap gap-2"
          role="group"
          aria-label="Budget quick picks"
        >
          <Chip
            hue="mint"
            size="sm"
            selected={prefs.free_only}
            onClick={() =>
              onChange(setFreeOnly(setBudgetDollars(prefs, undefined), true))
            }
          >
            Free
          </Chip>
          {BUDGET_QUICK.map((dollars) => (
            <Chip
              key={dollars}
              hue="mint"
              size="sm"
              selected={!prefs.free_only && budget === dollars}
              onClick={() =>
                onChange(
                  setFreeOnly(setBudgetDollars(prefs, dollars), false),
                )
              }
            >
              ${dollars}
            </Chip>
          ))}
          <Chip
            hue="mint"
            size="sm"
            selected={!prefs.free_only && budget === undefined}
            onClick={() =>
              onChange(
                setFreeOnly(setBudgetDollars(prefs, undefined), false),
              )
            }
          >
            Any
          </Chip>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="w-36">
            <Field
              id="hh-budget"
              label="Custom budget ($)"
              icon="wallet"
              type="number"
              inputMode="decimal"
              min={0}
              placeholder="Any"
              value={budget ?? ""}
              onChange={(e) => onBudgetInput(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 pb-2.5">
            <Toggle
              checked={prefs.free_only}
              onChange={(next) => onChange(setFreeOnly(prefs, next))}
              label="Free only"
            />
            <span className="text-sm font-semibold">Free only</span>
          </div>
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="flex items-center gap-2 text-sm font-bold">
          <Icon name="clock" className={`h-4 w-4 ${HUE_INK["lemon"]}`} />
          Availability (leave empty for any time)
        </legend>
        <div className="mt-2 space-y-2">
          {WEEKDAYS.map((day: Weekday) => (
            <div key={day} className="flex items-center gap-2">
              <span className="w-8 text-xs font-semibold text-muted">
                {capitalize(day)}
              </span>
              <div className="grid flex-1 grid-cols-4 gap-1">
                {DAY_PARTS.map((part: DayPart) => {
                  const selected =
                    prefs.availability?.[day]?.includes(part) ?? false;
                  return (
                    <Chip
                      key={part}
                      hue={hueForDayPart(part)}
                      size="sm"
                      selected={selected}
                      onClick={() =>
                        onChange(toggleAvailability(prefs, day, part))
                      }
                    >
                      {capitalize(part)}
                    </Chip>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      {!hideActions && (
        <div className="mt-5">
          <Button
            className="w-full"
            onClick={onSearch}
            disabled={!canSearch}
          >
            {busy ? "Searching…" : "Find activities"}
          </Button>
          <div className="mt-1 text-center">
            <Button variant="ghost" onClick={onReset} disabled={busy}>
              Reset to sample
            </Button>
          </div>
          {prefs.members.length === 0 && (
            <p className="mt-1 text-center text-sm font-semibold text-blush-ink">
              Add at least one member to search.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
