"use client";

import { useEffect, useState } from "react";
import ErrorBanner from "@/components/error-banner";
import { Badge } from "@/components/ui/Badge";
import {
  parseEnrichmentReport,
  parseFallbackReport,
  parseRecommendReport,
  type EnrichmentSummary,
  type FallbackSummary,
  type RecommendSummary,
} from "@/lib/trust";

/**
 * Trust: the eval snapshots copied into public/ at dev/build time.
 * Missing or unreadable files render as "pending" — never faked numbers.
 */

type Snapshot<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "pending" }
  | { status: "error"; message: string };

async function load<T>(
  url: string,
  parse: (json: unknown) => T | null,
): Promise<Snapshot<T>> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return { status: "error", message: `could not fetch ${url}` };
  }
  if (!response.ok) return { status: "pending" };
  try {
    const data = parse((await response.json()) as unknown);
    return data ? { status: "ready", data } : { status: "pending" };
  } catch {
    return { status: "pending" };
  }
}

function pct(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

type TileStatus = "pass" | "fail" | "pending";

function tileTone(status: TileStatus): string {
  if (status === "pass") return "bg-mint-tint";
  if (status === "fail") return "bg-blush-tint";
  return "bg-lemon-tint";
}

function StatTile({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status: TileStatus;
}) {
  return (
    <div className={`rounded-card p-4 ${tileTone(status)}`}>
      <p className="text-2xl font-extrabold">{value}</p>
      <p className="mt-1 text-sm font-semibold text-muted">{label}</p>
    </div>
  );
}

export default function TrustPage() {
  const [enrichment, setEnrichment] = useState<Snapshot<EnrichmentSummary>>({
    status: "loading",
  });
  const [recommend, setRecommend] = useState<Snapshot<RecommendSummary>>({
    status: "loading",
  });
  const [fallback, setFallback] = useState<Snapshot<FallbackSummary>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;
    void load("/eval-report.json", parseEnrichmentReport).then((result) => {
      if (live) setEnrichment(result);
    });
    void load("/recommend-eval.json", parseRecommendReport).then((result) => {
      if (live) setRecommend(result);
    });
    void load("/recommend-eval-fallback.json", parseFallbackReport).then((result) => {
      if (live) setFallback(result);
    });
    return () => {
      live = false;
    };
  }, []);

  const violationsTile =
    recommend.status === "ready"
      ? {
          value: String(recommend.data.violations),
          status: (recommend.data.violations === 0 ? "pass" : "fail") as TileStatus,
        }
      : {
          value: recommend.status === "loading" ? "…" : "pending",
          status: "pending" as TileStatus,
        };
  const worstFalseFree =
    enrichment.status === "ready"
      ? Math.max(0, ...enrichment.data.models.map((model) => model.falseFree))
      : null;
  const worstWrongPrice =
    enrichment.status === "ready"
      ? Math.max(0, ...enrichment.data.models.map((model) => model.wrongPrice))
      : null;
  const listingsChecked =
    enrichment.status === "ready" ? enrichment.data.goldenEvents : null;
  const allClean = worstFalseFree === 0 && worstWrongPrice === 0;
  const loadingWord = (loading: boolean): string =>
    loading ? "…" : "pending";

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-extrabold">How we check</h1>
      <p className="mt-1 text-sm text-muted">
        These numbers come from our own test runs. Anything not measured yet
        says pending.
      </p>

      {enrichment.status === "ready" ? (
        <p className="mt-2 text-muted">
          We checked our system against {listingsChecked} hand-labeled real
          listings.{" "}
          {allClean
            ? "It never called a paid activity free and never got a price wrong."
            : "See the exact counts below."}
        </p>
      ) : enrichment.status === "loading" ? (
        <p className="mt-2 text-muted" role="status">
          Checking our system against real listings…
        </p>
      ) : (
        <p className="mt-2 text-muted">
          Our listing checks aren&apos;t published yet — anything below says
          pending.
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label="wrong prices"
          value={worstWrongPrice === null ? loadingWord(enrichment.status === "loading") : String(worstWrongPrice)}
          status={worstWrongPrice === null ? "pending" : worstWrongPrice === 0 ? "pass" : "fail"}
        />
        <StatTile
          label="'free' mistakes"
          value={worstFalseFree === null ? loadingWord(enrichment.status === "loading") : String(worstFalseFree)}
          status={worstFalseFree === null ? "pending" : worstFalseFree === 0 ? "pass" : "fail"}
        />
        <StatTile label="results outside your limits" value={violationsTile.value} status={violationsTile.status} />
      </div>

      <details className="mt-6 rounded-card border border-line bg-surface p-4 shadow-card">
        <summary className="flex min-h-[44px] cursor-pointer items-center font-extrabold">
          Technical details
        </summary>
      <section aria-label="Enrichment eval" className="mt-4">
        <h2 className="font-extrabold">Listing enrichment</h2>
        {enrichment.status === "loading" && (
          <p className="mt-2 text-sm" role="status">
            Loading…
          </p>
        )}
        {enrichment.status === "pending" && (
          <p className="mt-2 text-sm text-muted">
            Enrichment eval pending — human labelling isn&apos;t finished.
          </p>
        )}
        {enrichment.status === "error" && (
          <ErrorBanner message={enrichment.message} />
        )}
        {enrichment.status === "ready" &&
          enrichment.data.excluded.length > 0 && (
            <div className="mt-3 rounded-xl border-2 border-lemon-solid bg-lemon-tint p-3 text-sm">
              <p className="font-bold">
                Excluded from scoring as ambiguous (
                {enrichment.data.excluded.length}): labels kept, out of every
                denominator.
              </p>
              <ul className="mt-1 list-disc pl-5">
                {enrichment.data.excluded.map((row) => (
                  <li key={row.eventId}>
                    <span className="font-mono text-xs">{row.eventId}</span>:{" "}
                    {row.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        {enrichment.status === "ready" &&
          enrichment.data.models.map((model) => {
            const gatePass = model.falseFree === 0 && model.wrongPrice === 0;
            return (
              <div
                key={model.key}
                className="mt-3 rounded-card border border-line bg-surface p-4 shadow-card"
              >
                <h3 className="text-sm font-bold">
                  {model.model}{" "}
                  <span className="font-normal text-muted">
                    ({model.provider}, {model.eventsScored} scored
                    {model.eventsFailed > 0 ? `, ${model.eventsFailed} failed` : ""})
                  </span>
                </h3>
                <p className="mt-2">
                  {gatePass ? (
                    <Badge tone="mint" solid>
                      <span className="text-sm">Gate: PASS</span>
                    </Badge>
                  ) : (
                    <Badge tone="blush" solid>
                      <span className="text-sm">Gate: FAIL</span>
                    </Badge>
                  )}
                </p>
                <p className="mt-1 text-sm">
                  False-free {model.falseFree}, wrong-price {model.wrongPrice},
                  hallucinated {model.hallucinatedFields}
                </p>
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted">
                      <th scope="col" className="font-normal">Field</th>
                      <th scope="col" className="font-normal">Accuracy</th>
                      <th scope="col" className="font-normal">Null rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.fields.map((field, index) => (
                      <tr
                        key={field.field}
                        className={index % 2 === 1 ? "bg-mist/60" : ""}
                      >
                        <td>{field.field}</td>
                        <td>
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="h-2 w-16 overflow-hidden rounded-full bg-mist"
                            >
                              {field.accuracy !== null && (
                                <span
                                  className="block h-full rounded-full bg-mint-solid"
                                  style={{
                                    width: `${(field.accuracy * 100).toFixed(1)}%`,
                                  }}
                                />
                              )}
                            </span>
                            {pct(field.accuracy)}
                          </span>
                        </td>
                        <td>{pct(field.nullRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-sm text-muted">
                  {model.tokensIn.toLocaleString()} in /{" "}
                  {model.tokensOut.toLocaleString()} out tokens
                  {model.costPer1kUsd !== null &&
                    ` · $${model.costPer1kUsd.toFixed(4)} per 1,000 events`}
                </p>
              </div>
            );
          })}
      </section>

      <section aria-label="Recommend eval" className="mt-6">
        <h2 className="font-extrabold">Recommendations</h2>
        {recommend.status === "loading" && (
          <p className="mt-2 text-sm" role="status">
            Loading…
          </p>
        )}
        {recommend.status === "pending" && (
          <p className="mt-2 text-sm text-muted">
            Recommend eval pending.
          </p>
        )}
        {recommend.status === "error" && (
          <ErrorBanner message={recommend.message} />
        )}
        {recommend.status === "ready" && (
          <div className="mt-3 rounded-card border border-line bg-surface p-4 text-sm shadow-card">
            <p>
              {recommend.data.households} synthetic households,{" "}
              {recommend.data.withCandidates} with candidates,{" "}
              {recommend.data.graded} graded ({recommend.data.grading}).
            </p>
            <p className="mt-1">
              Constraint violations in top 10:{" "}
              {recommend.data.violations === 0 ? (
                <Badge tone="mint" solid>
                  {recommend.data.violations}
                </Badge>
              ) : (
                <Badge tone="blush" solid>
                  {recommend.data.violations}
                </Badge>
              )}{" "}
              (must be 0) · distance mismatches: {recommend.data.distanceMismatches}
            </p>
            <table className="mt-2 w-full">
              <thead>
                <tr className="text-left text-muted">
                  <th scope="col" className="font-normal">Method</th>
                  <th scope="col" className="font-normal">NDCG@10</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { method: "Reranked", value: recommend.data.meanNdcgReranked },
                  { method: "Date order (baseline)", value: recommend.data.meanNdcgDate },
                  { method: "Stage 2 only (baseline)", value: recommend.data.meanNdcgStage2 },
                ].map((row, index) => (
                  <tr
                    key={row.method}
                    className={index % 2 === 1 ? "bg-mist/60" : ""}
                  >
                    <td>{row.method}</td>
                    <td>{pct(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {recommend.data.policyProbe && (
              <p className="mt-2">
                Policy probe: {recommend.data.policyProbe.freePerOpl}/
                {recommend.data.policyProbe.candidates} free-per-policy rows (
                {recommend.data.policyProbe.ok ? "pass" : "fail"}).
              </p>
            )}
          </div>
        )}
      </section>

      <section aria-label="Fallback proof" className="mt-6">
        <h2 className="font-extrabold">Rerank fallback</h2>
        {fallback.status === "loading" && (
          <p className="mt-2 text-sm" role="status">
            Loading…
          </p>
        )}
        {fallback.status === "pending" && (
          <p className="mt-2 text-sm text-muted">
            Fallback proof pending — the no-key run hasn&apos;t published.
          </p>
        )}
        {fallback.status === "error" && (
          <ErrorBanner message={fallback.message} />
        )}
        {fallback.status === "ready" && (
          <p className="mt-2 text-sm">
            Key removed over {fallback.data.households} households: stage-2
            order kept{" "}
            {fallback.data.orderKept ? (
              <Badge tone="mint" solid>yes</Badge>
            ) : (
              <Badge tone="blush" solid>NO</Badge>
            )}
            , every reason templated{" "}
            {fallback.data.allTemplated ? (
              <Badge tone="mint" solid>yes</Badge>
            ) : (
              <Badge tone="blush" solid>NO</Badge>
            )}
            .
          </p>
        )}
      </section>
      </details>
    </main>
  );
}
