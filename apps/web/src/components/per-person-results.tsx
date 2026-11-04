"use client";

import { useState } from "react";
import { relaxationsFor } from "@seatpop/shared";
import type { AgeBand, Preferences } from "@seatpop/shared";
import EventCard from "@/components/event-card";
import type { RecommendItemView } from "@/lib/api";
import { BAND_LABELS } from "@/lib/household";
import {
  columnReason,
  groupPerPerson,
  togetherReason,
} from "@/lib/per-person";
import { useMediaQuery } from "@/lib/use-media-query";
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
  const shown = (expanded ? picks : picks.slice(0, 3)).map((item) => ({
    ...item,
    reason: columnReason(item.reason, item, band),
  }));
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

function RankBadge({ reranked }: { reranked: boolean }) {
  return (
    <Badge tone={reranked ? "lavender" : "neutral"} solid={reranked}>
      {reranked ? "Picked for your family" : "Best matches"}
    </Badge>
  );
}

function TogetherSection({
  together,
  bands,
  prefs,
  savedIds,
  syncNotes,
  onToggleSave,
  onNotForUs,
}: CardProps & { together: RecommendItemView[]; bands: AgeBand[] }) {
  const shown = together.map((item) => ({
    ...item,
    reason: togetherReason(item.reason, item, bands),
  }));
  return (
    <section aria-labelledby="per-person-together">
      <div className="flex items-center justify-between gap-2">
        <h2 id="per-person-together" className="text-lg font-extrabold">
          Everyone together
        </h2>
      </div>
      <div
        aria-hidden="true"
        className="mt-1 h-1 w-28 rounded-full bg-rainbow"
      />
      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No single pick fits everyone — see each person&rsquo;s picks below.
        </p>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
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
      )}
    </section>
  );
}

const BAND_TAB_LABEL: Record<AgeBand, string> = {
  baby: "Baby",
  preschool: "Preschool",
  kids: "Kids",
  teens: "Teens",
  adults: "Adults",
  seniors: "Seniors",
};

function MobileTabs({
  together,
  columns,
  reranked,
  prefs,
  savedIds,
  syncNotes,
  onToggleSave,
  onNotForUs,
  onApply,
}: CardProps & {
  together: RecommendItemView[];
  columns: Array<{ band: AgeBand; picks: RecommendItemView[] }>;
  reranked: boolean;
  onApply: (next: Preferences) => void;
}) {
  const columnTabs = columns.map((column) => ({
    id: column.band,
    label: BAND_TAB_LABEL[column.band],
    hue: hueForBand(column.band),
  }));
  // One band has no together row, so no Everyone tab either — except
  // with no members at all, where Everyone carries the empty message.
  const tabs =
    columns.length === 1
      ? columnTabs
      : [
          { id: "everyone", label: "Everyone", hue: "lavender" as Hue },
          ...columnTabs,
        ];
  const picksOn = (id: string): boolean =>
    id === "everyone"
      ? together.length > 0
      : (columns.find((column) => column.band === id)?.picks.length ?? 0) >
        0;
  const [active, setActive] = useState("everyone");
  const [manual, setManual] = useState(false);
  const select = (id: string): void => {
    setActive(id);
    setManual(true);
  };
  // Open on the first tab with picks (never an empty Everyone);
  // once the user picks a tab, stay there even if it is empty.
  const current =
    manual && tabs.some((tab) => tab.id === active)
      ? active
      : (tabs.find((tab) => picksOn(tab.id))?.id ?? tabs[0]?.id ?? "everyone");

  function onTabKeyDown(event: React.KeyboardEvent): void {
    const ids = tabs.map((tab) => tab.id);
    const at = ids.indexOf(current);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (at + 1) % ids.length;
    else if (event.key === "ArrowLeft")
      next = (at - 1 + ids.length) % ids.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ids.length - 1;
    if (next === null) return;
    event.preventDefault();
    const id = ids[next] as string;
    select(id);
    document.getElementById(`per-person-tab-${id}`)?.focus();
  }

  const activeColumn = columns.find((column) => column.band === current);
  return (
    <div className="mt-4">
      <div className="flex justify-end">
        <RankBadge reranked={reranked} />
      </div>
      <div
        role="tablist"
        aria-label="Results by member"
        onKeyDown={onTabKeyDown}
        className="sticky top-[65px] z-30 -mx-4 mt-2 flex gap-2 overflow-x-auto border-b border-line bg-surface/95 px-4 pb-2 pt-2 backdrop-blur"
      >
        {tabs.map((tab) => {
          const selected = tab.id === current;
          return (
            <Chip
              key={tab.id}
              hue={tab.hue}
              size="sm"
              selected={selected}
              showCheck={false}
              disclosure
              role="tab"
              id={`per-person-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`per-person-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tab.id)}
              className="min-h-[44px] shrink-0"
            >
              {tab.label}
            </Chip>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`per-person-panel-${current}`}
        aria-labelledby={`per-person-tab-${current}`}
        tabIndex={0}
        className="mt-4"
      >
        {current === "everyone" || !activeColumn ? (
          <TogetherSection
            together={together}
            bands={columns.map((column) => column.band)}
            prefs={prefs}
            savedIds={savedIds}
            syncNotes={syncNotes}
            onToggleSave={onToggleSave}
            onNotForUs={onNotForUs}
          />
        ) : (
          <MemberColumn
            band={activeColumn.band}
            picks={activeColumn.picks}
            prefs={prefs}
            savedIds={savedIds}
            syncNotes={syncNotes}
            onToggleSave={onToggleSave}
            onNotForUs={onNotForUs}
            onApply={onApply}
          />
        )}
      </div>
    </div>
  );
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
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const { together, columns } = groupPerPerson(items, prefs.members);
  if (!isDesktop) {
    return (
      <MobileTabs
        together={together}
        columns={columns}
        reranked={reranked}
        prefs={prefs}
        savedIds={savedIds}
        syncNotes={syncNotes}
        onToggleSave={onToggleSave}
        onNotForUs={onNotForUs}
        onApply={onApply}
      />
    );
  }
  return (
    <div className="mt-4">
      <div className="flex justify-end">
        <RankBadge reranked={reranked} />
      </div>
      {columns.length !== 1 && (
        <TogetherSection
          together={together}
          bands={columns.map((column) => column.band)}
          prefs={prefs}
          savedIds={savedIds}
          syncNotes={syncNotes}
          onToggleSave={onToggleSave}
          onNotForUs={onNotForUs}
        />
      )}
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
