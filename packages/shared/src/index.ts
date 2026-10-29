import { z } from "zod";

export * from "./verify";

/** Response shape of GET /health in apps/web. Contains status and build info, never secrets. */
export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string().min(1),
  version: z.string().min(1),
  commit: z.string().min(1),
  node: z.string().min(1),
  time: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * Event categories (single value per event). Mirrored by the CHECK constraint
 * on events.category in supabase/migrations/0002_events.sql — keep both lists
 * in sync.
 */
export const EVENT_CATEGORIES = [
  "classes",
  "camps",
  "sports",
  "arts",
  "music",
  "museums",
  "outdoors",
  "festivals",
  "markets",
  "workshops",
  "library",
  "community",
] as const;

export const EventCategorySchema = z.enum(EVENT_CATEGORIES);

export type EventCategory = z.infer<typeof EventCategorySchema>;
