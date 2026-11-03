import { loadDotenv } from "@seatpop/llm";
import { matchWindow, type RegistrationWindow } from "../recommend/windows";
import { isDirectExecution } from "../script-entry";
import {
  effectiveLimit,
  maskEmail,
  MAX_SENDS_PER_RUN,
  renderReminderEmail,
  type ReminderEmailFacts,
} from "./send";

/**
 * Send due email reminders through Resend. Selects unsent rows with
 * remind_at <= now (oldest first), renders from stored facts only, and
 * marks each sent_at on success. At-least-once by design: a crash
 * between send and mark retries the mail rather than losing it, and one
 * bad row never blocks the rest — but any failure fails the run loudly
 * (exit 1) with the failed ids listed. Idempotent across runs: sent
 * rows are never re-selected.
 *
 * --dry-run prints masked recipients + subjects and sends nothing.
 *
 * Sends are capped at MAX_SENDS_PER_RUN per run (--limit can only ask
 * for fewer). Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * (reminders reads are service-role-only) plus RESEND_API_KEY,
 * RESEND_FROM, and APP_BASE_URL (the token delete link in the footer).
 */

interface Deps {
  url: string;
  serviceKey: string;
  resendKey: string;
  resendFrom: string;
}

interface DueReminder {
  id: string;
  email: string;
  remind_at: string;
  basis: string;
  event_id: string;
  delete_token: string;
}

interface EventFacts {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  venue_id: string | null;
  source_url: string;
  category: string | null;
  description: string | null;
}

async function rest<T>(
  deps: Deps,
  tablePath: string,
  query: string,
  init?: { method?: string; body?: unknown; prefer?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: deps.serviceKey,
    Authorization: `Bearer ${deps.serviceKey}`,
  };
  if (init?.prefer) headers["Prefer"] = init.prefer;
  const response = await fetch(
    `${deps.url.replace(/\/$/, "")}/rest/v1/${tablePath}${query}`,
    {
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    },
  );
  if (!response.ok) {
    throw new Error(`supabase ${tablePath} failed: HTTP ${response.status}`);
  }
  if (init?.prefer === "return=minimal") return undefined as T;
  return (await response.json()) as T;
}

