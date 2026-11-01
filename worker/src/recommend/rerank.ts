import { z } from "zod";
import {
  BudgetExceeded,
  chat,
  type ChatResult,
  type LlmConfig,
} from "@seatpop/llm";
import {
  fitLevelForMember,
  possessiveBandLabel,
  type AgeBand,
  type AgeFitLevel,
  type Preferences,
} from "@seatpop/shared";

/**
 * Stage-3 rerank (worker/recommend): the top 30 stage-2 candidates,
 * reordered by standard Spark with one reason each. Reasons may cite
 * only the candidate's stored fields and must mark claims stated vs
 * inferred; ids outside the candidate set are discarded (CONTEXT rule 3).
 * Any failure (timeout, invalid JSON, budget stop) returns the stage-2
 * order with templated reasons (CONTEXT rules 5 + 11).
 */

export interface RerankCandidate {
  event_id: string;
  title: string;
  summary_short: string | null;
  category: string | null;
  starts_at: string;
  venue_name: string | null;
  price_label: string;
  age_min: number | null;
  age_max: number | null;
  age_flag: string | null;
  tags: string[];
}

export interface RerankedItem {
  event_id: string;
  reason: string;
  /** False when the reason is the deterministic template, not the model. */
  fromModel: boolean;
}

export interface RerankOutcome {
  items: RerankedItem[];
  /** API-reported model id, or null when every reason is templated. */
  model: string | null;
  fallback: boolean;
}

const RerankItemSchema = z.object({
  event_id: z.string().min(1),
  reason: z.string().min(1).max(280),
});

const RerankReplySchema = z.array(RerankItemSchema).min(1);

export const RERANK_VERSION = "rerank.v2";

/** A reason counts as marked when it says what is stated vs inferred. */
export function reasonMarked(reason: string): boolean {
  const lower = reason.toLowerCase();
  return lower.includes("stated") || lower.includes("inferred");
}

/** Best fit level per band across the household (members may repeat bands). */
export function bandFits(
  candidate: Pick<RerankCandidate, "age_min" | "age_max">,
  prefs: Pick<Preferences, "members">,
): Map<AgeBand, AgeFitLevel> {
  const rank: Record<AgeFitLevel, number> = {
    exact: 0,
    unknown: 1,
    adjacent: 2,
    none: 3,
  };
  const fits = new Map<AgeBand, AgeFitLevel>();
  for (const member of prefs.members) {
    const level = fitLevelForMember(candidate, member);
    const prev = fits.get(member.age_band);
    if (prev === undefined || rank[level] < rank[prev]) {
      fits.set(member.age_band, level);
    }
  }
  return fits;
}

const BAND_WORDS: Array<{ band: AgeBand; word: RegExp }> = [
  { band: "baby", word: /\b(babys?|babies)\b/i },
  { band: "preschool", word: /\bpreschool(ers?)?\b/i },
  { band: "kids", word: /\bkids?\b/i },
  { band: "teens", word: /\bteens?\b/i },
  { band: "adults", word: /\badults?\b/i },
  { band: "seniors", word: /\bseniors?\b/i },
];

/**
 * Bands a reason claims the event fits: a band word with fit/fits/fitting
 * in the 20 characters before it ("fits preschool", "a good fit for
 * kids"). "Fits well" claims no band; "suits kids" claims no fit.
 */
export function claimedFitBands(reason: string): AgeBand[] {
  const claimed: AgeBand[] = [];
  for (const { band, word } of BAND_WORDS) {
    const match = word.exec(reason);
    if (!match || match.index === undefined) continue;
    const before = reason.slice(Math.max(0, match.index - 20), match.index);
    if (/\bfits?\b|\bfitting\b/i.test(before)) claimed.push(band);
  }
  return claimed;
}

/**
 * A model reason stands only when every band it claims as a fit is an
 * exact fit for the household. Anything else ("fits preschool" for an
 * adjacent-only match, a fit claimed for a non-member band) falls back
 * to the templated reason per item.
 */
