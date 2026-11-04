"use client";

import Link from "next/link";
import { useState } from "react";
import {
  fitLevelsForHousehold,
  sanitizeText,
  type AgeFitLevel,
  type Preferences,
} from "@seatpop/shared";
import type { RecommendItemView } from "@/lib/api";
import { NOT_FOR_US_REASONS } from "@/lib/feedback";
import {
  ageLine,
  formatDistance,
  formatReasonDates,
  formatReasonMarks,
  formatRegistrationBadge,
  formatWhenRange,
  isPolicyPrice,
  priceBadgeLabel,
} from "@/lib/format";
import WhySheet from "@/components/why-sheet";
import WorthIt from "@/components/worth-it";
import { Badge } from "@/components/ui/Badge";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { TicketDivider } from "@/components/ui/Card";
import {
  HUE_SOLID_BG,
  hueForBand,
  hueForCategory,
  type Hue,
} from "@/components/ui/hue";

interface EventCardProps {
  item: RecommendItemView;
  prefs: Preferences;
  saved: boolean;
  syncNote: string | null;
  onToggleSave: (item: RecommendItemView) => void;
  onNotForUs: (item: RecommendItemView, reason: string) => void;
}

const ACTION =
  "inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-line px-4 text-sm font-semibold transition-colors duration-200 motion-reduce:transition-none";

/** The member band this event's ages match, for the age badge hue. */
function ageBadgeHue(
  item: RecommendItemView,
  prefs: Preferences,
): Hue | null {
  if (item.age_min === null && item.age_max === null) return null;
  const levels = fitLevelsForHousehold(
    { age_min: item.age_min, age_max: item.age_max },
    prefs.members,
  );
  const at = (want: AgeFitLevel) =>
    prefs.members.find((member, index) => levels[index] === want)?.age_band;
  const band = at("exact") ?? at("adjacent");
  return band ? hueForBand(band) : null;
}

