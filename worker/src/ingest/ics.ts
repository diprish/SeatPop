import type { EventCategory } from "@seatpop/shared";
import { fetchIndexPages, sameSite } from "./linkindex";
import {
  EventDraftSchema,
  type Adapter,
  type AdapterContext,
  type EventDraft,
  type SourceConfig,
} from "./types";
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedLocalToUtc } from "./tz";

/**
 * Minimal iCalendar parser plus recurrence expansion, written for this repo.
 *
 * Supported: VEVENT with SUMMARY/DESCRIPTION/LOCATION/URL/UID/STATUS/DTSTART/
 * DTEND/DURATION/RRULE (DAILY, WEEKLY, MONTHLY, YEARLY with INTERVAL, COUNT,
 * UNTIL, BYDAY, BYMONTHDAY, BYMONTH)/EXDATE/RECURRENCE-ID overrides.
 * Not supported: VTIMEZONE definitions (unknown TZIDs fall back to the
 * source time zone), HOURLY/MINUTELY/SECONDLY frequencies (single instance
 * only), RDATE, VALARM/VTODO/VJOURNAL.
 */

interface IcsLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface VEvent {
  lines: IcsLine[];
  /** Raw block text: stable input for raw_hash. */
  raw: string;
}

export function unfoldIcsLines(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    if (
      (rawLine.startsWith(" ") || rawLine.startsWith("\t")) &&
      out.length > 0
    ) {
      out[out.length - 1] += rawLine.slice(1);
    } else if (rawLine !== "") {
      out.push(rawLine);
    }
  }
  return out;
}

function splitProperty(line: string): { head: string; value: string } | null {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === ":" && !inQuotes) {
      return { head: line.slice(0, i), value: line.slice(i + 1) };
    }
  }
  return null;
}

function parseLine(line: string): IcsLine | null {
  const split = splitProperty(line);
  if (!split) return null;
  const headParts = split.head.split(";");
  const name = (headParts[0] ?? "").trim().toUpperCase();
  if (name === "") return null;
  const params: Record<string, string> = {};
  for (const part of headParts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toUpperCase();
    let val = part.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    params[key] = val;
  }
  return { name, params, value: split.value };
}

export function parseVEvents(text: string): VEvent[] {
  const events: VEvent[] = [];
  let current: string[] | null = null;
  for (const line of unfoldIcsLines(text)) {
    const parsed = parseLine(line);
    if (parsed?.name === "BEGIN" && parsed.value.toUpperCase() === "VEVENT") {
      current = [];
      continue;
    }
    if (parsed?.name === "END" && parsed.value.toUpperCase() === "VEVENT") {
      if (current) {
        const lines = current
          .map(parseLine)
          .filter((l): l is IcsLine => l !== null);
        events.push({ lines, raw: current.join("\n") });
      }
      current = null;
      continue;
    }
    if (current) current.push(line);
  }
  return events;
}

export function unescapeIcsText(value: string): string {
  return value
    .replace(/\\N/gi, "\n")
    .replace(/\\;/g, ";")
    .replace(/\\,/g, ",")
    .replace(/\\\\/g, "\\");
}

interface DateParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

interface EventStart {
  parts: DateParts;
  zone: string;
  allDay: boolean;
}

const DATE_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/;

function parseDateTimeProp(
  line: IcsLine,
  defaultZone: string,
): EventStart | null {
  const match = DATE_RE.exec(line.value);
  if (!match) return null;
  const [, ys, ms, ds, hhs, mms, sss, zulu] = match;
  const parts: DateParts = {
    y: Number(ys),
    m: Number(ms),
    d: Number(ds),
    hh: Number(hhs ?? 0),
    mm: Number(mms ?? 0),
    ss: Number(sss ?? 0),
  };
  if (
    parts.m < 1 ||
    parts.m > 12 ||
    parts.d < 1 ||
    parts.d > 31 ||
    parts.hh > 23 ||
    parts.mm > 59 ||
    parts.ss > 60
  ) {
    return null;
  }
  const allDay =
    line.params["VALUE"]?.toUpperCase() === "DATE" || hhs === undefined;
  if (zulu === "Z") return { parts, zone: "UTC", allDay };
  const tzid = line.params["TZID"];
  if (tzid && isValidTimeZone(tzid)) return { parts, zone: tzid, allDay };
  return { parts, zone: defaultZone, allDay };
}

