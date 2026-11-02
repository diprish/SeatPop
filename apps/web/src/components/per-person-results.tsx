"use client";

import { useState } from "react";
import { relaxationsFor } from "@seatpop/shared";
import type { AgeBand, Preferences } from "@seatpop/shared";
import EventCard from "@/components/event-card";
import type { RecommendItemView } from "@/lib/api";
import { BAND_LABELS } from "@/lib/household";
import { groupPerPerson } from "@/lib/per-person";
import { Badge } from "@/components/ui/Badge";
import { Chip } from "@/components/ui/Chip";
import {
  HUE_SOLID_BORDER,
  HUE_TINT_BG,
  hueForBand,
  type Hue,
} from "@/components/ui/hue";

/**
 * For-you results (2c): "Everyone together" picks first, then one
 * hue-tinted column per member. Grouping is a stable partition of the
 * served order — ranking, SQL, and evals never see this component.
 */

interface CardProps {
  prefs: Preferences;
  savedIds: Set<string>;
  syncNotes: Record<string, string>;
  onToggleSave: (item: RecommendItemView) => void;
  onNotForUs: (item: RecommendItemView, reason: string) => void;
}

/** "Adults (18–64)" -> "Adults 18–64" for column headers. */
function columnLabel(band: AgeBand): string {
  return BAND_LABELS[band].replace(" (", " ").replace(")", "");
}

function MemberColumn({
  band,
  picks,
  prefs,
  savedIds,
  syncNotes,
  onToggleSave,
  onNotForUs,
  onApply,
}: CardProps & {
  band: AgeBand;
  picks: RecommendItemView[];
  onApply: (next: Preferences) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hue: Hue = hueForBand(band);
  const label = columnLabel(band);
  const shown = expanded ? picks : picks.slice(0, 3);
  return (
    <section
      aria-labelledby={`per-person-${band}`}
      className={`rounded-card border-2 p-4 ${HUE_TINT_BG[hue]} ${HUE_SOLID_BORDER[hue]}`}
    >
      <h2 id={`per-person-${band}`}>
        <Badge solid tone={hue}>
          {label} · {picks.length} {picks.length === 1 ? "pick" : "picks"}
        </Badge>
      </h2>
      {picks.length === 0 ? (
        <>
          <p className="mt-3 text-sm text-muted">
            Nothing for {label} in this window.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {relaxationsFor(prefs).map((option) => (
              <Chip
                key={option.id}
                hue="sky"
                size="sm"
                onClick={() => onApply(option.prefs)}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="mt-3 space-y-4">
            {shown.map((item) => (
              <EventCard
                key={item.event_id}
                item={item}
                prefs={prefs}
                saved={savedIds.has(item.event_id)}
                syncNote={syncNotes[item.event_id] ?? null}
                onToggleSave={onToggleSave}
                onNotForUs={onNotForUs}
              />
            ))}
          </div>
          {picks.length > 3 && (
            <Chip
              hue={hue}
              size="sm"
              disclosure
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
              className="mt-3"
            >
              {expanded ? "Show less" : `Show ${picks.length - 3} more`}
            </Chip>
          )}
        </>
      )}
    </section>
  );
}

interface PerPersonResultsProps extends CardProps {
  items: RecommendItemView[];
  reranked: boolean;
  onApply: (next: Preferences) => void;
}

export default function PerPersonResults({
  items,
  reranked,
  prefs,
  savedIds,
  syncNotes,
  onToggleSave,
  onNotForUs,
  onApply,
}: PerPersonResultsProps) {
  const { together, columns } = groupPerPerson(items, prefs.members);
  return (
    <div className="mt-4">
      <section aria-labelledby="per-person-together">
        <div className="flex items-center justify-between gap-2">
          <h2 id="per-person-together" className="text-lg font-extrabold">
            Everyone together
          </h2>
          <Badge tone={reranked ? "lavender" : "neutral"} solid={reranked}>
            {reranked ? "AI-ranked" : "match order"}
          </Badge>
        </div>
        <div
          aria-hidden="true"
          className="mt-1 h-1 w-28 rounded-full bg-rainbow"
        />
        {together.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            No single pick fits everyone — see each person&rsquo;s column
            below.
          </p>
        ) : (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {together.map((item) => (
              <EventCard
                key={item.event_id}
                item={item}
                prefs={prefs}
                saved={savedIds.has(item.event_id)}
                syncNote={syncNotes[item.event_id] ?? null}
                onToggleSave={onToggleSave}
                onNotForUs={onNotForUs}
              />
            ))}
          </div>
        )}
      </section>
      <div className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        {columns.map((column) => (
          <MemberColumn
            key={column.band}
            band={column.band}
            picks={column.picks}
            prefs={prefs}
            savedIds={savedIds}
            syncNotes={syncNotes}
            onToggleSave={onToggleSave}
            onNotForUs={onNotForUs}
            onApply={onApply}
          />
        ))}
      </div>
    </div>
  );
}