export function reasonFitOk(
  reason: string,
  fits: Map<AgeBand, AgeFitLevel>,
): boolean {
  return claimedFitBands(reason).every((band) => fits.get(band) === "exact");
}

/**
 * Deterministic reason from stored fields only (always marked stated).
 * Adjacent-only matches name the near miss as "close to your X age"
 * (inferred) — never "fits X".
 */
export function templatedReason(
  candidate: Pick<
    RerankCandidate,
    "title" | "starts_at" | "venue_name" | "price_label" | "age_flag"
  >,
  fits?: Map<AgeBand, AgeFitLevel>,
): string {
  const date = candidate.starts_at.slice(0, 10);
  const venue = candidate.venue_name ? ` at ${candidate.venue_name}` : "";
  const flag = candidate.age_flag ? ` (${candidate.age_flag})` : "";
  const base = `${candidate.title} on ${date}${venue}, ${candidate.price_label}${flag} (stated)`;
  if (!fits) return base;
  const levels = [...fits.values()];
  if (levels.includes("exact") || !levels.includes("adjacent")) return base;
  const bands = [...fits.entries()]
    .filter(([, level]) => level === "adjacent")
    .map(([band]) => possessiveBandLabel(band));
  const joined =
    bands.length > 1
      ? `${bands.slice(0, -1).join(", ")} and ${bands[bands.length - 1] as string}`
      : (bands[0] as string);
  const ages = bands.length > 1 ? "ages" : "age";
  return `${base}, close to your ${joined} ${ages} (inferred)`;
}

function prefsSummary(prefs: Preferences): string {
  const parts: string[] = [];
  parts.push(
    `members: ${prefs.members.map((m) => m.age_band).join(", ") || "any"}`,
  );
  if (prefs.free_only) parts.push("free only");
  else if (prefs.max_price_cents !== undefined) {
    parts.push(`budget under $${(prefs.max_price_cents / 100).toFixed(2)}`);
  }
  if (prefs.max_distance_km !== undefined) {
    parts.push(`within ${prefs.max_distance_km} km of ${prefs.fsa ?? "home"}`);
  }
  if (prefs.interests.length > 0) {
    parts.push(`likes ${prefs.interests.join(", ")}`);
  }
  if (prefs.avoid.length > 0) parts.push(`avoids ${prefs.avoid.join(", ")}`);
  // Bands, budget, area, interests only — no names exist to leak, and
  // nothing else personal is included.
  return parts.join("; ");
}

function buildMessages(
  candidates: RerankCandidate[],
  prefs: Preferences,
): Array<{ role: "system" | "user"; content: string }> {
  const lines = candidates.map((c, i) => {
    const agefit = [...bandFits(c, prefs).entries()]
      .map(([band, level]) => `${band}:${level}`)
      .join(",");
    const bits = [
      `${i + 1}. id=${c.event_id}`,
      `title=${JSON.stringify(c.title)}`,
      `starts=${c.starts_at.slice(0, 16)}`,
      `venue=${c.venue_name ?? "unknown"}`,
      `category=${c.category ?? "unknown"}`,
      `price=${c.price_label}`,
      `ages=${c.age_min ?? "?"}-${c.age_max ?? "?"}`,
      `agefit=${agefit}`,
      `tags=${c.tags.join("|") || "none"}`,
    ];
    if (c.summary_short) bits.push(`summary=${JSON.stringify(c.summary_short)}`);
    if (c.age_flag) bits.push(`flag=${c.age_flag}`);
    return bits.join(" ");
  });
  return [
    {
      role: "system",
      content:
        "Reorder these activity candidates for the household and give one short reason (max 140 chars) per event. " +
        "Reply with raw JSON only: an array of {event_id, reason} in best-first order. " +
        "Reasons may cite ONLY the listed fields for that event; mark every claim (stated) when it repeats a listed field or (inferred) when it goes beyond. " +
        "Each candidate lists agefit=<band>:<exact|adjacent|unknown|none> per household band (precomputed — trust it over the raw ages). " +
        "Never write that an event 'fits <band>' unless that band's fit is exact; for adjacent bands write 'close to' instead (e.g. \"close to your preschooler's age (inferred)\"); for unknown ages never claim any age fit. " +
        "Use only ids from the list.",
    },
    {
      role: "user",
      content: `Household: ${prefsSummary(prefs)}\nCandidates:\n${lines.join("\n")}`,
    },
  ];
}

