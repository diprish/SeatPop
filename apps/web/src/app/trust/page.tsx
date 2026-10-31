"use client";

import { useEffect, useState } from "react";
import ErrorBanner from "@/components/error-banner";
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

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-bold">Trust</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
        Measured quality, straight from the eval reports. Anything missing is
        labelled pending.
      </p>

      <section aria-label="Enrichment eval" className="mt-6">
        <h2 className="font-semibold">Listing enrichment</h2>
        {enrichment.status === "loading" && (
          <p className="mt-2 text-sm" role="status">
            Loading…
          </p>
        )}
        {enrichment.status === "pending" && (
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            Enrichment eval pending — human labelling isn&apos;t finished.
          </p>
        )}
        {enrichment.status === "error" && (
          <ErrorBanner message={enrichment.message} />
        )}
        {enrichment.status === "ready" &&
          enrichment.data.models.map((model) => {
            const gatePass = model.falseFree === 0 && model.wrongPrice === 0;
            return (
              <div
                key={model.key}
                className="mt-3 rounded border border-neutral-200 p-3 dark:border-neutral-800"
              >
                <h3 className="text-sm font-semibold">
                  {model.model}{" "}
                  <span className="font-normal text-neutral-500">
                    ({model.provider}, {model.eventsScored} scored
                    {model.eventsFailed > 0 ? `, ${model.eventsFailed} failed` : ""})
                  </span>
                </h3>
                <p className="mt-1 text-sm">
                  Gate:{" "}
                  <span className="font-semibold">
                    {gatePass ? "PASS" : "FAIL"}
                  </span>{" "}
                  (false-free {model.falseFree}, wrong-price {model.wrongPrice},
                  hallucinated {model.hallucinatedFields})
                </p>
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="text-left text-neutral-500">
                      <th className="font-normal">Field</th>
                      <th className="font-normal">Accuracy</th>
                      <th className="font-normal">Null rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.fields.map((field) => (
                      <tr key={field.field}>
                        <td>{field.field}</td>
                        <td>{pct(field.accuracy)}</td>
                        <td>{pct(field.nullRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
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
        <h2 className="font-semibold">Recommendations</h2>
        {recommend.status === "loading" && (
          <p className="mt-2 text-sm" role="status">
            Loading…
          </p>
        )}
        {recommend.status === "pending" && (
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            Recommend eval pending.
          </p>
        )}
        {recommend.status === "error" && (
          <ErrorBanner message={recommend.message} />
        )}
        {recommend.status === "ready" && (
          <div className="mt-3 rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            <p>
              {recommend.data.households} synthetic households,{" "}
              {recommend.data.withCandidates} with candidates,{" "}
              {recommend.data.graded} graded ({recommend.data.grading}).
            </p>
            <p className="mt-1">
              Constraint violations in top 10:{" "}
              <span className="font-semibold">{recommend.data.violations}</span>{" "}
              (must be 0) · distance mismatches: {recommend.data.distanceMismatches}
            </p>
            <table className="mt-2 w-full">
              <thead>
                <tr className="text-left text-neutral-500">
                  <th className="font-normal">Method</th>
                  <th className="font-normal">NDCG@10</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Reranked</td>
                  <td>{pct(recommend.data.meanNdcgReranked)}</td>
                </tr>
                <tr>
                  <td>Date order (baseline)</td>
                  <td>{pct(recommend.data.meanNdcgDate)}</td>
                </tr>
                <tr>
                  <td>Stage 2 only (baseline)</td>
                  <td>{pct(recommend.data.meanNdcgStage2)}</td>
                </tr>
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
        <h2 className="font-semibold">Rerank fallback</h2>
        {fallback.status === "loading" && (
          <p className="mt-2 text-sm" role="status">
            Loading…
          </p>
        )}
        {fallback.status === "pending" && (
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            Fallback proof pending — the no-key run hasn&apos;t published.
          </p>
        )}
        {fallback.status === "error" && (
          <ErrorBanner message={fallback.message} />
        )}
        {fallback.status === "ready" && (
          <p className="mt-2 text-sm">
            Key removed over {fallback.data.households} households: stage-2
            order kept {fallback.data.orderKept ? "yes" : "NO"}, every reason
            templated {fallback.data.allTemplated ? "yes" : "NO"}.
          </p>
        )}
      </section>
    </main>
  );
}
