import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/Icon";

export const metadata: Metadata = {
  title: "How it works",
};

const TRY_STEPS = [
  {
    circle: "bg-blush-solid",
    text: "Open the sample family (an adult, a 6–12 kid and a preschooler near K2S)",
  },
  {
    circle: "bg-lemon-solid",
    text: 'Tap "Why this pick?" on any pick to see the evidence quotes',
  },
  {
    circle: "bg-mint-solid",
    text: "Save a pick and set a reminder, then see it under Saved and Booked",
  },
];

const PILLARS: { icon: IconName; circle: string; title: string; body: string }[] = [
  {
    icon: "check",
    circle: "bg-mint-solid",
    title: "We check every fact against the listing",
    body: "Ages, prices and registration details only show up if we can point to the exact words on the official page. If we can't, we leave them out.",
  },
  {
    icon: "shield",
    circle: "bg-sky-solid",
    title: "Your limits are rules, not suggestions",
    body: "Age, distance, budget, days and times, and accessibility needs are applied first. Nothing outside your limits makes the list.",
  },
  {
    icon: "sparkle",
    circle: "bg-lavender-solid",
    title: "See why we picked it",
    body: "Every pick explains itself. If our AI ranking is ever unavailable, you still get a sensible list.",
  },
];

type ModelRow = {
  name: string;
  role: string;
  runs: string;
  badge: { tone: "navy" | "sky"; solid?: boolean };
};

// Names, roles, and hosts straight from packages/llm/src/config.ts
// (modelForTask, providersForTask) and the enrich/rerank call sites.
const MODELS: ModelRow[] = [
  {
    name: "muse-spark-1.3-contributor",
    role: "Reads public listing pages and extracts ages, prices, and registration details.",
    runs: "Meta Model API",
    badge: { tone: "navy" },
  },
  {
    name: "meta-models/muse-spark-open-1026",
    role: "Open-weight Spark doing the same listing-reading job as the contributor model.",
    runs: "Baseten · public text only",
    badge: { tone: "sky", solid: true },
  },
  {
    name: "muse-spark-1.3",
    role: "Ranks the surviving candidates, explains each pick, and parses typed household descriptions.",
    runs: "Meta Model API",
    badge: { tone: "navy" },
  },
  {
    name: "muse-wonder-1.0",
    role: "Grades recommendation quality during offline evals; never in the live app.",
    runs: "Meta Model API",
    badge: { tone: "navy" },
  },
];

const PRIVACY_COPY =
  "Only age groups, never names, birth dates or addresses. Nothing identifying is sent to any AI model. Your household stays on your device. Anything you type about your family is discarded after we read it.";

const DATA_POINTS = [
  "Public event listings, crawled politely: robots.txt respected, at most 1 request per 3 seconds per host, an honest user agent, never a bypassed login.",
  "Every event links to its official page — SeatPop never takes bookings itself.",
];

/**
 * About: a static "How it works" page. Copy only — no API calls,
 * no data, no ranking. Links resolve to app routes or https URLs.
 */
export default function AboutPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <Card>
        <h1 className="text-2xl font-extrabold lg:text-3xl">How SeatPop works</h1>
        <p className="mt-2 text-muted">
          Activities for every age in your household, matched to each person
          and checked against the listing.
        </p>
      </Card>

      <Card variant="ticket" className="mt-6">
        <h2 className="text-xl font-extrabold">Try it in 30 seconds</h2>
        <ol className="mt-3 space-y-2">
          {TRY_STEPS.map((step, index) => (
            <li key={step.text} className="flex items-start gap-2 text-sm font-semibold">
              <span
                aria-hidden="true"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-navy ${step.circle}`}
              >
                {index + 1}
              </span>
              <span className="pt-1">{step.text}</span>
            </li>
          ))}
        </ol>
        {/*
          A link, not a button: it navigates. Classes match the Button
          primary so it looks like the primary action everywhere.
        */}
        <Link
          href="/"
          className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-white transition-colors duration-200 motion-reduce:transition-none dark:text-navy"
        >
          Open the sample household
        </Link>
      </Card>

      <section className="mt-8">
        <h2 className="text-xl font-extrabold">How it works</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {PILLARS.map((pillar) => (
            <Card key={pillar.title}>
              <span
                aria-hidden="true"
                className={`flex h-9 w-9 items-center justify-center rounded-full text-navy ${pillar.circle}`}
              >
                <Icon name={pillar.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-2 font-extrabold">{pillar.title}</h3>
              <p className="mt-1 text-sm text-muted">{pillar.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-extrabold">Never miss registration</h2>
        <Card className="mt-3">
          <p className="text-sm">
            Save any activity and we&apos;ll send one email reminder an hour
            before registration opens when we know the date, otherwise the
            day before the event starts. Reminders are email only, and we
            never share your address.
          </p>
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-extrabold">Your privacy</h2>
        <Card className="mt-3">
          <p className="text-sm">{PRIVACY_COPY}</p>
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-extrabold">Where the data comes from</h2>
        <Card className="mt-3">
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {DATA_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            <Link className="font-bold underline underline-offset-4" href="/trust">
              See the measured accuracy
            </Link>
          </p>
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-extrabold">Current limits</h2>
        <Card className="mt-3 space-y-2 text-sm">
          <p>
            Ottawa only. Mostly library programs, plus a few City recreation
            courses. Registration dates for City courses are entered by hand
            from the City&apos;s page.
          </p>
        </Card>
      </section>

      <details className="mt-8 rounded-card border border-line bg-surface p-4 shadow-card">
        <summary className="flex min-h-[44px] cursor-pointer items-center text-xl font-extrabold">
          Under the hood
        </summary>
        <p className="mt-1 text-sm text-muted">
          What each model does here, and where it runs.
        </p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {MODELS.map((model) => (
            <Card key={model.name}>
              <p className="break-all font-mono text-sm font-bold">{model.name}</p>
              <p className="mt-1 text-sm text-muted">{model.role}</p>
              <p className="mt-2">
                <Badge tone={model.badge.tone} solid={model.badge.solid}>
                  {model.runs}
                </Badge>
              </p>
            </Card>
          ))}
        </div>
      </details>

      <p className="mt-8 text-sm">
        <a
          className="font-bold underline underline-offset-4"
          href="https://github.com/diprish/SeatPop"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>{" "}
        ·{" "}
        <Link className="font-bold underline underline-offset-4" href="/trust">
          How we check
        </Link>
      </p>
    </main>
  );
}
