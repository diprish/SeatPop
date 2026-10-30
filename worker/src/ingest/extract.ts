import { z } from "zod";
import {
  BudgetExceeded,
  chat,
  resolveConfig,
  type ChatMessage,
  type ChatOptions,
  type ChatRequest,
  type ChatResult,
  type LlmConfig,
} from "@seatpop/llm";
import { optionsForSource } from "./source-config";
import { DEFAULT_TIMEZONE, zonedLocalToUtc } from "./tz";
import {
  EventDraftSchema,
  EventStatusSchema,
  type EventDraft,
  type SourceConfig,
} from "./types";

/**
 * Tier-2 listing extraction: public event-listing text in, EventDrafts out.
 *
 * Authorization constraints (2026-10-28 tier-2 set, 2026-10-30 round-2
 * set; HTML sources only, never more than approved):
 * - Task "listing_extraction" (public listing text only). Baseten is the
 *   default with contributor fallback — EXCEPT no-training-route sources
 *   (no ToU found), which use Baseten only and skip on errors or cap.
 * - Hard $2 model-spend cap per run, enforced by the budget guard.
 * - Every field carries a verbatim evidence quote that must appear in the
 *   page text after whitespace normalisation; a field without one is null,
 *   and an event without a title or start quote is dropped.
 * - No price/free or age inference: the schema has no such fields, and
 *   descriptions/venues must be substrings of their evidence spans, so any
 *   such words came from the page, never from the model.
 * - Cache: the request (fixed prompt + page text + links + date) is hashed
 *   by the client, so identical re-runs make zero model calls.
 */

/** Hard per-run model-spend cap for listing extraction (USD). */
export const EXTRACTION_RUN_BUDGET_USD = 2;
/** Fixed output limit: part of the cache key, so re-runs hit the cache. */
export const EXTRACTION_MAX_TOKENS = 4096;
/** Input guards: bound prompt size and cost per page. */
export const EXTRACTION_MAX_TEXT_CHARS = 30_000;
export const EXTRACTION_MAX_LINKS = 200;
export const EXTRACTION_MAX_EVENTS_PER_PAGE = 100;

export interface PageLink {
  text: string;
  url: string;
}

export interface ExtractionPage {
  url: string;
  text: string;
  links: PageLink[];
}

/** Injectable chat signature (the real client by default, a stub in tests). */
export type ChatFn = (
  request: ChatRequest,
  options?: ChatOptions,
) => Promise<ChatResult>;

/** Extraction config: env-resolved, with the $2 per-run cap forced. */
export function resolveExtractionConfig(
  env: NodeJS.ProcessEnv = process.env,
): LlmConfig {
  return resolveConfig(env, {
    budgets: { perRun: EXTRACTION_RUN_BUDGET_USD },
  });
}

/** Collapse every whitespace run (evidence rule: quotes match after this). */
export function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Local wall time: full timestamp or date-only (midnight, never invented). */
const WallTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/);

/**
 * One model-proposed event. Unknown keys (price, ages, anything else) are
 * stripped by zod: they can never reach a draft.
 */
const ExtractedEventSchema = z.object({
  title: z.string().min(1),
  title_evidence: z.string().min(1),
  starts_at: WallTimeSchema,
  starts_at_evidence: z.string().min(1),
  ends_at: WallTimeSchema.nullish(),
  ends_at_evidence: z.string().nullish(),
  description: z.string().nullish(),
  description_evidence: z.string().nullish(),
  venue_name: z.string().nullish(),
  venue_name_evidence: z.string().nullish(),
  venue_address: z.string().nullish(),
  venue_address_evidence: z.string().nullish(),
  source_url: z.string().nullish(),
  source_url_evidence: z.string().nullish(),
  status: EventStatusSchema.nullish(),
  status_evidence: z.string().nullish(),
});
type ExtractedEvent = z.infer<typeof ExtractedEventSchema>;

const ExtractionOutputSchema = z.object({
  events: z.array(z.unknown()),
});

