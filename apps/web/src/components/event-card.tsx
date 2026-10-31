"use client";

import Link from "next/link";
import { useState } from "react";
import type { Preferences } from "@seatpop/shared";
import type { RecommendItemView } from "@/lib/api";
import { NOT_FOR_US_REASONS } from "@/lib/feedback";
import {
  ageLine,
  formatDistance,
  formatWhen,
  priceTone,
  splitReasonMarks,
  type PriceTone,
} from "@/lib/format";
import WhySheet from "@/components/why-sheet";

interface EventCardProps {
  item: RecommendItemView;
  prefs: Preferences;
  saved: boolean;
  syncNote: string | null;
  onToggleSave: (item: RecommendItemView) => void;
  onNotForUs: (item: RecommendItemView, reason: string) => void;
}

const PRICE_BADGE: Record<PriceTone, string> = {
  free: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100",
  muted:
    "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  paid: "bg-neutral-900 text-white dark:bg-white dark:text-black",
};

export default function EventCard({
  item,
  prefs,
  saved,
  syncNote,
  onToggleSave,
  onNotForUs,
}: EventCardProps) {
  const [whyOpen, setWhyOpen] = useState(false);
  const [hideOpen, setHideOpen] = useState(false);
  const ages = ageLine(item);
  const distance = formatDistance(item.distance_km);

  return (
    <article className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
      <h3 className="font-semibold">
        <Link className="underline" href={`/events/${item.event_id}`}>
          {item.title}
        </Link>
      </h3>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
        {formatWhen(item.starts_at, item.timezone)}
        {item.venue_name ? ` · ${item.venue_name}` : ""}
        {distance ? ` · ${distance}` : ""}
      </p>
      <p className="mt-1">
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${PRICE_BADGE[priceTone(item.price_kind)]}`}
        >
          {item.price_label}
        </span>
        {ages && <span className="ml-2 text-sm">{ages}</span>}
      </p>
      {item.age_flag && (
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          {item.age_flag}
        </p>
      )}
      <p className="mt-1 text-sm">
        {splitReasonMarks(item.reason).map((part, index) =>
          part.mark ? (
            <span
              key={index}
              className={
                part.mark === "stated"
                  ? "text-xs font-semibold text-green-700 dark:text-green-300"
                  : "text-xs font-semibold text-amber-700 dark:text-amber-300"
              }
            >
              {part.text}
            </span>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}{" "}
        <span className="text-xs text-neutral-400">
          {item.reasonFromModel ? "(AI reason)" : "(match)"}
        </span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          aria-pressed={saved}
          onClick={() => onToggleSave(item)}
          className="rounded border border-neutral-300 px-3 py-1 dark:border-neutral-700"
        >
          {saved ? "★ Saved" : "☆ Save"}
        </button>
        <button
          type="button"
          aria-expanded={hideOpen}
          onClick={() => setHideOpen((open) => !open)}
          className="rounded border border-neutral-300 px-3 py-1 dark:border-neutral-700"
        >
          Not for us
        </button>
        <button
          type="button"
          onClick={() => setWhyOpen(true)}
          className="rounded border border-neutral-300 px-3 py-1 dark:border-neutral-700"
        >
          Why this?
        </button>
        <a
          className="rounded border border-neutral-300 px-3 py-1 dark:border-neutral-700"
          href={item.source_url}
          target="_blank"
          rel="noreferrer"
        >
          Official page ↗
        </a>
      </div>
      {hideOpen && (
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Reason">
          {NOT_FOR_US_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => {
                onNotForUs(item, reason);
                setHideOpen(false);
              }}
              className="rounded-full border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
            >
              {reason}
            </button>
          ))}
        </div>
      )}
      {syncNote && (
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {syncNote}
        </p>
      )}
      {whyOpen && (
        <WhySheet item={item} prefs={prefs} onClose={() => setWhyOpen(false)} />
      )}
    </article>
  );
}