export default function EventCard({
  item,
  prefs,
  saved,
  syncNote,
  onToggleSave,
  onNotForUs,
}: EventCardProps) {
  const [whyOpen, setWhyOpen] = useState(false);
  const [hideOpen, setHideOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const ages = ageLine(item);
  const distance = formatDistance(item.distance_km);
  const badge = item.registration_window
    ? formatRegistrationBadge(
        item.registration_window.opens_at,
        item.registration_window.opens_date_only,
      )
    : null;
  const accentHue = hueForCategory(item.category);
  const matchedHue = ageBadgeHue(item, prefs);
  const policyPrice = isPolicyPrice(item.price_label);

  return (
    <article className="relative rounded-card border border-line bg-surface p-4 pt-6 shadow-card transition-all duration-200 motion-reduce:transition-none motion-reduce:hover:translate-y-0 hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgb(43_47_74/0.08),0_20px_44px_-12px_rgb(43_47_74/0.35)]">
      <span
        aria-hidden="true"
        className={`absolute bottom-0 left-0 top-0 w-[6px] rounded-l-card ${HUE_SOLID_BG[accentHue]}`}
      />
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[5px] rounded-t-card bg-rainbow"
      />
      <h3 className="text-lg font-bold">
        <Link className="hover:underline" href={`/events/${item.event_id}`}>
          {sanitizeText(item.title)}
        </Link>
      </h3>
      <div className="mt-2 space-y-1 text-sm text-muted">
        <p className="flex items-center gap-2">
          <Icon name="calendar" className="h-4 w-4 shrink-0 text-sky-ink" />
          {formatWhenRange(item.starts_at, item.ends_at, item.timezone)}
        </p>
        {item.venue_name && (
          <p className="flex items-center gap-2">
            <Icon name="pin" className="h-4 w-4 shrink-0 text-sky-ink" />
            {item.venue_name}
          </p>
        )}
        {distance && (
          <p className="flex items-center gap-2">
            <Icon name="route" className="h-4 w-4 shrink-0 text-sky-ink" />
            {distance}
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {policyPrice ? (
          <Badge tone="mint" solid icon="shield">
            {priceBadgeLabel(item.price_label)}
          </Badge>
        ) : item.price_kind === "free" ? (
          <Badge tone="mint" solid>
            {priceBadgeLabel(item.price_label)}
          </Badge>
        ) : item.price_kind === "unknown" ? (
          <Badge tone="neutral">{priceBadgeLabel(item.price_label)}</Badge>
        ) : (
          <Badge tone="navy">{priceBadgeLabel(item.price_label)}</Badge>
        )}
        {ages && (
          <Badge tone={matchedHue ?? "neutral"}>{ages}</Badge>
        )}
        {item.registration_window && badge && (
          <Badge tone="peach">{badge}</Badge>
        )}
      </div>
      {item.age_flag && (
        <p className="mt-2">
          <Badge tone="lemon" icon="warning">
            {item.age_flag}
          </Badge>
        </p>
      )}
      {item.registration_window && (
        <p className="mt-2 border-l-2 border-peach-solid pl-2 text-sm italic text-muted">
          <a
            className="underline"
            href={item.registration_window.source_url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Registration source for ${item.title}`}
          >
            “{item.registration_window.quote}”
          </a>
        </p>
      )}
      {item.more_dates.length > 0 && (
        <div className="mt-3">
          <Chip
            hue="sky"
            size="sm"
            selected={datesOpen}
            showCheck={false}
            disclosure
            aria-expanded={datesOpen}
            onClick={() => setDatesOpen((open) => !open)}
          >
            {item.more_dates.length} more date
            {item.more_dates.length === 1 ? "" : "s"}
          </Chip>
          {datesOpen && (
            <ul className="mt-2 space-y-1 text-sm">
              {item.more_dates.slice(0, 5).map((date) => (
                <li key={date.event_id}>
                  <Link
                    className="underline"
                    href={`/events/${date.event_id}`}
                  >
                    {formatWhenRange(date.starts_at, date.ends_at, date.timezone)}
                  </Link>
                </li>
              ))}
              {item.more_dates.length > 5 && (
                <li className="text-muted">
                  …and {item.more_dates.length - 5} more
                </li>
              )}
            </ul>
          )}
        </div>
      )}
      <div
        className={`mt-3 rounded-xl p-3 ${item.reasonFromModel ? "bg-lavender-tint" : "bg-mist"}`}
      >
        <div className="flex gap-2">
          {item.reasonFromModel && (
            <Icon
              name="sparkle"
              className="mt-0.5 h-4 w-4 shrink-0 text-lavender-ink"
            />
          )}
          <p className="text-sm">
            {formatReasonMarks(
              formatReasonDates(item.reason, item.timezone),
            )}
          </p>
        </div>
      </div>
      <WorthIt eventId={item.event_id} title={item.title} />
      <TicketDivider />
      <div className="flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          aria-pressed={saved}
          onClick={() => onToggleSave(item)}
          className={
            saved
              ? "inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-navy px-4 text-sm font-semibold text-white transition-colors duration-200 motion-reduce:transition-none dark:bg-lavender-solid dark:text-navy"
              : ACTION
          }
        >
          <Icon name="heart" className="h-4 w-4" />
          {saved ? "Saved" : "Save"}
        </button>
        <button
          type="button"
          aria-expanded={hideOpen}
          onClick={() => setHideOpen((open) => !open)}
          className={ACTION}
        >
          <Icon name="close" className="h-4 w-4" />
          Not for us
        </button>
        <button
          type="button"
          onClick={() => setWhyOpen(true)}
          className={ACTION}
        >
          <Icon name="sparkle" className="h-4 w-4" />
          Why this pick?
        </button>
        <a
          className={ACTION}
          href={item.source_url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Official page for ${item.title}`}
        >
          <Icon name="external" className="h-4 w-4" />
          Official page
        </a>
      </div>
      {hideOpen && (
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Reason">
          {NOT_FOR_US_REASONS.map((reason) => (
            <Chip
              key={reason}
              hue="blush"
              size="sm"
              onClick={() => {
                onNotForUs(item, reason);
                setHideOpen(false);
              }}
            >
              {reason}
            </Chip>
          ))}
        </div>
      )}
      {syncNote && <p className="mt-2 text-xs text-muted">{syncNote}</p>}
      {whyOpen && (
        <WhySheet item={item} prefs={prefs} onClose={() => setWhyOpen(false)} />
      )}
    </article>
  );
}
