import { useEffect, useState } from "react";
import type { RecommendItemView } from "./api";
import {
  deleteFeedback,
  getJwt,
  isSaved,
  loadSaved,
  postFeedback,
  toggleSaved,
  type SavedSnapshot,
} from "./feedback";

/** Saved state + signed-in API mirror, shared by For-you and Explore. */
export function useFeedbackActions(
  onSyncNote: (eventId: string, note: string | null) => void,
): {
  saved: SavedSnapshot[];
  toggleSave: (item: RecommendItemView) => Promise<void>;
} {
  const [saved, setSaved] = useState<SavedSnapshot[]>([]);

  useEffect(() => {
    setSaved(loadSaved());
  }, []);

  async function toggleSave(item: RecommendItemView): Promise<void> {
    const next = toggleSaved(saved, item);
    setSaved(next);
    const jwt = getJwt();
    if (!jwt) return;
    try {
      if (isSaved(next, item.event_id)) {
        await postFeedback(jwt, item.event_id, "saved");
      } else {
        await deleteFeedback(jwt, item.event_id);
      }
      onSyncNote(item.event_id, null);
    } catch {
      onSyncNote(item.event_id, "Kept on this device; sync failed.");
    }
  }

  return { saved, toggleSave };
}
