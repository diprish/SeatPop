import type { RecommendItemView } from "@/lib/api";

interface ResultsListProps {
  items: RecommendItemView[];
  reranked: boolean;
}

/** Simple result rows for slice (a); slice (b) replaces these with cards. */
export default function ResultsList({ items, reranked }: ResultsListProps) {
  return (
    <div className="mt-4">
      <h2 className="text-sm font-semibold">
        Top picks {!reranked && "(match order)"}
      </h2>
      <ul className="mt-2 space-y-3">
        {items.map((item) => (
          <li
            key={item.event_id}
            className="rounded border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <span className="font-semibold">{item.title}</span>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              {item.starts_at.slice(0, 16).replace("T", " ")}
              {item.venue_name ? ` · ${item.venue_name}` : ""}
              {item.distance_km !== null ? ` · ${item.distance_km.toFixed(1)} km` : ""}
              {` · ${item.price_label}`}
            </p>
            {item.age_flag && (
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
                {item.age_flag}
              </p>
            )}
            <p className="mt-1 text-sm">
              {item.reason}{" "}
              <span className="text-xs text-neutral-400">
                {item.reasonFromModel ? "(AI reason)" : "(match)"}
              </span>
            </p>
            <p className="mt-1 text-sm">
              <a
                className="underline"
                href={item.source_url}
                target="_blank"
                rel="noreferrer"
              >
                Official page
              </a>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
