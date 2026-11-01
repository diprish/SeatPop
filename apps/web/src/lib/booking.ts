import type { RecommendItemView } from "./api";
import { ageLine, formatWindowOpens } from "./format";

/**
 * Guided booking checklist (client-safe): fact-derived steps that walk
 * the user through registering on the OFFICIAL site. SeatPop never
 * submits forms, enters payment, or logs in on anyone's behalf — the
 * final step states that boundary, pinned by test.
 */

export interface BookingStep {
  id: string;
  title: string;
  detail?: string;
  href?: string;
  hrefLabel?: string;
}

export function bookingSteps(item: RecommendItemView): BookingStep[] {
  const steps: BookingStep[] = [
    {
      id: "open",
      title: "Open the official registration page",
      href: item.source_url,
      hrefLabel: "Official page",
    },
  ];
  const windowOpens = item.registration_window
    ? formatWindowOpens(
        item.registration_window.opens_at,
        item.registration_window.opens_date_only,
      )
    : null;
  if (item.registration_window && windowOpens) {
    steps.push({
      id: "opens",
      title: `Registration opens ${windowOpens}`,
      detail: `City's wording: "${item.registration_window.quote}"`,
      href: item.registration_window.source_url,
      hrefLabel: "City page",
    });
  } else {
    steps.push({
      id: "opens",
      title: "Opening time not listed",
      detail: "Check the official page for when registration opens.",
    });
  }
  if (item.price_kind === "free") {
    steps.push({
      id: "payment",
      title: "No payment needed",
      detail: "This event is listed as free.",
    });
  } else if (item.price_kind === "unknown") {
    steps.push({
      id: "payment",
      title: "Price not stated",
      detail: "Check the official page for fees before you register.",
    });
  } else {
    steps.push({
      id: "payment",
      title: "Have payment ready",
      detail: `Listed price: ${item.price_label}. You pay on the official site.`,
    });
  }
  if (item.age_flag) {
    const ages = ageLine(item);
    steps.push({
      id: "ages",
      title: "Confirm the age fit",
      detail: `${item.age_flag}${ages ? ` (${ages})` : ""} — verify on the official page.`,
    });
  }
  steps.push({
    id: "complete",
    title: "Complete the form on the official site",
    detail:
      "SeatPop never books for you: it never submits forms, enters payment, or logs in on your behalf.",
  });
  return steps;
}

export const BOOKING_PROGRESS_KEY = "seatpop_booking_progress";

function readJson(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(BOOKING_PROGRESS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, string[]>)
      : {};
  } catch {
    return {};
  }
}

function writeJson(value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BOOKING_PROGRESS_KEY, JSON.stringify(value));
  } catch {
    // Private mode: progress still works for the session.
  }
}

export function loadBookingProgress(): Record<string, string[]> {
  return readJson();
}

export function toggleBookingStep(
  current: Record<string, string[]>,
  eventId: string,
  stepId: string,
): Record<string, string[]> {
  const checked = new Set(current[eventId] ?? []);
  if (checked.has(stepId)) checked.delete(stepId);
  else checked.add(stepId);
  const next = { ...current, [eventId]: [...checked] };
  writeJson(next);
  return next;
}
