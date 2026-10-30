import { z } from "zod";
import { PriceKindSchema } from "@seatpop/shared";
import { CsvError, parseCsv } from "./csv";

/**
 * Golden-set I/O for the phase-3 enrichment eval (worker/eval).
 *
 * `eval:export` writes labeling.csv (listing text only, never a model
 * answer); a human labels it; `eval:import` validates every row and writes
 * golden/events.jsonl — listing ALL invalid rows and writing nothing until
 * every row is fixed. The one labeling rule, also printed in the CSV
 * header: label only what the text says; blank means the text does not say.
 */

export const LABELING_RULE =
  "label only what the text says; blank means the text does not say";

/** Context columns (read-only listing data) then label columns. */
export const LABELING_COLUMNS = [
  "event_id",
  "title",
  "description",
  "venue",
  "source",
  "category",
  "age_min",
  "age_max",
  "price_kind",
  "amount",
  "setting",
  "language",
  "registration_hint",
  "accessibility",
  "labeled",
  "notes",
] as const;

export const GoldenLabelsSchema = z.object({
  age_min: z.number().int().min(0).max(130).nullable(),
  age_max: z.number().int().min(0).max(130).nullable(),
  price_kind: PriceKindSchema,
  amount_min_cents: z.number().int().min(0).nullable(),
  amount_max_cents: z.number().int().min(0).nullable(),
  setting: z.string().nullable(),
  language: z.string().nullable(),
  registration_hint: z.string().nullable(),
  accessibility: z.array(z.string()),
});
export type GoldenLabels = z.infer<typeof GoldenLabelsSchema>;

export const GoldenEventSchema = z.object({
  event_id: z.string().min(1),
  title: z.string(),
  description: z.string().nullable(),
  venue_name: z.string().nullable(),
  source: z.string(),
  category: z.string().nullable(),
  labels: GoldenLabelsSchema,
});
export type GoldenEvent = z.infer<typeof GoldenEventSchema>;

export interface AmountCents {
  minCents: number;
  maxCents: number;
}

export type AmountParse =
  | { ok: true; value: AmountCents | null }
  | { ok: false; error: string };

/**
 * Parse an amount cell into integer cents. Blank means the text states no
 * amount. Accepts "$25", "25", "$25.00", "$1,200", and ranges "10-20",
 * "$10-$20", "$10–$20", "10 to 20". A single value means min == max.
 */
export function parseAmountCell(cell: string): AmountParse {
  const trimmed = cell.trim();
  if (trimmed === "") return { ok: true, value: null };
  const compact = trimmed
    .replace(/[$,\s]/g, "")
    .replace(/[–—]/g, "-")
    .toLowerCase();
  const parts = compact.includes("to")
    ? compact.split("to")
    : compact.split("-");
  if (parts.length > 2) {
    return { ok: false, error: `amount ${JSON.stringify(cell)} is not a value or min-max range` };
  }
  const cents: number[] = [];
  for (const part of parts) {
    const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(part ?? "");
    if (!m) {
      return { ok: false, error: `amount ${JSON.stringify(cell)} is not dollars like 25, $25.00, or 10-20` };
    }
    const dollars = Number(m[1]);
    const frac = (m[2] ?? "").padEnd(2, "0");
    cents.push(dollars * 100 + Number(frac));
  }
  const minCents = cents[0] as number;
  const maxCents = (cents[1] ?? cents[0]) as number;
  if (minCents > maxCents) {
    return { ok: false, error: `amount ${JSON.stringify(cell)} has min above max` };
  }
  return { ok: true, value: { minCents, maxCents } };
}

const parseAgeCell = (
  cell: string,
  column: string,
): { ok: true; value: number | null } | { ok: false; error: string } => {
  const trimmed = cell.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: `${column} ${JSON.stringify(cell)} is not a whole number of years` };
  }
  const value = Number(trimmed);
  if (value > 130) {
    return { ok: false, error: `${column} ${JSON.stringify(cell)} is above 130` };
  }
  return { ok: true, value };
};

export interface ImportError {
  /** 1-based line number in the CSV file (counting comment lines). */
  line: number;
  eventId: string;
  reasons: string[];
}

export interface ImportSuccess {
  ok: true;
  events: GoldenEvent[];
}

export interface ImportFailure {
  ok: false;
  errors: ImportError[];
}

/**
 * Validate labeled CSV text into golden events. Every row must carry an
 * "x" in `labeled` (the labeler's signature that the row is done) and
 * valid cells; returns every invalid row at once so one fix pass suffices.
 */
