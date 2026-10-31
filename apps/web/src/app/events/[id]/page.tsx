"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import ErrorBanner from "@/components/error-banner";
import { getEventDetail, type EventDetailView } from "@/lib/api";
import {
  ageLine,
  formatDate,
  formatWhenRange,
  priceBadgeClass,
  priceTone,
} from "@/lib/format";

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
        <dd className="mt-1 border-l-2 border-neutral-300 pl-2 text-sm italic text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
          “{quote}”
        </dd>
      )}
    </div>
  );
}

export default function EventDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<EventDetailView | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">(
    "loading",
  );

  useEffect(() => {
    if (!id) {
      setStatus("missing");
      return;
    }
    let live = true;
    setStatus("loading");
    getEventDetail(id)
      .then((loaded) => {
        if (live) {
          setDetail(loaded);
          setStatus("ready");
        }
      })
      .catch((error: unknown) => {
        if (!live) return;
        setStatus(
          error instanceof Error && error.message === "unknown event"
            ? "missing"
            : "error",
        );
      });
    return () => {
      live = false;
    };
  }, [id]);

  if (status === "loading") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <p className="text-sm" role="status">
          Loading event…
        </p>
      </main>
    );
  }

  if (status === "missing" || !detail) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="text-2xl font-bold">Event not found</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          This event isn&apos;t in the catalogue.{" "}
          <Link className="underline" href="/">
            Back to For you
          </Link>
          .
        </p>
        {status === "error" && (
          <ErrorBanner
            message="Event lookup failed."
            onRetry={() => window.location.reload()}
          />
        )}
      </main>
    );
  }

  const quoteFor = (...fields: string[]): string | null => {
    if (!detail.evidence) return null;
    for (const field of fields) {
      const quote = detail.evidence[field]?.quote;
      if (quote) return quote;
    }
    return null;
  };

  const ages = ageLine(detail);
  const priceBasis =
    detail.price_basis === "source_policy"
      ? "Free per the venue's stated policy"
      : "Listed price (from the event text)";
  const opensAt = detail.registration_opens_at
    ? new Date(detail.registration_opens_at)
    : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <p className="text-sm">
        <Link className="underline" href="/">
          ← For you
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold">{detail.title}</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
        {formatWhenRange(detail.starts_at, detail.ends_at, detail.timezone)}
        {detail.venue ? ` · ${detail.venue.name}` : ""}
        {detail.category ? ` · ${detail.category}` : ""}
      </p>
      <p className="mt-2">
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${priceBadgeClass(priceTone(detail.price_kind))}`}
        >
          {detail.price_kind === "free"
            ? detail.price_basis === "source_policy"
              ? "free (per OPL)"
              : "Free"
            : detail.price_kind === "unknown"
              ? "Price not stated"
              : detail.price_text ?? detail.price_kind}
        </span>
      </p>

      <section aria-label="Verified facts" className="mt-4">
        <h2 className="font-semibold">Verified facts</h2>
        <dl className="mt-2 space-y-3">
          {ages && <Fact label="Ages" value={ages} quote={quoteFor("age_min", "age_max")} />}
          {detail.age_min === null && detail.age_max === null && (
            <Fact label="Ages" value="Unstated — check the age group" quote={null} />
          )}
          {detail.needs_adult !== null && (
            <Fact
              label="Supervision"
              value={
                detail.needs_adult
                  ? "Adult accompaniment needed"
                  : "No adult accompaniment required"
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

      <section aria-label="Price basis" className="mt-4">
        <h2 className="font-semibold">Price basis</h2>
        <dl className="mt-2 space-y-3">
          <Fact
            label="Basis"
            value={priceBasis}
            quote={detail.price_evidence_quote ?? quoteFor("price_kind")}
          />
          {detail.amount_min_cents !== null && (
            <Fact
              label="Amount"
              value={`$${(detail.amount_min_cents / 100).toFixed(2)}${
                detail.amount_max_cents !== null &&
                detail.amount_max_cents !== detail.amount_min_cents
                  ? `–$${(detail.amount_max_cents / 100).toFixed(2)}`
                  : ""
              }`}
              quote={null}
            />
          )}
          {detail.fee_notes && (
            <Fact label="Fee notes" value={detail.fee_notes} quote={quoteFor("fee_notes")} />
          )}
        </dl>
      </section>

      {(detail.registration_hint || detail.registration_opens_at) && (
        <section aria-label="Registration" className="mt-4">
          <h2 className="font-semibold">Registration</h2>
          <dl className="mt-2 space-y-3">
            {detail.registration_hint && (
              <Fact
                label="How"
                value={detail.registration_hint}
                quote={quoteFor("registration_hint")}
              />
            )}
            {opensAt && (
              <Fact
                label={opensAt.getTime() > Date.now() ? "Opens" : "Opened"}
                value={formatDate(detail.registration_opens_at as string, detail.timezone)}
                quote={quoteFor("registration_opens_at")}
              />
            )}
          </dl>
        </section>
      )}

      {detail.description && (
        <section aria-label="About" className="mt-4">
          <h2 className="font-semibold">About</h2>
          <p className="mt-2 text-sm whitespace-pre-line">{detail.description}</p>
        </section>
      )}

      <p className="mt-4 text-sm">
        <a
          className="underline"
          href={detail.source_url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Official page for ${detail.title}`}
        >
          Official page
        </a>
      </p>
    </main>
  );
}