/** Minimal ISO-8601 duration subset: PnW, PnDTnHnMnS. Returns ms or null. */
function parseDurationMs(value: string): number | null {
  const match = /^P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/.exec(
    value,
  );
  if (!match) return null;
  const [, w, d, h, m, s] = match;
  if (
    w === undefined &&
    d === undefined &&
    h === undefined &&
    m === undefined &&
    s === undefined
  ) {
    return null;
  }
  return (
    (Number(w ?? 0) * 7 * 86400 +
      Number(d ?? 0) * 86400 +
      Number(h ?? 0) * 3600 +
      Number(m ?? 0) * 60 +
      Number(s ?? 0)) *
    1000
  );
}

interface RRule {
  freq: string;
  interval: number;
  count: number | undefined;
  untilMs: number | undefined;
  byday: Array<{ ord: number | undefined; weekday: number }>;
  bymonthday: number[];
  bymonth: number[];
}

const WEEKDAYS: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

function parseRRule(
  value: string,
  defaultZone: string,
  overrideZone?: string,
): RRule | null {
  const rule: RRule = {
    freq: "",
    interval: 1,
    count: undefined,
    untilMs: undefined,
    byday: [],
    bymonthday: [],
    bymonth: [],
  };
  for (const part of value.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toUpperCase();
    const val = part.slice(eq + 1).trim();
    if (key === "FREQ") rule.freq = val.toUpperCase();
    else if (key === "INTERVAL") {
      const n = Number(val);
      if (Number.isInteger(n) && n >= 1) rule.interval = n;
    } else if (key === "COUNT") {
      const n = Number(val);
      if (Number.isInteger(n) && n >= 1) rule.count = n;
    } else if (key === "UNTIL") {
      const parsed = parseDateTimeProp(
        { name: "UNTIL", params: {}, value: val },
        defaultZone,
      );
      if (!parsed) return null;
      if (overrideZone) parsed.zone = overrideZone;
      rule.untilMs = Date.parse(
        zonedLocalToUtc(
          {
            year: parsed.parts.y,
            month: parsed.parts.m,
            day: parsed.parts.d,
            hour: parsed.parts.hh,
            minute: parsed.parts.mm,
            second: parsed.parts.ss,
          },
          parsed.zone,
        ),
      );
    } else if (key === "BYDAY") {
      for (const item of val.split(",")) {
        const m = /^(-?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(item.trim());
        if (!m) return null;
        rule.byday.push({
          ord: m[1] === undefined ? undefined : Number(m[1]),
          weekday: WEEKDAYS[m[2] as string] as number,
        });
      }
    } else if (key === "BYMONTHDAY") {
      for (const item of val.split(",")) {
        const n = Number(item.trim());
        if (!Number.isInteger(n) || n === 0 || n < -31 || n > 31) return null;
        rule.bymonthday.push(n);
      }
    } else if (key === "BYMONTH") {
      for (const item of val.split(",")) {
        const n = Number(item.trim());
        if (!Number.isInteger(n) || n < 1 || n > 12) return null;
        rule.bymonth.push(n);
      }
    }
  }
  if (rule.freq === "") return null;
  return rule;
}

// --- Local-calendar arithmetic (expansion happens in wall-clock time so
// weekly/monthly patterns survive DST and late-evening UTC day shifts). ---

interface Ymd {
  y: number;
  m: number;
  d: number;
}

function toMsDay(date: Ymd): number {
  return Date.UTC(date.y, date.m - 1, date.d);
}

function fromMsDay(ms: number): Ymd {
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function addDays(date: Ymd, n: number): Ymd {
  return fromMsDay(toMsDay(date) + n * 86400000);
}

function weekdayOf(date: Ymd): number {
  return new Date(toMsDay(date)).getUTCDay();
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function cmpYmd(a: Ymd, b: Ymd): number {
  return toMsDay(a) - toMsDay(b);
}

/** Resolve one ordinal weekday (3TU, -1FR) within a month. Null when absent. */
function ordinalWeekdayOfMonth(
  y: number,
  m: number,
  ord: number,
  weekday: number,
): Ymd | null {
  if (ord > 0) {
    const first = weekdayOf({ y, m, d: 1 });
    const d = 1 + ((weekday - first + 7) % 7) + (ord - 1) * 7;
    return d <= daysInMonth(y, m) ? { y, m, d } : null;
  }
  const dim = daysInMonth(y, m);
  const last = weekdayOf({ y, m, d: dim });
  const d = dim - ((last - weekday + 7) % 7) + (ord + 1) * 7;
  return d >= 1 ? { y, m, d } : null;
}

function monthDaysForRule(
  y: number,
  m: number,
  rule: RRule,
  fallbackDay: number,
): Ymd[] {
  const dim = daysInMonth(y, m);
  if (rule.bymonthday.length > 0) {
    const days = rule.bymonthday
      .map((n) => (n > 0 ? n : dim + n + 1))
      .filter((d) => d >= 1 && d <= dim)
      .sort((a, b) => a - b);
    return days.map((d) => ({ y, m, d }));
  }
  const ordinals = rule.byday.filter((b) => b.ord !== undefined);
  if (ordinals.length > 0) {
    const days: Ymd[] = [];
    for (const b of ordinals) {
      const resolved = ordinalWeekdayOfMonth(y, m, b.ord as number, b.weekday);
      if (resolved) days.push(resolved);
    }
    return days.sort(cmpYmd);
  }
  if (rule.byday.length > 0) {
    const wanted = new Set(rule.byday.map((b) => b.weekday));
    const days: Ymd[] = [];
    for (let d = 1; d <= dim; d++) {
      if (wanted.has(weekdayOf({ y, m, d }))) days.push({ y, m, d });
    }
    return days;
  }
  return fallbackDay <= dim ? [{ y, m, d: fallbackDay }] : [];
}

/**
 * Expand a recurrence rule to occurrence start instants (UTC ms), ascending.
 * Candidates are generated in local wall-clock time from DTSTART, so COUNT
 * and UNTIL follow RFC 5545 even for pre-window occurrences; only in-window
 * starts are returned.
 */
export function expandRRule(
  start: EventStart,
  rule: RRule,
  windowStartMs: number,
  windowEndMs: number,
): number[] {
  const atTime = (date: Ymd): number =>
    Date.parse(
      zonedLocalToUtc(
        {
          year: date.y,
          month: date.m,
          day: date.d,
          hour: start.parts.hh,
          minute: start.parts.mm,
          second: start.parts.ss,
        },
        start.zone,
      ),
    );
  const startDate: Ymd = { y: start.parts.y, m: start.parts.m, d: start.parts.d };
  const stopMs = windowEndMs + 48 * 3600000; // DST-safe ascending cutoff
  const out: number[] = [];
  const totalCap = 10000;
  let generated = 0;

  // Yields candidate dates ascending; returns false when the series ends.
  const emit = (date: Ymd): boolean => {
    if (cmpYmd(date, startDate) < 0) return true;
    if (generated >= totalCap) return false;
    generated++;
    if (rule.count !== undefined && generated > rule.count) return false;
    const ms = atTime(date);
    if (rule.untilMs !== undefined && ms > rule.untilMs) return false;
    if (ms > stopMs) return false;
    if (ms >= windowStartMs && ms <= windowEndMs) out.push(ms);
    return true;
  };

  // Candidates ascend in wall-clock time (hence in UTC), so once past the
  // cutoff every later candidate is past it too: stopping there is exact,
  // with or without COUNT, and every loop below provably terminates.
  if (rule.freq === "DAILY") {
    const wantedDays =
      rule.byday.length > 0 ? new Set(rule.byday.map((b) => b.weekday)) : null;
    const wantedMonthDays =
      rule.bymonthday.length > 0 ? new Set(rule.bymonthday) : null;
    const wantedMonths =
      rule.bymonth.length > 0 ? new Set(rule.bymonth) : null;
    let date = startDate;
    for (;;) {
      const matchDay = wantedDays === null || wantedDays.has(weekdayOf(date));
      const matchMonthDay =
        wantedMonthDays === null || wantedMonthDays.has(date.d);
      const matchMonth = wantedMonths === null || wantedMonths.has(date.m);
      if (matchDay && matchMonthDay && matchMonth) {
        if (!emit(date)) return out;
      }
      date = addDays(date, rule.interval);
      if (atTime(date) > stopMs) return out;
      if (generated >= totalCap) return out;
    }
  }

  if (rule.freq === "WEEKLY") {
    const days =
      rule.byday.length > 0
        ? [...new Set(rule.byday.map((b) => b.weekday))].sort((a, b) => a - b)
        : [weekdayOf(startDate)];
    let week = 0;
    for (;;) {
      const base = addDays(startDate, week * rule.interval * 7);
      for (const t of days) {
        const date = addDays(base, (t - weekdayOf(base) + 7) % 7);
        if (!emit(date)) return out;
      }
      week++;
      if (generated >= totalCap) return out;
    }
  }

  if (rule.freq === "MONTHLY" || rule.freq === "YEARLY") {
    // Iterate months ascending; YEARLY steps 12*interval with BYMONTH filter.
    let mi = 0;
    for (;;) {
      const step = rule.freq === "YEARLY" ? 12 * rule.interval : rule.interval;
      const absMonth = startDate.y * 12 + (startDate.m - 1) + mi * step;
      const y = Math.floor(absMonth / 12);
      const months =
        rule.freq === "YEARLY" && rule.bymonth.length > 0
          ? [...rule.bymonth].sort((a, b) => a - b)
          : rule.freq === "YEARLY"
            ? [startDate.m]
            : [(absMonth % 12) + 1];
      for (const m of months) {
        if (
          rule.freq === "MONTHLY" &&
          rule.bymonth.length > 0 &&
          !rule.bymonth.includes(m)
        ) {
          continue;
        }
        for (const date of monthDaysForRule(y, m, rule, startDate.d)) {
          if (!emit(date)) return out;
        }
      }
      mi++;
      // Next month starts past the cutoff: done (a rule that never matches
      // any date must still terminate).
      const probeAbs = startDate.y * 12 + (startDate.m - 1) + mi * step;
      const probe = atTime({
        y: Math.floor(probeAbs / 12),
        m: (probeAbs % 12) + 1,
        d: 1,
      });
      if (probe > stopMs) return out;
      if (generated >= totalCap) return out;
    }
  }

  // Unsupported frequency: single instance only.
  const single = atTime(startDate);
  if (single >= windowStartMs && single <= windowEndMs) out.push(single);
  return out;
}

function propValue(event: VEvent, name: string): IcsLine | undefined {
  return event.lines.find((l) => l.name === name);
}

function propValues(event: VEvent, name: string): IcsLine[] {
  return event.lines.filter((l) => l.name === name);
}

export interface ParseIcsOptions {
  feedUrl: string;
  defaultZone?: string;
  now?: Date;
  windowDays?: number;
  defaultCategory?: EventCategory;
  /** Force every parsed time into this zone (verified mis-tagging only). */
  overrideTimezone?: string;
}

const WINDOW_MARGIN_MS = 24 * 3600000;

/** Parse a whole calendar feed to upcoming event drafts (next 90 days). */
export function parseIcs(text: string, options: ParseIcsOptions): EventDraft[] {
  const defaultZone =
    options.defaultZone && isValidTimeZone(options.defaultZone)
      ? options.defaultZone
      : DEFAULT_TIMEZONE;
  const nowMs = (options.now ?? new Date()).getTime();
  const windowDays = options.windowDays ?? 90;
  const windowStartMs = nowMs - WINDOW_MARGIN_MS;
  const windowEndMs = nowMs + windowDays * 86400000;
  const overrideZone =
    options.overrideTimezone && isValidTimeZone(options.overrideTimezone)
      ? options.overrideTimezone
      : undefined;
  const parseDT = (line: IcsLine): EventStart | null => {
    const parsed = parseDateTimeProp(line, defaultZone);
    if (!parsed) return null;
    return overrideZone ? { ...parsed, zone: overrideZone } : parsed;
  };

  const vevents = parseVEvents(text);
  // RECURRENCE-ID overrides, keyed by overridden instance start (UTC ms).
  const overrides = new Map<number, VEvent>();
  const masters: VEvent[] = [];
  for (const event of vevents) {
    const recId = propValue(event, "RECURRENCE-ID");
    if (recId) {
      const parsed = parseDT(recId);
      if (parsed) {
        overrides.set(
          Date.parse(
            zonedLocalToUtc(
              {
                year: parsed.parts.y,
                month: parsed.parts.m,
                day: parsed.parts.d,
                hour: parsed.parts.hh,
                minute: parsed.parts.mm,
                second: parsed.parts.ss,
              },
              parsed.zone,
            ),
          ),
          event,
        );
      }
      continue;
    }
    masters.push(event);
  }

  const drafts: EventDraft[] = [];
  for (const event of masters) {
    const summaryLine = propValue(event, "SUMMARY");
    const dtstartLine = propValue(event, "DTSTART");
    if (!summaryLine || !dtstartLine) continue;
    const start = parseDT(dtstartLine);
    if (!start) continue;

    // Duration from DTEND or DURATION; all-day defaults to one day.
    let durationMs: number | null = null;
    const dtendLine = propValue(event, "DTEND");
    if (dtendLine) {
      const end = parseDT(dtendLine);
      if (end) {
        durationMs =
          Date.parse(
            zonedLocalToUtc(
              {
                year: end.parts.y,
                month: end.parts.m,
                day: end.parts.d,
                hour: end.parts.hh,
                minute: end.parts.mm,
                second: end.parts.ss,
              },
              end.zone,
            ),
          ) -
          Date.parse(
            zonedLocalToUtc(
              {
                year: start.parts.y,
                month: start.parts.m,
                day: start.parts.d,
                hour: start.parts.hh,
                minute: start.parts.mm,
                second: start.parts.ss,
              },
              start.zone,
            ),
          );
        if (durationMs < 0) durationMs = null;
      }
    }
    if (durationMs === null) {
      const durLine = propValue(event, "DURATION");
      if (durLine) durationMs = parseDurationMs(durLine.value);
    }
    if (durationMs === null && start.allDay) durationMs = 86400000;

    const exdates = new Set<number>();
    for (const exLine of propValues(event, "EXDATE")) {
      for (const piece of exLine.value.split(",")) {
        const parsed = parseDT({
          name: "EXDATE",
          params: exLine.params,
          value: piece,
        });
        if (parsed) {
          exdates.add(
            Date.parse(
              zonedLocalToUtc(
                {
                  year: parsed.parts.y,
                  month: parsed.parts.m,
                  day: parsed.parts.d,
                  hour: parsed.parts.hh,
                  minute: parsed.parts.mm,
                  second: parsed.parts.ss,
                },
                parsed.zone,
              ),
            ),
          );
        }
      }
    }

    const rruleLine = propValue(event, "RRULE");
    let occurrences: number[];
    if (rruleLine) {
      const rule = parseRRule(rruleLine.value, defaultZone, overrideZone);
      if (!rule) continue;
      if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(rule.freq)) {
        console.warn(`ics: unsupported FREQ=${rule.freq}, single instance only`);
      }
      occurrences = expandRRule(start, rule, windowStartMs, windowEndMs);
    } else {
      const single = Date.parse(
        zonedLocalToUtc(
          {
            year: start.parts.y,
            month: start.parts.m,
            day: start.parts.d,
            hour: start.parts.hh,
            minute: start.parts.mm,
            second: start.parts.ss,
          },
          start.zone,
        ),
      );
      occurrences =
        single >= windowStartMs && single <= windowEndMs ? [single] : [];
    }

    const baseTitle = unescapeIcsText(summaryLine.value).trim();
    const baseDescription = propValue(event, "DESCRIPTION")?.value
      ? unescapeIcsText(propValue(event, "DESCRIPTION")?.value ?? "").trim()
      : undefined;
    const location = propValue(event, "LOCATION")?.value
      ? unescapeIcsText(propValue(event, "LOCATION")?.value ?? "").trim()
      : undefined;
    const urlValue = propValue(event, "URL")?.value.trim();
    const statusValue = propValue(event, "STATUS")?.value.trim().toUpperCase();

    for (const occurrenceMs of occurrences) {
      if (exdates.has(occurrenceMs)) continue;
      const override = overrides.get(occurrenceMs);
      const overrideStatus = override
        ? propValue(override, "STATUS")?.value.trim().toUpperCase()
        : undefined;
      if (overrideStatus === "CANCELLED") continue;
      const title = override
        ? (propValue(override, "SUMMARY")?.value
            ? unescapeIcsText(propValue(override, "SUMMARY")?.value ?? "").trim()
            : baseTitle)
        : baseTitle;
      if (title === "") continue;
      let sourceUrl = options.feedUrl;
      const rawUrl = override
        ? (propValue(override, "URL")?.value.trim() ?? urlValue)
        : urlValue;
      if (rawUrl) {
        try {
          sourceUrl = new URL(rawUrl, options.feedUrl).href;
        } catch {
          sourceUrl = options.feedUrl;
        }
      }
      const candidate = {
        sourceUrl,
        title,
        description: baseDescription,
        startsAtUtc: new Date(occurrenceMs).toISOString(),
        endsAtUtc:
          durationMs !== null
            ? new Date(occurrenceMs + durationMs).toISOString()
            : undefined,
        timezone: start.zone,
        venueName: location,
        category: options.defaultCategory,
        status: statusValue === "CANCELLED" ? "cancelled" : "scheduled",
        rawText: event.raw,
      };
      const parsed = EventDraftSchema.safeParse(candidate);
      if (parsed.success) drafts.push(parsed.data);
    }
  }
  return drafts;
}

/** Extract absolute .ics URLs from an HTML index page (same-host only). */
export function extractIcsLinks(
  indexUrl: string,
  html: string,
  options: { allowSubdomains?: boolean } = {},
): string[] {
  const found = new Set<string>();
  const base = new URL(indexUrl);
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const href = match[1] as string;
    if (!/\.ics(\?|#|$)/i.test(href)) continue;
    try {
      const absolute = new URL(href, indexUrl);
      if (!sameSite(absolute.host, base.host, options.allowSubdomains ?? false)) {
        continue;
      }
      if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
        continue;
      }
      found.add(absolute.href);
    } catch {
      // Skip unresolvable hrefs.
    }
  }
  return [...found];
}

export const IcsAdapter: Adapter = {
  kind: "ics",
  async collect(
    source: SourceConfig,
    ctx: AdapterContext,
  ): Promise<EventDraft[]> {
    const options = {
      defaultZone: source.timezone,
      now: ctx.now,
      windowDays: ctx.windowDays,
      defaultCategory: source.category,
      overrideTimezone: source.overrideTimezone,
    };
    if (!source.icsIndex) {
      const feed = await ctx.fetcher.fetchText(source.url);
      if (feed.notModified) {
        console.log(`ics: ${source.name} not modified since last fetch`);
        return [];
      }
      return parseIcs(feed.text, { ...options, feedUrl: feed.url });
    }
    const pages = await fetchIndexPages(
      ctx.fetcher,
      source.url,
      source.extraIndexPages,
    );
    if (pages.length === 0) {
      console.log(`ics: ${source.name} index not modified since last fetch`);
      return [];
    }
    const links = new Set<string>();
    for (const page of pages) {
      for (const link of extractIcsLinks(page.url, page.text, {
        allowSubdomains: source.includeSubdomains,
      })) {
        links.add(link);
      }
    }
    const drafts: EventDraft[] = [];
    for (const link of [...links].slice(0, 1000)) {
      try {
        const feed = await ctx.fetcher.fetchText(link);
        if (feed.notModified) continue;
        drafts.push(...parseIcs(feed.text, { ...options, feedUrl: feed.url }));
      } catch (error) {
        // One bad file must not fail the source; the failure is logged and
        // that file is skipped (skipping is not retrying).
        console.warn(
          `ics index skipping ${link}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return drafts;
  },
};
