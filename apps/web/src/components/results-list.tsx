import type { Preferences } from "@seatpop/shared";
import type { RecommendItemView } from "@/lib/api";
import EventCard from "@/components/event-card";

interface ResultsListProps {
  items: RecommendItemView[];
  reranked: boolean;
  prefs: Preferences;
  savedIds: Set<string>;
  syncNotes: Record<string, string>;
  onToggleSave: (item: RecommendItemView) => void;
  onNotForUs: (item: RecommendItemView, reason: string) => void;
}

export default function ResultsList({
  items,
  reranked,
  prefs,
  savedIds,
  syncNotes,
  onToggleSave,
  onNotForUs,
}: ResultsListProps) {
  return (
    <div className="mt-4">
      <h2 className="text-sm font-semibold">
        Top picks {!reranked && "(match order)"}
      </h2>
      <div className="mt-2 space-y-4">
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