export function importCsvToGolden(
  csvText: string,
): ImportSuccess | ImportFailure {
  let rows: string[][];
  try {
    rows = parseCsv(csvText);
  } catch (error) {
    const message =
      error instanceof CsvError ? error.message : "could not parse CSV";
    return { ok: false, errors: [{ line: 1, eventId: "", reasons: [message] }] };
  }
  if (rows.length === 0) {
    return {
      ok: false,
      errors: [{ line: 1, eventId: "", reasons: ["CSV has no rows"] }],
    };
  }
  const header = rows[0] as string[];
  const expected = [...LABELING_COLUMNS];
  if (
    header.length !== expected.length ||
    header.some((cell, i) => cell !== expected[i])
  ) {
    return {
      ok: false,
      errors: [
        {
          line: 1,
          eventId: "",
          reasons: [
            `header must be exactly: ${expected.join(",")}`,
          ],
        },
      ],
    };
  }
  // Line numbers count the raw file lines: recompute by scanning so
  // multi-line quoted descriptions still report the row's start line.
  const rowStartLines = rowStartLineNumbers(csvText);
  const errors: ImportError[] = [];
  const events: GoldenEvent[] = [];
  const seenIds = new Set<string>();
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r] as string[];
    const line = rowStartLines[r] ?? r + 1;
    const reasons: string[] = [];
    const get = (i: number): string => (cells[i] ?? "").trim();
    const eventId = get(0);
    if (eventId === "") reasons.push("event_id is empty");
    else if (seenIds.has(eventId)) reasons.push(`duplicate event_id ${eventId}`);
    else seenIds.add(eventId);
    if (cells.length !== expected.length) {
      reasons.push(
        `expected ${expected.length} columns, found ${cells.length}`,
      );
    }
    const ageMin = parseAgeCell(get(6), "age_min");
    const ageMax = parseAgeCell(get(7), "age_max");
    if (!ageMin.ok) reasons.push(ageMin.error);
    if (!ageMax.ok) reasons.push(ageMax.error);
    if (
      ageMin.ok &&
      ageMax.ok &&
      ageMin.value !== null &&
      ageMax.value !== null &&
      ageMin.value > ageMax.value
    ) {
      reasons.push(`age_min ${ageMin.value} is above age_max ${ageMax.value}`);
    }
    const kindRaw = get(8);
    const kindParsed =
      kindRaw === ""
        ? { success: true as const, data: "unknown" as const }
        : PriceKindSchema.safeParse(kindRaw.toLowerCase());
    if (!kindParsed.success) {
      reasons.push(
        `price_kind ${JSON.stringify(kindRaw)} must be blank or one of free, paid, pay_what_you_can, donation, member_only, unknown`,
      );
    }
    const amount = parseAmountCell(get(9));
    if (!amount.ok) reasons.push(amount.error);
    const accessibility = get(13)
      .split(";")
      .map((item) => item.trim().replace(/\s+/g, " "))
      .filter((item) => item !== "");
    if (get(13) !== "" && accessibility.length === 0) {
      reasons.push("accessibility has separators but no items");
    }
    if (get(14).toLowerCase() !== "x") {
      reasons.push('labeled must be "x" (the row is not marked done)');
    }
    if (reasons.length > 0) {
      errors.push({ line, eventId, reasons });
      continue;
    }
    const labels: GoldenLabels = {
      age_min: (ageMin as { value: number | null }).value,
      age_max: (ageMax as { value: number | null }).value,
      price_kind: (kindParsed as { data: GoldenLabels["price_kind"] }).data,
      amount_min_cents: amount.ok ? (amount.value?.minCents ?? null) : null,
      amount_max_cents: amount.ok ? (amount.value?.maxCents ?? null) : null,
      setting: blankToNull(get(10)),
      language: blankToNull(get(11)),
      registration_hint: blankToNull(get(12)),
      accessibility,
    };
    const eventParsed = GoldenEventSchema.safeParse({
      event_id: eventId,
      title: get(1),
      description: blankToNull(get(2)),
      venue_name: blankToNull(get(3)),
      source: get(4),
      category: blankToNull(get(5)),
      labels,
    });
    if (!eventParsed.success) {
      errors.push({
        line,
        eventId,
        reasons: eventParsed.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`,
        ),
      });
      continue;
    }
    events.push(eventParsed.data);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, events };
}

function blankToNull(value: string): string | null {
  return value === "" ? null : value;
}

/**
 * Map each parsed data-row index to its 1-based start line in the raw
 * text, so error reports point at the right spreadsheet row even when
 * quoted descriptions span lines. Index 0 is the header row.
 */
function rowStartLineNumbers(csvText: string): number[] {
  const starts: number[] = [];
  let line = 1;
  let inQuotes = false;
  let recordHasContent = false;
  let recordStartLine = 1;
  let atRecordStart = true;

  const finishRecord = (): void => {
    if (recordHasContent) starts.push(recordStartLine);
    recordHasContent = false;
    atRecordStart = true;
  };
  const content = (): void => {
    if (!recordHasContent) recordStartLine = line;
    recordHasContent = true;
    atRecordStart = false;
  };

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i] as string;
    if (atRecordStart && !inQuotes && !recordHasContent && ch === "#") {
      while (i < csvText.length && csvText[i] !== "\n" && csvText[i] !== "\r") {
        i++;
      }
      if (i >= csvText.length) break;
      if (csvText[i] === "\r" && csvText[i + 1] === "\n") i++;
      line++;
      continue;
    }
    if (inQuotes) {
      if (ch === '"') {
        if (csvText[i + 1] === '"') i++;
        else inQuotes = false;
        content();
        continue;
      }
      if (ch === "\n") line++;
      else if (ch === "\r") {
        if (csvText[i + 1] === "\n") i++;
        line++;
      }
      content();
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      content();
      continue;
    }
    if (ch === ",") {
      content();
      continue;
    }
    if (ch === "\r" && csvText[i + 1] === "\n") {
      finishRecord();
      line++;
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      finishRecord();
      line++;
      continue;
    }
    content();
  }
  finishRecord();
  return starts;
}

/** Parse one golden/events.jsonl file (one JSON object per line). */
export function parseGoldenJsonl(text: string): GoldenEvent[] {
  const events: GoldenEvent[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] as string).trim();
    if (line === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`golden/events.jsonl line ${i + 1}: not valid JSON`);
    }
    const parsed = GoldenEventSchema.safeParse(json);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => issue.message).join("; ");
      throw new Error(`golden/events.jsonl line ${i + 1}: ${details}`);
    }
    events.push(parsed.data);
  }
  return events;
}
