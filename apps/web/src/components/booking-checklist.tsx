"use client";

import { useState } from "react";
import type { RecommendItemView } from "@/lib/api";
import {
  bookingSteps,
  loadBookingProgress,
  toggleBookingStep,
} from "@/lib/booking";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { HUE_INK, HUE_TINT_BG, HUES } from "./ui/hue";

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
      <p className="mt-2 text-sm text-muted">
        No official link listed for this event.
      </p>
    );
  }
  if (!open) {
    return (
      <div className="mt-2 text-sm">
        <Button onClick={() => setOpen(true)} aria-expanded={false}>
          Book for us
        </Button>
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
        className="font-bold underline"
      >
        Booking checklist
      </button>
      <ol className="mt-2 space-y-3">
        {steps.map((step, index) => {
          const done = checked.includes(step.id);
          const hue = HUES[index % HUES.length] ?? "sky";
          return (
            <li key={step.id} className="flex items-start gap-3">
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
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-navy dark:peer-focus-visible:outline-lavender-solid ${
                  done
                    ? "bg-mint-solid text-navy"
                    : `${HUE_TINT_BG[hue]} ${HUE_INK[hue]}`
                }`}
              >
                {done ? (
                  <Icon name="check" className="h-4 w-4" />
                ) : (
                  index + 1
                )}
              </span>
              <div>
                <label
                  htmlFor={`book-${item.event_id}-${step.id}`}
                  className={done ? "line-through" : "font-bold"}
                >
                  {step.title}
                </label>
                {step.detail && (
                  <p className="text-muted">
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
      </ol>
    </div>
  );
}
