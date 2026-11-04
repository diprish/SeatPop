"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import RemindMe from "@/components/remind-me";
import WorthIt from "@/components/worth-it";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/Skeleton";
import { HUE_TINT_BG, hueForCategory } from "@/components/ui/hue";
import {
  getEventDetail,
  type EventDetailView,
  type RecommendItemView,
} from "@/lib/api";
import { loadReminders } from "@/lib/reminders";
import { useFeedbackActions } from "@/lib/use-feedback-actions";
import {
  ageLine,
  formatWhenRange,
  formatWindowOpens,
} from "@/lib/format";

export const POLICY_BADGE_LABEL = "Free · per OPL policy";

/**
 * Build the save snapshot from stored detail fields only: the reason
 * cites the listing facts (never a rank), distance stays unknown.
 */
function toSaveItem(detail: EventDetailView): RecommendItemView {
  const price_label =
    detail.price_basis === "source_policy" && detail.price_kind === "free"
      ? "free (per OPL)"
      : detail.price_kind === "free"
        ? "Free"
        : detail.price_kind === "unknown"
          ? "Price not stated"
          : (detail.price_text ?? detail.price_kind);
  const agesUnknown = detail.age_min === null && detail.age_max === null;
  return {
    event_id: detail.id,
    title: detail.title,
    description: detail.description,
    starts_at: detail.starts_at,
    ends_at: detail.ends_at,
    timezone: detail.timezone,
    venue_name: detail.venue?.name ?? null,
    venue_lat: detail.venue?.lat ?? null,
    venue_lng: detail.venue?.lng ?? null,
    distance_km: null,
    category: detail.category,
    status: detail.status,
    source_url: detail.source_url,
    age_min: detail.age_min,
    age_max: detail.age_max,
    age_fallback: agesUnknown,
    age_flag: agesUnknown ? "check the age group" : null,
    price_kind: detail.price_kind,
    price_label,
    amount_min_cents: detail.amount_min_cents,
    amount_max_cents: detail.amount_max_cents,
    currency: detail.currency,
    accessibility: detail.accessibility,
    language: detail.language,
    tags: detail.tags,
    summary_short: detail.summary_short,
    score: 0,
    reason: `${detail.title} on ${detail.starts_at.slice(0, 10)}${detail.venue ? ` at ${detail.venue.name}` : ""}, ${price_label} (stated)`,
    reasonFromModel: false,
    more_dates: [],
    registration_window: detail.registration_window,
  };
}

function Fact({
  label,
  value,
  quote,
}: {
  label: string;
  value: string;
  quote: string | null;
}) {
  return (
    <div>
      <dt className="text-sm font-semibold">{label}</dt>
      <dd className="text-sm">{value}</dd>
      {quote && (
        <dd className="mt-1 border-l-2 border-line pl-2 text-sm italic text-muted">
          “{quote}”
        </dd>
      )}
    </div>
  );
}

const ACTION =
  "inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full border-2 border-line px-4 text-sm font-semibold transition-colors duration-200 motion-reduce:transition-none";

