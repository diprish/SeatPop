import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * City registration-windows seed: owner-transcribed by hand from the
 * City's registration page (never crawled, never derived). Validation is
 * strict and loud: bad rows fail the run with every error listed, never
 * a partial load. Bare calendar dates become Toronto-midnight instants
 * (EST/EDT by the North-American DST rule) flagged date-only, so the
 * app shows a date without inventing a time.
 */

export const REGISTRATION_SCHEMA_VERSION = 1;

const WindowInputSchema = z.object({
  scope: z.string(),
  kind: z.string(),
  opens_at: z.string(),
  quote: z.string(),
  source_url: z.string(),
  label: z.string().optional(),
});
export type WindowInput = z.infer<typeof WindowInputSchema>;

const SeedFileSchema = z.object({
  schemaVersion: z.literal(REGISTRATION_SCHEMA_VERSION),
  windows: z.array(WindowInputSchema),
});

export interface ValidatedWindow {
  scope: string;
  kind: string;
  opens_at: string;
  opens_date_only: boolean;
  quote: string;
  source_url: string;
  label: string | null;
}

export function seedFileUrl(): URL {
  return new URL(
    "../../../data/seed/city-registration-dates.json",
    import.meta.url,
  );
}

function nthWeekdayOfMonth(
  year: number,
  monthIndex: number,
  weekday: number,
  n: number,
): number {
  const firstDow = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const shift = (weekday - firstDow + 7) % 7;
  return Date.UTC(year, monthIndex, 1 + shift + (n - 1) * 7);
}

/**
 * Toronto midnight for a calendar date as an ISO instant. DST runs from
 * the second Sunday of March to the first Sunday of November; midnight
 * itself is never ambiguous (transitions happen at 02:00).
 */
export function torontoMidnightIso(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  const dstStart = nthWeekdayOfMonth(year, 2, 0, 2);
  const dstEnd = nthWeekdayOfMonth(year, 10, 0, 1);
  const dayMs = Date.UTC(year, month - 1, day);
  // Spring-forward Sunday is still EST at midnight; fall-back Sunday is
  // still EDT at midnight.
  const dst = dayMs > dstStart && dayMs <= dstEnd;
  return `${date}T00:00:00${dst ? "-04:00" : "-05:00"}`;
}

/** A datetime is only accepted with an explicit zone (Z or ±offset). */
function zonedInstant(raw: string): string | null {
  if (!/([zZ]|[+-]\d{2}:?\d{2})$/.test(raw)) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

export function validateWindow(
  raw: WindowInput,
  index: number,
): { ok: true; window: ValidatedWindow } | { ok: false; error: string } {
  const scope = raw.scope.trim();
  if (scope === "") return { ok: false, error: `window ${index}: empty scope` };
  const quote = raw.quote.trim();
  if (quote === "") return { ok: false, error: `window ${index}: empty quote` };
  let sourceUrl: string;
  try {
    const parsed = new URL(raw.source_url.trim());
    if (parsed.protocol !== "https:") throw new Error("not https");
    sourceUrl = parsed.toString();
  } catch {
    return {
      ok: false,
      error: `window ${index}: source_url must be an https URL`,
    };
  }
  const opensRaw = raw.opens_at.trim();
  let opens_at: string | null;
  let opens_date_only: boolean;
  if (/^\d{4}-\d{2}-\d{2}$/.test(opensRaw)) {
    opens_at = torontoMidnightIso(opensRaw);
    opens_date_only = true;
    if (opens_at === null) {
      return {
        ok: false,
        error: `window ${index}: opens_at is not a calendar date`,
      };
    }
  } else {
    opens_at = zonedInstant(opensRaw);
    opens_date_only = false;
    if (opens_at === null) {
      return {
        ok: false,
        error: `window ${index}: opens_at needs an ISO datetime with a timezone`,
      };
    }
  }
  const label = raw.label === undefined || raw.label.trim() === "" ? null : raw.label.trim();
  return {
    ok: true,
    window: {
      scope,
      kind: raw.kind.trim(),
      opens_at,
      opens_date_only,
      quote,
      source_url: sourceUrl,
      label,
    },
  };
}

/** Load + validate the seed file; throws listing every problem. */
export function loadRegistrationSeed(fileUrl?: URL): ValidatedWindow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(fileUrl ?? seedFileUrl(), "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `registration seed unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const file = SeedFileSchema.safeParse(parsed);
  if (!file.success) {
    throw new Error(
      `registration seed invalid: ${file.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const errors: string[] = [];
  const windows: ValidatedWindow[] = [];
  file.data.windows.forEach((raw, index) => {
    const checked = validateWindow(raw, index);
    if (checked.ok) windows.push(checked.window);
    else errors.push(checked.error);
  });
  if (errors.length > 0) {
    throw new Error(`registration seed invalid:\n  ${errors.join("\n  ")}`);
  }
  return windows;
}
