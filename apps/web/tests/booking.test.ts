import { describe, expect, it } from "vitest";
import type { RecommendItemView } from "../src/lib/api";
import {
  bookingSteps,
  toggleBookingStep,
} from "../src/lib/booking";

function item(overrides: Partial<RecommendItemView> = {}): RecommendItemView {
  return {
    event_id: "e1",
    title: "Storytime",
    source_url: "https://example.test/e1",
    price_kind: "free",
    price_label: "Free",
    age_min: null,
    age_max: null,
    age_flag: null,
    registration_window: null,
    ...overrides,
  } as RecommendItemView;
}

describe("bookingSteps", () => {
  it("opens with the official link and ends at the never-books boundary", () => {
    const steps = bookingSteps(item());
    expect(steps[0]).toMatchObject({
      id: "open",
      href: "https://example.test/e1",
    });
    const last = steps[steps.length - 1];
    expect(last?.id).toBe("complete");
    expect(last?.detail).toBe(
      "SeatPop never books for you: it never submits forms, enters payment, or logs in on your behalf.",
    );
  });

  it("shows the registration opening with the City wording when known", () => {
    const steps = bookingSteps(
      item({
        registration_window: {
          scope: "Testville",
          kind: "swimming",
          opens_at: "2031-03-04T19:00:00-05:00",
          opens_date_only: false,
          quote: "Registration opens March 4 at 7 pm.",
          source_url: "https://example.test/registration",
        },
      }),
    );
    const opens = steps.find((step) => step.id === "opens");
    expect(opens?.title).toBe("Registration opens Tue Mar 4 · 7:00 PM");
    expect(opens?.detail).toContain("Registration opens March 4 at 7 pm.");
    expect(opens?.href).toBe("https://example.test/registration");
  });

  it("stays honest when the opening is unknown", () => {
    const steps = bookingSteps(item());
    expect(steps.find((step) => step.id === "opens")?.title).toBe(
      "Opening time not listed",
    );
  });

  it("adapts the payment step to the price kind", () => {
    expect(
      bookingSteps(item()).find((step) => step.id === "payment")?.title,
    ).toBe("No payment needed");
    expect(
      bookingSteps(item({ price_kind: "unknown", price_label: "Price not stated" })).find(
        (step) => step.id === "payment",
      )?.title,
    ).toBe("Price not stated");
    const paid = bookingSteps(
      item({ price_kind: "paid", price_label: "$12.00" }),
    ).find((step) => step.id === "payment");
    expect(paid?.title).toBe("Have payment ready");
    expect(paid?.detail).toContain("$12.00");
  });

  it("adds an age check only when the flag is set", () => {
    expect(
      bookingSteps(item()).some((step) => step.id === "ages"),
    ).toBe(false);
    const flagged = bookingSteps(
      item({ age_flag: "check the age group", age_min: 6, age_max: 12 }),
    ).find((step) => step.id === "ages");
    expect(flagged?.detail).toContain("check the age group");
    expect(flagged?.detail).toContain("Ages 6–12");
  });
});

describe("booking progress", () => {
  it("toggles steps per event", () => {
    const checked = toggleBookingStep({}, "e1", "open");
    expect(checked["e1"]).toEqual(["open"]);
    const unchecked = toggleBookingStep(checked, "e1", "open");
    expect(unchecked["e1"]).toEqual([]);
    expect(toggleBookingStep(unchecked, "e2", "open")["e2"]).toEqual(["open"]);
  });
});
