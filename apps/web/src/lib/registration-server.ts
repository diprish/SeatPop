import { z } from "zod";
import {
  matchWindow,
  type RegistrationWindow,
} from "@seatpop/worker/recommend";

/**
 * Server-only registration-window attach (anon key, public reads).
 * Never imported by client components — the worker recommend entry
 * pulls node-only modules into any bundle that touches it.
 */

const WindowRowSchema = z.object({
  scope: z.string(),
  kind: z.string(),
  opens_at: z.string(),
  opens_date_only: z.boolean(),
  quote: z.string(),
  source_url: z.string(),
  label: z.string().nullable(),
});

const EventSourceRowSchema = z.object({
  event_id: z.string(),
  source_name: z.string(),
});

let cachedWindows: { at: number; windows: RegistrationWindow[] } | null =
  null;
const WINDOWS_TTL_MS = 10 * 60_000;

async function restJson(
  base: string,
  anonKey: string,
  path: string,
): Promise<unknown> {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  if (!response.ok) {
    throw new Error(`supabase ${path} failed: HTTP ${response.status}`);
  }
  return (await response.json()) as unknown;
}

export async function loadWindows(
  base: string,
  anonKey: string,
): Promise<RegistrationWindow[]> {
  if (cachedWindows && Date.now() - cachedWindows.at < WINDOWS_TTL_MS) {
    return cachedWindows.windows;
  }
  const windows = WindowRowSchema.array().parse(
    await restJson(
      base,
      anonKey,
      "registration_windows?select=scope,kind,opens_at,opens_date_only,quote,source_url,label&order=opens_at.asc&limit=500",
    ),
  );
  cachedWindows = { at: Date.now(), windows };
  return windows;
}

export async function loadEventSourceNames(
  base: string,
  anonKey: string,
  eventIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (eventIds.length === 0) return out;
  const rows = EventSourceRowSchema.array().parse(
    await restJson(
      base,
      anonKey,
      `public_event_sources?event_id=in.(${eventIds.map((id) => encodeURIComponent(id)).join(",")})&select=event_id,source_name&limit=2000`,
    ),
  );
  for (const row of rows) {
    const list = out.get(row.event_id) ?? [];
    list.push(row.source_name);
    out.set(row.event_id, list);
  }
  return out;
}

/** Attach the matching window (or null) to each item. */
export async function attachWindows<
  T extends { event_id: string; title: string; category: string | null },
>(
  supabase: { url: string; anonKey: string },
  items: T[],
): Promise<Array<T & { registration_window: RegistrationWindow | null }>> {
  const base = supabase.url.replace(/\/$/, "");
  const [windows, sources] = await Promise.all([
    loadWindows(base, supabase.anonKey),
    loadEventSourceNames(
      base,
      supabase.anonKey,
      items.map((item) => item.event_id),
    ),
  ]);
  const now = Date.now();
  return items.map((item) => ({
    ...item,
    registration_window: matchWindow(windows, sources.get(item.event_id) ?? [], now, {
      title: item.title,
      category: item.category,
    }),
  }));
}
