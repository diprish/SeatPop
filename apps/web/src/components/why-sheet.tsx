"use client";

import { useEffect, useRef, useState } from "react";
import type { Preferences } from "@seatpop/shared";
import {
  getEventDetail,
  type EventDetailView,
  type RecommendItemView,
} from "@/lib/api";
import { computeWhy } from "@/lib/why";
import { Icon } from "./ui/Icon";

interface WhySheetProps {
  item: RecommendItemView;
  prefs: Preferences;
  onClose: () => void;
}

export default function WhySheet({ item, prefs, onClose }: WhySheetProps) {
  const [detail, setDetail] = useState<EventDetailView | null>(null);
  const [failed, setFailed] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

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
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Why ${item.title}`}
        className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-surface p-4 sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-bold">Why this pick?</h2>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label="Close why sheet"
            className="min-touch rounded-full border-2 border-line px-2 text-sm"
          >
            ×
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">
          {item.title}
        </p>
        {failed && (
          <p className="mt-2 rounded-xl bg-lemon-tint p-2 text-xs font-semibold text-lemon-ink">
            Quotes unavailable — showing matched fields only.
          </p>
        )}
        <dl className="mt-2 space-y-2">
          {rows.map((row) => (
            <div key={row.field} className="rounded-xl bg-mist p-3">
              <dt className="flex items-center gap-1.5 text-sm font-bold">
                <Icon name="check" className="h-4 w-4 text-mint-ink" />
                {row.field}
              </dt>
              <dd className="mt-1 text-sm">{row.detail}</dd>
              {row.quote && (
                <dd className="mt-2 rounded-lg border border-line bg-surface p-2 text-sm italic text-muted">
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
            aria-label={`Official page for ${item.title}`}
          >
            Official page
          </a>
        </p>
      </div>
    </div>
  );
}
