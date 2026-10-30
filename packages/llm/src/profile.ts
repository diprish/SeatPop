import { PreferencesSchema, redactPii, type Preferences } from "@seatpop/shared";
import { chat } from "./client";
import type { LlmConfig } from "./config";
import type { ChatResult, LlmError } from "./types";

/**
 * Household profile parsing (phase 4): "describe your household in your
 * own words" (typed only) → structured preferences for editable chips.
 *
 * Privacy: PII is redacted before the call, the task runs on standard
 * Spark via Meta only (never contributor, never Baseten — enforced by
 * PUBLIC_TEXT_TASKS exclusion and the provider gate), and the raw text
 * is discarded by the caller (never stored or logged). Names cannot be
 * detected reliably, so the UI must warn users not to include them.
 *
 * The prompt is inline (not a prompts/*.md file) so the web route can
 * use this without filesystem reads at request time.
 */

export const PROFILE_PARSE_VERSION = "profile.v1";

const SYSTEM_PROMPT = `You turn a household's self-description into structured activity-search preferences. Reply with raw JSON only, no prose, matching this shape:
{"members": [{"age_band": "baby|preschool|kids|teens|adults|seniors", "include_adjacent": true}], "max_price_cents": 2500 | null, "free_only": false, "max_distance_km": 5 | null, "fsa": "K1S" | null, "availability": {"sat": ["morning"]}, "language": [], "accessibility": [], "interests": [], "avoid": []}
Rules, in order:
- members: one per person or age group mentioned (baby 0-2, preschool 3-5, kids 6-12, teens 13-17, adults 18-64, seniors 65+). If no ages are stated, use exactly one adults member. include_adjacent is always true.
- max_price_cents: integer cents ("under $25" -> 2500). Omit (null) when no budget is stated. "free" activities means free_only true, not a price of 0.
- max_distance_km: number ("within 5 km" -> 5). Omit (null) when unstated.
- fsa: the 3-character area code when stated ("K1S", "near K2H"); otherwise null. Never invent one.
- availability: weekday keys (mon,tue,wed,thu,fri,sat,sun) to parts of day (morning, afternoon, evening, night). "weekends" means sat+sun; "evenings" means evening. Omit days not mentioned; use {} when nothing is stated.
- language/accessibility: list stated needs only ("French", "wheelchair access"). Empty arrays when unstated.
- interests/avoid: short lowercase keywords from the text ("music", "crowds"). Empty arrays when unstated.
- Never copy names, emails, phone numbers, or addresses into any field. When in doubt, leave the field empty: the user edits the chips afterward.`;

/** First { ... } block of a reply (the model is asked for raw JSON only). */
function extractJson(content: string): unknown {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("no JSON object in profile-parse reply");
  }
  return JSON.parse(content.slice(start, end + 1));
}

export type ProfileParseResult =
  | { ok: true; value: { prefs: Preferences; model: string } }
  | { ok: false; error: LlmError };

export interface ProfileParseDeps {
  config: LlmConfig;
  fetchImpl?: typeof fetch;
  chatFn?: (
    request: Parameters<typeof chat>[0],
    options?: Parameters<typeof chat>[1],
  ) => Promise<ChatResult>;
}

/**
 * Parse redacted household text into preferences. Budget exhaustion
 * throws BudgetExceeded (the caller falls back to empty editable chips).
 */
export async function parseProfileDescription(
  text: string,
  deps: ProfileParseDeps,
): Promise<ProfileParseResult> {
  const redacted = redactPii(text).trim().slice(0, 2000);
  if (redacted === "") {
    return {
      ok: false,
      error: { kind: "schema", message: "description is empty" },
    };
  }
  const chatFn = deps.chatFn ?? chat;
  const result = await chatFn(
    {
      task: "profile_parse",
      provider: "meta",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: redacted },
      ],
      temperature: 0,
    },
    { fetchImpl: deps.fetchImpl, config: deps.config },
  );
  if (!result.ok) return { ok: false, error: result.error };
  let json: unknown;
  try {
    json = extractJson(result.value.content);
  } catch {
    return {
      ok: false,
      error: { kind: "schema", message: "model reply was not JSON" },
    };
  }
  const parsed = PreferencesSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        kind: "schema",
        message: `model reply failed preferences validation: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      },
    };
  }
  return { ok: true, value: { prefs: parsed.data, model: result.value.model } };
}