function extractJsonArray(content: string): unknown {
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("no JSON array in reply");
  return JSON.parse(content.slice(start, end + 1));
}

export interface RerankDeps {
  config: LlmConfig;
  fetchImpl?: typeof fetch;
  chatFn?: (
    request: Parameters<typeof chat>[0],
    options?: Parameters<typeof chat>[1],
  ) => Promise<ChatResult>;
}

/**
 * Rerank stage-2 candidates. Unknown ids are discarded, unmarked or
 * missing reasons fall back to the template per item, reasons claiming
 * "fits <band>" for a non-exact band fall back too, and dropped
 * candidates rejoin at the end in stage-2 order — the returned order
 * always covers every input candidate exactly once.
 */
export async function rerankCandidates(
  candidates: RerankCandidate[],
  prefs: Preferences,
  deps: RerankDeps,
): Promise<RerankOutcome> {
  const byId = new Map(candidates.map((c) => [c.event_id, c]));
  const fitsById = new Map(
    candidates.map((c) => [c.event_id, bandFits(c, prefs)] as const),
  );
  const fallback = (model: string | null): RerankOutcome => ({
    items: candidates.map((c) => ({
      event_id: c.event_id,
      reason: templatedReason(
        c,
        fitsById.get(c.event_id) as Map<AgeBand, AgeFitLevel>,
      ),
      fromModel: false,
    })),
    model,
    fallback: true,
  });
  if (candidates.length === 0) {
    return { items: [], model: null, fallback: false };
  }
  const chatFn = deps.chatFn ?? chat;
  let result: ChatResult;
  try {
    result = await chatFn(
      {
        task: "rerank",
        provider: "meta",
        messages: buildMessages(candidates, prefs),
        temperature: 0,
        // 30 candidates × (id + reason): the 512 floor truncates to nothing.
        maxTokens: 4096,
      },
      { fetchImpl: deps.fetchImpl, config: deps.config },
    );
  } catch (error) {
    if (error instanceof BudgetExceeded) return fallback(null);
    throw error;
  }
  if (!result.ok) return fallback(null);
  let json: unknown;
  try {
    json = extractJsonArray(result.value.content);
  } catch {
    return fallback(result.value.model);
  }
  const parsed = RerankReplySchema.safeParse(json);
  if (!parsed.success) return fallback(result.value.model);
  const items: RerankedItem[] = [];
  const seen = new Set<string>();
  for (const entry of parsed.data) {
    const candidate = byId.get(entry.event_id);
    // Unknown or duplicate ids are discarded (CONTEXT rule 3).
    if (!candidate || seen.has(entry.event_id)) continue;
    seen.add(entry.event_id);
    const fits = fitsById.get(entry.event_id) as Map<AgeBand, AgeFitLevel>;
    const ok =
      reasonMarked(entry.reason) && reasonFitOk(entry.reason, fits);
    items.push({
      event_id: entry.event_id,
      reason: ok ? entry.reason : templatedReason(candidate, fits),
      fromModel: ok,
    });
  }
  for (const candidate of candidates) {
    if (seen.has(candidate.event_id)) continue;
    items.push({
      event_id: candidate.event_id,
      reason: templatedReason(
        candidate,
        fitsById.get(candidate.event_id) as Map<AgeBand, AgeFitLevel>,
      ),
      fromModel: false,
    });
  }
  return {
    items,
    model: result.value.model,
    fallback: items.every((item) => !item.fromModel),
  };
}