export default function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [detail, setDetail] = useState<EventDetailView | null>(null);
  const [missing, setMissing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const { saved, toggleSave } = useFeedbackActions((eventId, note) => {
    if (eventId === id) setSyncNote(note);
  });

  useEffect(() => {
    let live = true;
    getEventDetail(id).then(
      (loaded) => {
        if (live) setDetail(loaded);
      },
      () => {
        if (live) setMissing(true);
      },
    );
    return () => {
      live = false;
    };
  }, [id]);

  if (missing) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Card className="text-center">
          <span
            aria-hidden="true"
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-sky-tint"
          >
            <Icon name="ticket" className="h-8 w-8 text-sky-ink" />
          </span>
          <h1 className="mt-3 text-2xl font-extrabold">Event not found</h1>
          <p className="mt-2 text-sm text-muted">
            We couldn&apos;t find that event.{" "}
            <Link className="underline" href="/">
              Back to For you
            </Link>
          </p>
        </Card>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6">
        <p className="text-sm text-muted" role="status">
          Loading event…
        </p>
        <Skeleton className="mt-2 h-48" />
      </main>
    );
  }

  function quoteFor(...fields: string[]): string | null {
    const evidence = detail?.evidence;
    if (!evidence) return null;
    for (const field of fields) {
      const quote = evidence[field]?.quote;
      if (quote) return quote;
    }
    return null;
  }

  const ages = ageLine(detail);
  const priceBasis =
    detail.price_basis === "source_policy"
      ? "from the venue's policy"
      : "from the listing";
  const windowOpens =
    detail.registration_window &&
    formatWindowOpens(
      detail.registration_window.opens_at,
      detail.registration_window.opens_date_only,
    );
  const policyPrice =
    detail.price_basis === "source_policy" && detail.price_kind === "free";
  const bannerHue = hueForCategory(detail.category);
  const savedNow = saved.some((entry) => entry.item.event_id === detail.id);
  const reminder = loadReminders()[detail.id] ?? null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <p className="text-sm">
        <Link className="underline" href="/">
          ← For you
        </Link>
      </p>

      <div className={`mt-3 rounded-card p-4 lg:p-6 ${HUE_TINT_BG[bannerHue]}`}>
        <p className="text-xs font-bold uppercase tracking-wide text-muted">
          {detail.category ?? "Event"}
        </p>
        <h1 className="mt-1 text-2xl font-extrabold">{detail.title}</h1>
        <div className="mt-2 space-y-1 text-sm">
          <p className="flex items-center gap-2">
            <Icon name="calendar" className="h-4 w-4 shrink-0" />
            {formatWhenRange(detail.starts_at, detail.ends_at, detail.timezone)}
          </p>
          {detail.venue && (
            <p className="flex items-center gap-2">
              <Icon name="pin" className="h-4 w-4 shrink-0" />
              {detail.venue.name}
            </p>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {policyPrice ? (
            <Badge tone="mint" solid icon="shield">
              {POLICY_BADGE_LABEL}
            </Badge>
          ) : detail.price_kind === "free" ? (
            <Badge tone="mint" solid>
              Free
            </Badge>
          ) : detail.price_kind === "unknown" ? (
            <Badge tone="neutral">Price not listed</Badge>
          ) : (
            <Badge tone="navy">{detail.price_text ?? detail.price_kind}</Badge>
          )}
          {ages && <Badge tone="neutral">{ages}</Badge>}
        </div>
      </div>

      <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6">
        <div>
          {detail.siblings.length > 0 && (
            <section aria-label="Also at this branch" className="mt-4">
              <h2 className="font-bold">Also at this branch</h2>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {detail.siblings.map((sibling) => (
                  <li key={sibling.id}>
                    <Link className="underline" href={`/events/${sibling.id}`}>
                      {sibling.venue_name}
                      {sibling.room ? ` at ${sibling.room}` : ""}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Verified facts" className="mt-4">
            <h2 className="font-bold">Verified facts</h2>
            <dl className="mt-2 space-y-3">
              {detail.age_min === null && detail.age_max === null ? (
                <Fact
                  label="Ages"
                  value="Unstated — check the age group"
                  quote={null}
                />
              ) : (
                <Fact
                  label="Ages"
                  value={ages ?? ""}
                  quote={quoteFor("age_min", "age_max")}
                />
              )}
              {detail.needs_adult !== null && (
                <Fact
                  label="Adult supervisor"
                  value={
                    detail.needs_adult
                      ? "An adult must stay"
                      : "Drop-off — no adult must stay"
                  }
                  quote={quoteFor("needs_adult")}
                />
              )}
              {detail.setting && (
                <Fact label="Setting" value={detail.setting} quote={quoteFor("setting")} />
              )}
              {detail.energy && (
                <Fact label="Energy" value={detail.energy} quote={quoteFor("energy")} />
              )}
              {detail.crowd && (
                <Fact label="Crowd" value={detail.crowd} quote={quoteFor("crowd")} />
              )}
              {detail.duration_min !== null && (
                <Fact
                  label="Duration"
                  value={`${detail.duration_min} min`}
                  quote={quoteFor("duration_min")}
                />
              )}
              {detail.language && (
                <Fact label="Language" value={detail.language} quote={quoteFor("language")} />
              )}
              {detail.accessibility.length > 0 && (
                <Fact
                  label="Accessibility"
                  value={detail.accessibility.join(", ")}
                  quote={quoteFor("accessibility")}
                />
              )}
              {detail.venue?.address && (
                <Fact label="Address" value={detail.venue.address} quote={null} />
              )}
            </dl>
          </section>

          <section aria-label="Price" className="mt-6">
            <h2 className="font-bold">Price: {priceBasis}</h2>
            <dl className="mt-2 space-y-3">
              {detail.amount_min_cents !== null && (
                <Fact
                  label="Amount"
                  value={`$${(detail.amount_min_cents / 100).toFixed(2)}${
                    detail.amount_max_cents !== null &&
                    detail.amount_max_cents !== detail.amount_min_cents
                      ? `–$${(detail.amount_max_cents / 100).toFixed(2)}`
                      : ""
                  }`}
                  quote={quoteFor("amount_min_cents", "amount_max_cents")}
                />
              )}
              {detail.fee_notes && (
                <Fact label="Fee notes" value={detail.fee_notes} quote={quoteFor("fee_notes")} />
              )}
              {detail.price_evidence_quote && (
                <Fact
                  label="Price quote"
                  value={`“${detail.price_evidence_quote}”`}
                  quote={null}
                />
              )}
            </dl>
          </section>

          {detail.registration_window && windowOpens ? (
            <section aria-label="Registration" className="mt-6">
              <h2 className="font-bold">Registration</h2>
              <ol className="mt-3 space-y-4">
                <li className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-peach-solid text-sm font-extrabold text-navy"
                  >
                    1
                  </span>
                  <div>
                    <p className="font-bold">Registration opens {windowOpens}</p>
                    <p className="text-sm text-muted">
                      {detail.registration_window.kind}
                    </p>
                    <p className="mt-1 border-l-2 border-peach-solid pl-2 text-sm italic text-muted">
                      “{detail.registration_window.quote}”
                    </p>
                    <p className="mt-1 text-sm">
                      <a
                        className="underline"
                        href={detail.registration_window.source_url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`City registration page for ${detail.title}`}
                      >
                        City registration page
                      </a>
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-solid text-sm font-extrabold text-navy"
                  >
                    2
                  </span>
                  <div>
                    <p className="font-bold">Event</p>
                    <p className="text-sm text-muted">
                      {formatWhenRange(
                        detail.starts_at,
                        detail.ends_at,
                        detail.timezone,
                      )}
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-mint-solid text-sm font-extrabold text-navy"
                  >
                    3
                  </span>
                  <div>
                    <p className="font-bold">Reminder</p>
                    <p className="text-sm text-muted">
                      {reminder
                        ? `Reminder set · ${formatWindowOpens(reminder.remind_at, false)}`
                        : "No reminder set — add one from the actions."}
                    </p>
                  </div>
                </li>
              </ol>
              {detail.registration_hint && (
                <p className="mt-3 text-sm text-muted">
                  {detail.registration_hint}
                </p>
              )}
            </section>
          ) : (
            (detail.registration_hint || detail.registration_opens_at) && (
              <section aria-label="Registration" className="mt-6">
                <h2 className="font-bold">Registration</h2>
                <dl className="mt-2 space-y-3">
                  {detail.registration_hint && (
                    <Fact
                      label="How"
                      value={detail.registration_hint}
                      quote={quoteFor("registration_hint")}
                    />
                  )}
                  {detail.registration_opens_at && (
                    <Fact
                      label="Opens"
                      value={
                        formatWindowOpens(detail.registration_opens_at, false) ?? ""
                      }
                      quote={quoteFor("registration_opens_at")}
                    />
                  )}
                </dl>
              </section>
            )
          )}

          {detail.summary_short && (
            <section aria-label="About" className="mt-6">
              <h2 className="font-bold">About</h2>
              <p className="mt-2 text-sm">{detail.summary_short}</p>
            </section>
          )}
          {detail.description && (
            <section aria-label="Listing text" className="mt-6">
              <h2 className="font-bold">Listing text</h2>
              <p className="mt-2 text-sm whitespace-pre-line">{detail.description}</p>
            </section>
          )}
        </div>

        <div className="mt-6 lg:mt-0">
          <div className="rounded-card border border-line bg-surface p-4 shadow-card lg:sticky lg:top-24">
            <h2 className="font-bold">Actions</h2>
            <div className="mt-3 space-y-2">
              <button
                type="button"
                aria-pressed={savedNow}
                onClick={() => void toggleSave(toSaveItem(detail))}
                className={
                  savedNow
                    ? "inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full bg-navy px-4 text-sm font-semibold text-white transition-colors duration-200 motion-reduce:transition-none dark:bg-lavender-solid dark:text-navy"
                    : ACTION
                }
              >
                <Icon name="heart" className="h-4 w-4" />
                {savedNow ? "Saved" : "Save"}
              </button>
              <a
                className={ACTION}
                href={detail.source_url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Official page for ${detail.title}`}
              >
                <Icon name="external" className="h-4 w-4" />
                Official page
              </a>
              {syncNote && <p className="text-xs text-muted">{syncNote}</p>}
            </div>
            <div className="mt-3 border-t border-line-soft pt-3">
              <RemindMe item={{ event_id: detail.id }} />
            </div>
            <div className="mt-3 border-t border-line-soft pt-1">
              <WorthIt eventId={detail.id} title={detail.title} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