const SYSTEM_PROMPT =
  "You extract public event listings into JSON. Copy spans verbatim from " +
  "the page; never invent, paraphrase, or infer facts that are not stated. " +
  "There are no price or age fields: never infer whether an event is free " +
  "or paid, and never infer ages or age ranges. Reply with a single JSON " +
  "object and nothing else.";

export interface ExtractionPromptInput {
  sourceName: string;
  pageUrl: string;
  /** YYYY-MM-DD: resolves years for dates stated without one. */
  today: string;
  timezone: string;
  text: string;
  links: PageLink[];
}

/**
 * Deterministic prompt for one page: fixed template + page content, so the
 * client cache key is stable and identical re-runs make zero model calls.
 * (The date is part of the key: year inference depends on it, so a re-run
 * on a later day re-extracts rather than reusing stale years.)
 */
export function buildExtractionMessages(
  input: ExtractionPromptInput,
): ChatMessage[] {
  const text =
    input.text.length > EXTRACTION_MAX_TEXT_CHARS
      ? `${input.text.slice(0, EXTRACTION_MAX_TEXT_CHARS)}\n[TRUNCATED]`
      : input.text;
  const linkLines = input.links
    .slice(0, EXTRACTION_MAX_LINKS)
    .map((l) => `- ${l.text || "(no text)"} -> ${l.url}`);
  const user = [
    `SOURCE: ${input.sourceName} (${input.pageUrl})`,
    `TODAY: ${input.today} (use it to resolve years for dates stated without one; prefer the next occurrence on or after TODAY)`,
    `TIME ZONE: ${input.timezone} (all event times are in this zone unless the page states otherwise)`,
    "",
    "PAGE TEXT:",
    text,
    "",
    "PAGE LINKS (link text -> URL, in page order):",
    ...linkLines,
    "",
    "TASK: List every distinct upcoming event on the page: concerts, shows,",
    "exhibitions, programs, workshops, markets. Skip navigation, headers,",
    "footers, and events ending before TODAY.",
    "",
    "For EACH event output this JSON shape (omit optional keys or use null",
    "when the page does not state them):",
    "{",
    '  "title": "event name, copied verbatim from the page",',
    '  "title_evidence": "exact page span containing the title",',
    '  "starts_at": "local start as YYYY-MM-DDTHH:MM:SS (date only as YYYY-MM-DD when no time is given)",',
    '  "starts_at_evidence": "exact page span the date/time comes from",',
    '  "ends_at": "same format, or null",',
    '  "ends_at_evidence": "exact page span, or null",',
    '  "description": "up to 3 sentences copied from ONE page span, or null",',
    '  "description_evidence": "that exact span",',
    '  "venue_name": "verbatim, or null",',
    '  "venue_name_evidence": "exact page span, or null",',
    '  "venue_address": "verbatim, or null",',
    '  "venue_address_evidence": "exact page span, or null",',
    '  "source_url": "one URL from PAGE LINKS above (the event’s own page when present), or null",',
    '  "source_url_evidence": "the exact link line it comes from, or null",',
    '  "status": "scheduled (default), cancelled, full, or waitlist — non-scheduled only when the page says so",',
    '  "status_evidence": "exact page span, or null when scheduled",',
    "}",
    "",
    "RULES:",
    "- Every *_evidence span must appear character-for-character in PAGE TEXT",
    "  (or PAGE LINKS for source_url); whitespace differences are allowed.",
    "- title, description, venue_name and venue_address must each appear",
    "  inside their own evidence span.",
    "- Events without a title span or a date span are dropped: do not emit them.",
    "- Never infer free/paid, prices, or ages. Never invent times: date-only",
    "  stays date-only.",
    '- Output: {"events": [ ... ]} and nothing else.',
  ].join("\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

/** A quote is valid only if it normalises non-empty and occurs in the page. */
function validQuote(
  quote: string | null | undefined,
  pageNorm: string,
): string | null {
  if (!quote) return null;
  const q = normalizeSpace(quote);
  if (q === "" || !pageNorm.includes(q)) return null;
  return q;
}

/**
 * A copied field is valid only if the value occurs inside its own valid
 * quote. Returns the normalised value.
 */
function quotedField(
  value: string | null | undefined,
  quote: string | null | undefined,
  pageNorm: string,
): string | null {
  const q = validQuote(quote, pageNorm);
  if (!q) return null;
  if (!value) return null;
  const v = normalizeSpace(value);
  if (v === "" || !q.includes(v)) return null;
  return v;
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function parseWall(wall: string): WallParts | null {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(wall);
  if (!m) return null;
  const parts: WallParts = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? "00"),
    minute: Number(m[5] ?? "00"),
    second: Number(m[6] ?? "00"),
  };
  // Round-trip: reject Feb 30, hour 25, and other non-dates.
  const check = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ),
  );
  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() !== parts.month - 1 ||
    check.getUTCDate() !== parts.day ||
    check.getUTCHours() !== parts.hour ||
    check.getUTCMinutes() !== parts.minute ||
    check.getUTCSeconds() !== parts.second
  ) {
    return null;
  }
  return parts;
}

