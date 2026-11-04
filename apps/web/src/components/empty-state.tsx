import type { ReactNode } from "react";
import { applyRelaxation, relaxationsFor } from "@seatpop/shared";
import type { Preferences } from "@seatpop/shared";
import type { Diagnosis } from "@/lib/api";
import { Chip } from "./ui/Chip";
import { Icon } from "./ui/Icon";

interface EmptyStateProps {
  prefs: Preferences;
  diagnosis: Diagnosis | null;
  diagnosing: boolean;
  onApply: (next: Preferences) => void;
  onResetSample: () => void;
}

function EmptyPanel({
  children,
  body,
}: {
  children: ReactNode;
  body: ReactNode;
}) {
  return (
    <div className="mt-4 rounded-card border border-line bg-surface p-4 text-center shadow-card">
      <span
        aria-hidden="true"
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-sky-tint"
      >
        <Icon name="search" className="h-8 w-8 text-sky-ink" />
      </span>
      <p className="mt-3 font-bold">No events matched.</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
      {children}
    </div>
  );
}

export default function EmptyState({
  prefs,
  diagnosis,
  diagnosing,
  onApply,
  onResetSample,
}: EmptyStateProps) {
  if (diagnosing) {
    return (
      <p
        role="status"
        className="mt-4 text-sm text-muted"
      >
        Checking which filter removed everything…
      </p>
    );
  }

  if (!diagnosis) {
    const options = relaxationsFor(prefs);
    return (
      <EmptyPanel body="We couldn't run that check — each of these clears one filter:">
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {options.map((option) => (
            <Chip
              key={option.id}
              hue="sky"
              size="sm"
              onClick={() => onApply(option.prefs)}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </EmptyPanel>
    );
  }

  const gainers = diagnosis.relaxed
    .filter((row) => row.candidates > diagnosis.base)
    .sort((a, b) => b.candidates - a.candidates);
  if (gainers.length === 0) {
    return (
      <EmptyPanel body="Nothing upcoming matches, even with filters cleared.">
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <Chip hue="sky" size="sm" onClick={onResetSample}>
            Back to the sample household
          </Chip>
        </div>
      </EmptyPanel>
    );
  }

  const [top, ...rest] = gainers;
  return (
    <EmptyPanel
      body={`${top.label} finds ${top.candidates} event${top.candidates === 1 ? "" : "s"}:`}
    >
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {[top, ...rest].map((row) => (
          <Chip
            key={row.id}
            hue="sky"
            size="sm"
            onClick={() => {
              const next = applyRelaxation(prefs, row.id);
              if (next) onApply(next);
            }}
          >
            {row.label} ({row.candidates})
          </Chip>
        ))}
      </div>
    </EmptyPanel>
  );
}
