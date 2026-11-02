import { applyRelaxation, relaxationsFor } from "@seatpop/shared";
import type { Preferences } from "@seatpop/shared";
import type { Diagnosis } from "@/lib/api";

interface EmptyStateProps {
  prefs: Preferences;
  diagnosis: Diagnosis | null;
  diagnosing: boolean;
  onApply: (next: Preferences) => void;
  onResetSample: () => void;
}

const BUTTON = "rounded border border-line px-3 py-1 text-sm";

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
      <div className="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <p className="font-semibold">No events matched.</p>
        <p className="mt-1 text-sm text-muted">
          The measurement failed — these clear one filter each:
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onApply(option.prefs)}
              className={BUTTON}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const gainers = diagnosis.relaxed
    .filter((row) => row.candidates > diagnosis.base)
    .sort((a, b) => b.candidates - a.candidates);
  if (gainers.length === 0) {
    return (
      <div className="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <p className="font-semibold">No events matched.</p>
        <p className="mt-1 text-sm text-muted">
          Nothing upcoming matches, even with filters cleared.
        </p>
        <button type="button" onClick={onResetSample} className={`${BUTTON} mt-2`}>
          Back to the sample household
        </button>
      </div>
    );
  }

  const [top, ...rest] = gainers;
  return (
    <div className="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
      <p className="font-semibold">No events matched.</p>
      <p className="mt-1 text-sm text-muted">
        {top.label} finds {top.candidates} event{top.candidates === 1 ? "" : "s"}:
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {[top, ...rest].map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => {
              const next = applyRelaxation(prefs, row.id);
              if (next) onApply(next);
            }}
            className={BUTTON}
          >
            {row.label} ({row.candidates})
          </button>
        ))}
      </div>
    </div>
  );
}