/** Wall time + valid quote -> UTC ISO. Null when either check fails. */
function quotedTime(
  wall: string | null | undefined,
  quote: string | null | undefined,
  pageNorm: string,
  timeZone: string,
): string | null {
  if (!wall || !validQuote(quote, pageNorm)) return null;
  const parts = parseWall(wall);
  if (!parts) return null;
  try {
    return zonedLocalToUtc(
      {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour,
        minute: parts.minute,
        second: parts.second,
      },
      timeZone,
    );
  } catch {
    return null;
  }
}

/**
 * The event link must be an exact member of the page link set (stronger
 * than a substring quote) with its evidence in the links block; otherwise
 * the official listing page itself is the link. Never null: drafts need it.
 */
function eventSourceUrl(
  value: string | null | undefined,
  quote: string | null | undefined,
  linkSet: Set<string>,
  linksNorm: string,
  pageUrl: string,
): string {
  const trimmed = value?.trim() ?? "";
  if (
    trimmed !== "" &&
    linkSet.has(trimmed) &&
    validQuote(quote, linksNorm) !== null
  ) {
    return trimmed;
  }
  return pageUrl;
}

/** Strip fences, then take the first {...} span. Throws when absent. */
export function extractJsonObject(content: string): unknown {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("no JSON object in extraction reply");
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
}

function toDraft(
  raw: unknown,
  page: ExtractionPage,
  source: SourceConfig,
  timeZone: string,
  pageNorm: string,
  linksNorm: string,
  linkSet: Set<string>,
): EventDraft | null {
  const parsed = ExtractedEventSchema.safeParse(raw);
  if (!parsed.success) return null;
  const ev: ExtractedEvent = parsed.data;
  const title = quotedField(ev.title, ev.title_evidence, pageNorm);
  const startsAtUtc = quotedTime(
    ev.starts_at,
    ev.starts_at_evidence,
    pageNorm,
    timeZone,
  );
  // Drop rule: no title quote or no start quote, no event.
  if (!title || !startsAtUtc) return null;
  let endsAtUtc = quotedTime(
    ev.ends_at,
    ev.ends_at_evidence,
    pageNorm,
    timeZone,
  );
  if (endsAtUtc && Date.parse(endsAtUtc) < Date.parse(startsAtUtc)) {
    endsAtUtc = null;
  }
  const description = quotedField(
    ev.description,
    ev.description_evidence,
    pageNorm,
  );
  const venueName = quotedField(
    ev.venue_name,
    ev.venue_name_evidence,
    pageNorm,
  );
  const venueAddress = quotedField(
    ev.venue_address,
    ev.venue_address_evidence,
    pageNorm,
  );
  const sourceUrl = eventSourceUrl(
    ev.source_url,
    ev.source_url_evidence,
    linkSet,
    linksNorm,
    page.url,
  );
  // Non-scheduled status needs its own quote, else it is scheduled.
  const status =
    ev.status &&
    ev.status !== "scheduled" &&
    validQuote(ev.status_evidence, pageNorm)
      ? ev.status
      : "scheduled";
  // Raw text is the accepted evidence: compact, stable, provenance.
  const rawText = [
    ev.title_evidence,
    ev.starts_at_evidence,
    ev.ends_at_evidence,
    ev.description_evidence,
    ev.venue_name_evidence,
    ev.venue_address_evidence,
  ]
    .filter((q): q is string => typeof q === "string")
    .map((q) => normalizeSpace(q))
    .filter((q) => q !== "" && pageNorm.includes(q))
    .join("\n");
  const draft = {
    sourceUrl,
    title,
    ...(description ? { description } : {}),
    startsAtUtc,
    ...(endsAtUtc ? { endsAtUtc } : {}),
    timezone: timeZone,
    ...(venueName ? { venueName } : {}),
    ...(venueAddress ? { venueAddress } : {}),
    ...(source.category ? { category: source.category } : {}),
    status,
    rawText: rawText === "" ? `${title}\n${startsAtUtc}` : rawText,
  };
  // Title + starts_at quotes always survive (checked above), so rawText is
  // never empty here; the fallback only satisfies the schema type.
  const checked = EventDraftSchema.safeParse(draft);
  if (!checked.success) return null;
  return checked.data;
}

