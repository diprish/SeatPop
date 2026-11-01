"use client";

import { useState } from "react";
import type { RecommendItemView } from "@/lib/api";
import {
  bookingSteps,
  loadBookingProgress,
  toggleBookingStep,
} from "@/lib/booking";

interface BookingChecklistProps {
  item: RecommendItemView;
}

/**
 * "Book for us": a guided checklist walked on the OFFICIAL site. Every
 * step is either a stored fact (link, opening, price, age flag) or an
 * explicit boundary line — the component never books anything itself.
 */
export default function BookingChecklist({ item }: BookingChecklistProps) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<string[]>(
    () => loadBookingProgress()[item.event_id] ?? [],
  );
  if (!item.source_url) {
    return (
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
        No official link listed for this event.
      </p>
    );
  }
  if (!open) {
    return (
      <div className="mt-2 text-sm">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="rounded bg-black px-4 py-1 font-semibold text-white dark:bg-white dark:text-black"
        >
          Book for us
        </button>
      </div>
    );
  }
  const steps = bookingSteps(item);
  return (
    <div className="mt-2 text-sm">
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-expanded={true}
        className="font-semibold underline"
      >
        Booking checklist
      </button>
      <ul className="mt-2 space-y-2">
        {steps.map((step) => {
          const done = checked.includes(step.id);
          return (
            <li key={step.id} className="flex items-start gap-2">
              <input
                id={`book-${item.event_id}-${step.id}`}
                type="checkbox"
                checked={done}
                onChange={() =>
                  setChecked(
                    toggleBookingStep(
                      loadBookingProgress(),
                      item.event_id,
                      step.id,
                    )[item.event_id] ?? [],
                  )
                }
                className="mt-1"
              />
              <div>
                <label
                  htmlFor={`book-${item.event_id}-${step.id}`}
                  className={done ? "line-through" : "font-semibold"}
                >
                  {step.title}
                </label>
                {step.detail && (
                  <p className="text-neutral-600 dark:text-neutral-300">
                    {step.detail}
                  </p>
                )}
                {step.href && (
                  <p>
                    <a
                      className="underline"
                      href={step.href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${step.hrefLabel} for ${item.title} (opens in a new tab)`}
                    >
                      {step.hrefLabel} ↗
                    </a>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
