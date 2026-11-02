"use client";

import type { AgeBand, Preferences } from "@seatpop/shared";
import { BAND_LABELS } from "@/lib/household";
import {
  buildSentence,
  type SentencePillTarget,
} from "@/lib/sentence";
import { Chip } from "./ui/Chip";

function focusVisible(selector: string): boolean {
  if (typeof document === "undefined") return false;
  const element = [...document.querySelectorAll(selector)].find(
    (node) => node instanceof HTMLElement && node.getClientRects().length > 0,
  );
  if (!(element instanceof HTMLElement)) return false;
  const smooth =
    typeof window !== "undefined" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({
    block: "nearest",
    behavior: smooth ? "smooth" : "auto",
  });
  element.focus({ preventScroll: true });
  return true;
}

/**
 * After the filters UI opens, land on the control a sentence pill
 * names. The desktop panel and the mobile sheet both mount these ids,
 * so the first VISIBLE match wins; the member pill prefers that
 * band's own Remove chip and falls back to the members group.
 */
export function focusFilterTarget(
  target: SentencePillTarget,
  band?: AgeBand,
): void {
  const selectors: string[] =
    target === "members" && band
      ? [`button[aria-label="Remove ${BAND_LABELS[band]}"]`, "#hh-members"]
      : target === "members"
        ? ["#hh-members"]
        : target === "distance"
          ? ["#hh-distance"]
          : target === "budget"
            ? ["#hh-budget"]
            : ["#hh-availability"];
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      selectors.some((selector) => focusVisible(selector));
    }),
  );
}

interface HouseholdSentenceProps {
  prefs: Preferences;
  onPill: (target: SentencePillTarget, band?: AgeBand) => void;
}

/** The household as one sentence; every phrase is a filter pill. */
export default function HouseholdSentence({
  prefs,
  onPill,
}: HouseholdSentenceProps) {
  const segments = buildSentence(prefs);
  return (
    <p className="text-lg leading-[2.9rem]">
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <Chip
            key={index}
            hue={segment.hue}
            selected
            showCheck={false}
            disclosure
            aria-label={`${segment.text}, edit ${segment.target}`}
            onClick={() => onPill(segment.target, segment.band)}
            className="align-middle"
          >
            {segment.text}
          </Chip>
        ),
      )}
    </p>
  );
}
