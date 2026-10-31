"use client";

import { useEffect, useState } from "react";
import type { Preferences } from "@seatpop/shared";
import {
  getEventDetail,
  type EventDetailView,
  type RecommendItemView,
} from "@/lib/api";
import { computeWhy } from "@/lib/why";

interface WhySheetProps {
  item: RecommendItemView;
  prefs: Preferences;
  onClose: () => void;
}

export default function WhySheet({ item, prefs, onClose }: WhySheetProps) {
  const [detail, setDetail] = useState<EventDetailView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getEventDetail(item.event_id)
      .then((loaded) => {
        if (live) setDetail(loaded);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [item.event_id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = computeWhy(item, prefs, detail);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/50"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Why ${item.title}`}
        className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white p-4 dark:bg-neutral-950 sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-semibold">Why this pick?</h2>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label="Close why sheet"
            className="rounded border border-neutral-300 px-2 py-0.5 dark:border-neutral-700"
          >
            ×
          </button>
        </div>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          {item.title}
        </p>
        {failed && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            Quotes unavailable — showing matched fields only.
          </p>
        )}
        <dl className="mt-2 space-y-3">
          {rows.map((row) => (
            <div key={row.field}>
              <dt className="text-sm font-semibold">{row.field}</dt>
              <dd className="text-sm">{row.detail}</dd>
              {row.quote && (
                <dd className="mt-1 border-l-2 border-neutral-300 pl-2 text-sm italic text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
                  “{row.quote}”
                </dd>
              )}
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm">
          <a
            className="underline"
            href={item.source_url}
            target="_blank"
            rel="noreferrer"
          >
            Official page
          </a>
        </p>
      </div>
    </div>
  );
}
