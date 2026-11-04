import type { Preferences } from "@seatpop/shared";
import type { RecommendItemView } from "@/lib/api";
import EventCard from "@/components/event-card";
import { Badge } from "@/components/ui/Badge";

interface ResultsListProps {
  items: RecommendItemView[];
  reranked: boolean;
  layout?: "list" | "grid";
  prefs: Preferences;
  savedIds: Set<string>;
  syncNotes: Record<string, string>;
  onToggleSave: (item: RecommendItemView) => void;
  onNotForUs: (item: RecommendItemView, reason: string) => void;
}

export default function ResultsList({
  items,
  reranked,
  layout = "list",
  prefs,
  savedIds,
  syncNotes,
  onToggleSave,
  onNotForUs,
}: ResultsListProps) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold">
          {items.length === 1
            ? "1 pick for your household"
            : `${items.length} picks for your household`}
        </h2>
        <Badge tone={reranked ? "lavender" : "neutral"} solid={reranked}>
          {reranked ? "Picked for your family" : "Best matches"}
        </Badge>
      </div>
      <div aria-hidden="true" className="mt-1 h-1 w-28 rounded-full bg-rainbow" />
      <div
        className={layout === "grid" ? "mt-3 grid gap-4 md:grid-cols-2" : "mt-3 space-y-4"}
      >
        {items.map((item) => (
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
    </div>
  );
}
