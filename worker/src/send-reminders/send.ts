/**
 * Reminder email rendering (worker/send-reminders): pure text assembly,
 * tested. Every line comes from stored facts — event row, matched
 * window, official link — and the footer states the one-email promise
 * with how to delete. No HTML, no tracking, no model.
 */

export interface ReminderEmailFacts {
  title: string;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  venue_name: string | null;
  source_url: string;
  basis: "registration_window" | "event_start";
  window: {
    opens_at: string;
    opens_date_only: boolean;
    quote: string;
    source_url: string;
  } | null;
}

export interface ReminderEmail {
  subject: string;
  text: string;
}

function dayLabel(date: Date, timezone: string): string {
  // Same shape as the web dayLabel ("Sat Oct 31", no comma).
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  })
    .format(date)
    .replace(",", "");
}

function timeLabel(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  }).format(date);
}

function eventWhen(facts: ReminderEmailFacts): string {
  const start = new Date(facts.starts_at);
  const day = dayLabel(start, facts.timezone);
  const startTime = timeLabel(start, facts.timezone);
  if (!facts.ends_at) return `${day} · ${startTime}`;
  const end = new Date(facts.ends_at);
  if (dayLabel(end, facts.timezone) !== day) {
    return `${day} · ${startTime} – ${dayLabel(end, facts.timezone)} · ${timeLabel(end, facts.timezone)}`;
  }
  return `${day} · ${startTime}–${timeLabel(end, facts.timezone)}`;
}

function windowOpens(window: NonNullable<ReminderEmailFacts["window"]>): string {
  const date = new Date(window.opens_at);
  const day = dayLabel(date, "America/Toronto");
  if (window.opens_date_only) return day;
  return `${day} · ${timeLabel(date, "America/Toronto")}`;
}

export function renderReminderEmail(facts: ReminderEmailFacts): ReminderEmail {
  const when = eventWhen(facts);
  const where = facts.venue_name ?? "venue to be confirmed";
  if (facts.basis === "registration_window" && facts.window) {
    return {
      subject: `Registration opens soon: ${facts.title}`,
      text: [
        `Registration opens ${windowOpens(facts.window)} for:`,
        ``,
        facts.title,
        `${when} · ${where}`,
        ``,
        `City's wording: "${facts.window.quote}"`,
        `City registration page: ${facts.window.source_url}`,
        `Official event page: ${facts.source_url}`,
        ``,
        `You asked for one email about this event. To delete this reminder, open your Saved page in SeatPop.`,
      ].join("\n"),
    };
  }
  return {
    subject: `Reminder: ${facts.title}`,
    text: [
      `Coming up:`,
      ``,
      facts.title,
      `${when} · ${where}`,
      ``,
      `No registration window was listed for this event, so this reminder fired 1 day before the start.`,
      `Official event page: ${facts.source_url}`,
      ``,
      `You asked for one email about this event. To delete this reminder, open your Saved page in SeatPop.`,
    ].join("\n"),
  };
}

/** Log-safe address (dry-run output must not leak emails). */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`;
}
