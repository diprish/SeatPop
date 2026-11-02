"use client";

import { useEffect, useRef } from "react";
import type { Preferences } from "@seatpop/shared";
import HouseholdPanel from "./household-panel";
import { Button } from "./ui/Button";

interface HouseholdSheetProps {
  prefs: Preferences;
  onChange: (next: Preferences) => void;
  onSearch: () => void;
  onReset: () => void;
  busy: boolean;
  resultCount: number;
  onClose: () => void;
}

/**
 * Mobile filter sheet: the full filter card in a full-height bottom
 * sheet with a pinned Reset / Show-N-picks bar. Focus stays trapped
 * while open; Escape closes.
 */

export default function HouseholdSheet({
  prefs,
  onChange,
  onSearch,
  onReset,
  busy,
  resultCount,
  onClose,
}: HouseholdSheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
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
        aria-label="Edit household and filters"
        className="absolute inset-x-0 bottom-0 flex h-[100dvh] flex-col rounded-t-2xl bg-surface"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="font-extrabold">Edit household and filters</h2>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label="Close filters"
            className="min-touch rounded-full border-2 border-line px-2 text-sm"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4">
          <HouseholdPanel
            prefs={prefs}
            onChange={onChange}
            onReset={onReset}
            busy={busy}
            hideActions
          />
        </div>
        <div className="sticky bottom-0 flex shrink-0 gap-2 border-t border-line bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button variant="ghost" onClick={onReset} disabled={busy}>
            Reset
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              onSearch();
              onClose();
            }}
            disabled={busy}
          >
            {resultCount === 1 ? "Show 1 pick" : `Show ${resultCount} picks`}
          </Button>
        </div>
      </div>
    </div>
  );
}