export interface ExtractDeps {
  config: LlmConfig;
  fetchImpl?: typeof fetch;
  chatFn?: ChatFn;
  now?: Date;
}

/**
 * Extract upcoming events from one listing page. Model failures, unparsable
 * replies, and unquoted events yield zero drafts (logged); only a spent $2
 * run budget throws (BudgetExceeded from the client) so the run stops
 * spending loudly instead of silently returning nothing — except a spent
 * Baseten cap, which skips the page for a later run instead of throwing.
 */
export async function extractEventsFromPage(
  page: ExtractionPage,
  source: SourceConfig,
  deps: ExtractDeps,
): Promise<EventDraft[]> {
  const now = deps.now ?? new Date();
  const timeZone =
    source.overrideTimezone ?? source.timezone ?? DEFAULT_TIMEZONE;
  const today = now.toISOString().slice(0, 10);
  const chatFn: ChatFn = deps.chatFn ?? chat;
  const messages = buildExtractionMessages({
    sourceName: source.name,
    pageUrl: page.url,
    today,
    timezone: timeZone,
    text: page.text,
    links: page.links,
  });
  // No-training-route sources: Baseten only, never the contributor model.
  const basetenOnly = optionsForSource(source.name).noTrainingRoute === true;
  let result: ChatResult;
  try {
    result = await chatFn(
      {
        task: "listing_extraction",
        messages,
        maxTokens: EXTRACTION_MAX_TOKENS,
        ...(basetenOnly
          ? { provider: "baseten" as const, fallback: "none" as const }
          : {}),
      },
      { fetchImpl: deps.fetchImpl, config: deps.config },
    );
  } catch (error) {
    if (error instanceof BudgetExceeded && error.limit === "baseten_total") {
      console.warn(
        `extract: ${page.url} skipped, Baseten cap reached (retry later)`,
      );
      return [];
    }
    throw error;
  }
  if (!result.ok) {
    console.warn(
      `extract: ${page.url} model call failed (${result.error.kind}): ${result.error.message}`,
    );
    return [];
  }
  let output: unknown;
  try {
    output = extractJsonObject(result.value.content);
  } catch (error) {
    console.warn(
      `extract: ${page.url} reply was not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
  const parsed = ExtractionOutputSchema.safeParse(output);
  if (!parsed.success) {
    console.warn(`extract: ${page.url} reply had no events array`);
    return [];
  }
  const pageNorm = normalizeSpace(page.text);
  const linksNorm = normalizeSpace(
    page.links.map((l) => `${l.text} -> ${l.url}`).join("\n"),
  );
  const linkSet = new Set(page.links.map((l) => l.url));
  const drafts: EventDraft[] = [];
  let dropped = 0;
  for (const raw of parsed.data.events.slice(
    0,
    EXTRACTION_MAX_EVENTS_PER_PAGE,
  )) {
    const draft = toDraft(
      raw,
      page,
      source,
      timeZone,
      pageNorm,
      linksNorm,
      linkSet,
    );
    if (draft) drafts.push(draft);
    else dropped++;
  }
  if (dropped > 0) {
    console.warn(
      `extract: ${page.url} dropped ${dropped} event(s) without valid evidence`,
    );
  }
  return drafts;
}