function valueOf(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function sendEmail(
  deps: Deps,
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${deps.resendKey}`,
    },
    body: JSON.stringify({
      from: deps.resendFrom,
      to: [to],
      subject,
      text,
    }),
  });
  if (!response.ok) {
    throw new Error(`resend failed: HTTP ${response.status}`);
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "seatpop send:reminders: send due email reminders.\n" +
        "usage: npm run send:reminders --workspace @seatpop/worker [-- --dry-run] [--limit N]\n" +
        `  --dry-run    print masked recipients + subjects; send nothing.\n` +
        `  --limit N    send at most N reminders, oldest first (default ${MAX_SENDS_PER_RUN}; never more per run).`,
    );
    return 0;
  }
  const dryRun = args.includes("--dry-run");
  const limitRaw = valueOf(args, "--limit");
  const requested = limitRaw === undefined ? undefined : Number(limitRaw);
  if (requested !== undefined && (!Number.isInteger(requested) || requested <= 0)) {
    console.error("--limit needs a positive integer");
    return 2;
  }
  const limit = effectiveLimit(requested);
  if (requested !== undefined && requested > limit) {
    console.log(`send:reminders: --limit ${requested} clamped to ${limit}/run cap`);
  }
  loadDotenv();
  const supabaseUrl = process.env["SUPABASE_URL"]?.trim();
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  const resendKey = process.env["RESEND_API_KEY"]?.trim();
  const resendFrom = process.env["RESEND_FROM"]?.trim();
  const appBase = process.env["APP_BASE_URL"]?.trim().replace(/\/$/, "");
  if (!supabaseUrl || !serviceKey || !resendKey || !resendFrom || !appBase) {
    console.error(
      "send:reminders needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM and APP_BASE_URL",
    );
    return 2;
  }
  const deps: Deps = {
    url: supabaseUrl,
    serviceKey,
    resendKey,
    resendFrom,
  };
  const now = new Date().toISOString();

  const due = await rest<DueReminder[]>(
    deps,
    "reminders",
    `?select=id,email,remind_at,basis,event_id,delete_token&sent_at=is.null&remind_at=lte.${encodeURIComponent(now)}&order=remind_at.asc&limit=${limit}`,
  );
  console.log(
    `send:reminders: due=${due.length}${dryRun ? " (dry run — nothing sent)" : ""}`,
  );
  if (due.length === 0) return 0;

  const eventIds = [...new Set(due.map((row) => row.event_id))];
  const events = await rest<EventFacts[]>(
    deps,
    "events",
    `?select=id,title,starts_at,ends_at,timezone,venue_id,source_url,category,description&id=in.(${eventIds.map((id) => encodeURIComponent(id)).join(",")})`,
  );
  const byEvent = new Map(events.map((event) => [event.id, event]));
  const venueIds = [
    ...new Set(
      events
        .map((event) => event.venue_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  const venueNames = new Map<string, string>();
  if (venueIds.length > 0) {
    const venues = await rest<Array<{ id: string; name: string }>>(
      deps,
      "venues",
      `?select=id,name&id=in.(${venueIds.map((id) => encodeURIComponent(id)).join(",")})`,
    );
    for (const venue of venues) venueNames.set(venue.id, venue.name);
  }
  const windows = await rest<RegistrationWindow[]>(
    deps,
    "registration_windows",
    "?select=scope,kind,opens_at,opens_date_only,quote,source_url,label&limit=500",
  );
  const sourceRows = await rest<Array<{ event_id: string; source_name: string }>>(
    deps,
    "public_event_sources",
    `?select=event_id,source_name&event_id=in.(${eventIds.map((id) => encodeURIComponent(id)).join(",")})&limit=2000`,
  );
  const sourcesByEvent = new Map<string, string[]>();
  for (const row of sourceRows) {
    const list = sourcesByEvent.get(row.event_id) ?? [];
    list.push(row.source_name);
    sourcesByEvent.set(row.event_id, list);
  }

  let sent = 0;
  const failed: string[] = [];
  for (const row of due) {
    try {
      const event = byEvent.get(row.event_id);
      if (!event) throw new Error(`event ${row.event_id} missing`);
      const window =
        row.basis === "registration_window"
          ? matchWindow(windows, sourcesByEvent.get(row.event_id) ?? [], Date.now(), {
              title: event.title,
              category: event.category,
              starts_at: event.starts_at,
              description: event.description,
            })
          : null;
      const facts: ReminderEmailFacts = {
        title: event.title,
        starts_at: event.starts_at,
        ends_at: event.ends_at,
        timezone: event.timezone,
        venue_name: event.venue_id
          ? (venueNames.get(event.venue_id) ?? null)
          : null,
        source_url: event.source_url,
        basis:
          row.basis === "registration_window" ? "registration_window" : "event_start",
        window,
        deleteUrl: `${appBase}/api/reminders/unsubscribe?id=${row.id}&token=${row.delete_token}`,
      };
      const email = renderReminderEmail(facts);
      if (dryRun) {
        console.log(
          `  would send to ${maskEmail(row.email)} | ${row.remind_at} | ${email.subject}`,
        );
        continue;
      }
      await sendEmail(deps, row.email, email.subject, email.text);
      await rest(deps, "reminders", `?id=eq.${row.id}`, {
        method: "PATCH",
        body: { sent_at: new Date().toISOString() },
        prefer: "return=minimal",
      });
      sent++;
      console.log(`  sent ${row.id} to ${maskEmail(row.email)}`);
    } catch (error) {
      failed.push(row.id);
      console.error(
        `  failed ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (dryRun) return 0;
  console.log(`send:reminders: sent=${sent} failed=${failed.length}`);
  if (failed.length > 0) {
    console.error(`send:reminders failures: ${failed.join(", ")}`);
    return 1;
  }
  return 0;
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await main().catch((error: unknown) => {
    console.error(
      `send:reminders failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  });
  process.exit(exitCode);
}
