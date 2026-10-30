import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  chat,
  loadDotenv,
  resolveConfig,
  type LlmConfig,
} from "@seatpop/llm";
import { PreferencesSchema, type Preferences } from "@seatpop/shared";
import { isDirectExecution } from "../script-entry";
import { localEmbed } from "../enrich/embed";
import { ndcgAt10, type JudgmentMap } from "../eval/ranking";
import {
  checkConstraints,
  haversineKm,
  type ConstraintEvent,
} from "./constraints";
import { FINAL_TOP_N } from "./config";
import {
  recommendStages,
  runRecommend,
  type CandidateRow,
  type RecommendDeps,
} from "./run";

/**
 * `npm run eval:recommend`: the phase 4-5 proof gate (live data).
 *
 * 20 synthetic households × (SQL candidates → stage-2 → rerank):
 * - constraint violations in the top 10 must be 0 for EVERY household
 *   (TS mirror re-checks each SQL-returned row, including an independent
 *   haversine recomputation against the home-area centroid);
 * - NDCG@10 of the reranked list vs two baselines (date order, stage-2
 *   without rerank) with relevance grades from Muse Wonder, labelled
 *   "model-graded" everywhere they appear;
 * - with MODEL_API_KEY removed the script proves the fallback instead:
 *   stage-2 order kept, every reason templated, grades unavailable.
 * - a free_only + kids probe must surface at least one "free (per OPL)"
 *   row, proving scoped source policies apply end to end.
 *
 * Exits 1 on any violation, distance-math mismatch, or probe failure.
 * Needs migration 0010 applied plus SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

const HouseholdFixtureSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  prefs: PreferencesSchema,
});
type HouseholdFixture = z.infer<typeof HouseholdFixtureSchema>;

const GradeSchema = z.object({
  event_id: z.string().min(1),
  relevance: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

function evalDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "recommend");
}

/** Parse Wonder grades; every candidate id must be covered (no invented 0s). */
export function parseWonderGrades(
  content: string,
  candidateIds: Set<string>,
): Map<string, 0 | 1 | 2 | 3> {
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("no JSON array in reply");
  const parsed = z.array(GradeSchema).safeParse(JSON.parse(content.slice(start, end + 1)));
  if (!parsed.success) throw new Error("grade rows failed validation");
  const grades = new Map<string, 0 | 1 | 2 | 3>();
  for (const row of parsed.data) {
    if (candidateIds.has(row.event_id) && !grades.has(row.event_id)) {
      grades.set(row.event_id, row.relevance);
    }
  }
  const missing = [...candidateIds].filter((id) => !grades.has(id));
  if (missing.length > 0) {
    throw new Error(`${missing.length} candidate(s) left ungraded`);
  }
  return grades;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

interface SupabaseDeps {
  url: string;
  serviceKey: string;
}

async function rest<T>(
  deps: SupabaseDeps,
  tablePath: string,
  query: string,
): Promise<T> {
  const response = await fetch(
    `${deps.url.replace(/\/$/, "")}/rest/v1/${tablePath}${query}`,
    {
      method: "GET",
      headers: {
        apikey: deps.serviceKey,
        Authorization: `Bearer ${deps.serviceKey}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`supabase ${tablePath} failed: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function toConstraintEvent(row: CandidateRow): ConstraintEvent {
  return {
    event_id: row.event_id,
    starts_at: row.starts_at,
    timezone: row.timezone,
    venue_lat: row.venue_lat,
    venue_lng: row.venue_lng,
    distance_km: row.distance_km,
    category: row.category,
    status: row.status,
    age_min: row.age_min,
    age_max: row.age_max,
    price_kind: row.price_kind,
    amount_min_cents: row.amount_min_cents,
    accessibility: row.accessibility,
    language: row.language,
  };
}

function prefsLine(prefs: Preferences): string {
  const bits = [
    `members=${prefs.members.map((m) => m.age_band).join("+") || "any"}`,
    prefs.free_only ? "free-only" : `budget≤${prefs.max_price_cents ?? "any"}`,
    prefs.max_distance_km !== undefined
      ? `≤${prefs.max_distance_km}km@${prefs.fsa ?? "?"}`
      : "any-distance",
    `likes=[${prefs.interests.join("|") || "any"}]`,
    `avoids=[${prefs.avoid.join("|") || "none"}]`,
  ];
  return bits.join(" ");
}

function judgePrompt(prefs: Preferences, rows: CandidateRow[]): string {
  const lines = rows.map((row, i) => {
    const bits = [
      `${i + 1}. id=${row.event_id}`,
      `title=${JSON.stringify(row.title)}`,
      `starts=${row.starts_at.slice(0, 16)}`,
      `venue=${row.venue_name ?? "unknown"}`,
      `category=${row.category ?? "unknown"}`,
      `price=${row.price_label}`,
      `ages=${row.age_min ?? "?"}-${row.age_max ?? "?"}`,
      `tags=${row.tags.join("|") || "none"}`,
    ];
    if (row.summary_short) bits.push(`summary=${JSON.stringify(row.summary_short)}`);
    return bits.join(" ");
  });
  return (
    `Grade each candidate's relevance to this household request as 0 (not relevant), 1 (okay), 2 (good), or 3 (perfect). ` +
    `Reply with raw JSON only: an array of {event_id, relevance} covering EVERY listed id.\n` +
    `Household: ${prefsLine(prefs)}\nCandidates:\n${lines.join("\n")}`
  );
}

interface HouseholdReport {
  id: string;
  description: string;
  candidates: number;
  violations: Array<{ event_id: string; violations: string[] }>;
  distanceMismatches: number;
  ndcgReranked: number | null;
  ndcgDate: number | null;
  ndcgStage2: number | null;
  graded: boolean;
  fallback: boolean;
}

async function gradeHousehold(
  prefs: Preferences,
  rows: CandidateRow[],
  config: LlmConfig,
): Promise<Map<string, 0 | 1 | 2 | 3> | null> {
  const ids = new Set(rows.map((r) => r.event_id));
  const prompt = judgePrompt(prefs, rows);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await chat(
      {
        task: "judge",
        provider: "meta",
        messages: [
          {
            role: "system",
            content:
              "You grade activity recommendations for households. Reply with raw JSON only.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        // Up to 30 union events × a grade row, plus Wonder's preamble:
        // 2048 still truncates to a retry, so start at 4096.
        maxTokens: 4096,
      },
      { config },
    );
    if (!result.ok) continue;
    try {
      return parseWonderGrades(result.value.content, ids);
    } catch {
      continue;
    }
  }
  return null;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "seatpop eval:recommend: 20 synthetic households, violations + NDCG.\n" +
        "usage: npm run eval:recommend --workspace @seatpop/worker [-- --limit N]\n" +
        "  --limit N    grade at most N households (cheapest smoke pass).",
    );
    return 0;
  }
  loadDotenv();
  const limitRaw = args[args.indexOf("--limit") + 1];
  const limit =
    limitRaw === undefined || args.indexOf("--limit") < 0
      ? undefined
      : Number(limitRaw);
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    console.error("--limit needs a positive integer");
    return 2;
  }
  const supabaseUrl = process.env["SUPABASE_URL"]?.trim();
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.error("eval:recommend needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    return 2;
  }
  const fixturePath = path.join(evalDir(), "golden-households.json");
  if (!existsSync(fixturePath)) {
    console.error(`no fixture at ${fixturePath}; nothing to evaluate`);
    return 2;
  }
  const fixtures = z.array(HouseholdFixtureSchema).safeParse(
    JSON.parse(readFileSync(fixturePath, "utf8")) as unknown,
  );
  if (!fixtures.success) {
    console.error(`fixture failed validation: ${fixtures.error.message}`);
    return 2;
  }
  const households: HouseholdFixture[] =
    limit === undefined ? fixtures.data : fixtures.data.slice(0, limit);
  if (households.length === 0) {
    console.error("eval:recommend: fixture holds no households");
    return 2;
  }

  const noKey = !process.env["MODEL_API_KEY"]?.trim();
  const mode = noKey ? "fallback-proof (MODEL_API_KEY removed)" : "full (model-graded)";
  console.log(`eval:recommend: ${households.length} households, ${mode}`);
  // Fallback-proof mode isolates to a cold cache: cached replies are
  // legitimately served without a key, so a warm cache would replay
  // model output instead of exercising the failure path.
  const config = noKey
    ? resolveConfig(process.env, {
        cacheDir: mkdtempSync(path.join(tmpdir(), "seatpop-nokey-cache-")),
        budgets: { perRun: 5 },
      })
    : resolveConfig(process.env, { budgets: { perRun: 5 } });
  const deps: SupabaseDeps = { url: supabaseUrl, serviceKey };
  const homeCache = new Map<string, { lat: number; lng: number } | null>();

  async function homeOf(fsa: string): Promise<{ lat: number; lng: number } | null> {
    if (homeCache.has(fsa)) return homeCache.get(fsa) as { lat: number; lng: number } | null;
    const rows = await rest<Array<{ lat: number; lng: number }>>(
      deps,
      "home_area",
      `?fsa=eq.${encodeURIComponent(fsa)}&select=lat,lng`,
    );
    const home = rows[0] ?? null;
    homeCache.set(fsa, home);
    return home;
  }

  const reports: HouseholdReport[] = [];
  for (const household of households) {
    const prefs = household.prefs;
    // Embedding similarities: query = stated interests; events = stored
    // enrichment vectors (service key reads; no vectors leave the box).
    let embeddingSimilarity: Map<string, number> | undefined;
    if (prefs.interests.length > 0 && !noKey) {
      const query = (await localEmbed([prefs.interests.join(", ")]))[0] as number[];
      const staged = await recommendStages(
        { prefs },
        {
          supabaseUrl,
          anonKey: serviceKey,
          llmConfig: config,
        } satisfies RecommendDeps,
      );
      const ids = staged.candidates.map((c) => c.event_id);
      if (ids.length > 0) {
        const vectors = await rest<Array<{ event_id: string; embedding: number[] | string }>>(
          deps,
          "event_enrichment",
          `?event_id=in.(${ids.join(",")})&select=event_id,embedding`,
        );
        embeddingSimilarity = new Map();
        for (const row of vectors) {
          const vec =
            typeof row.embedding === "string"
              ? (JSON.parse(row.embedding) as number[])
              : row.embedding;
          if (Array.isArray(vec) && vec.length === query.length) {
            embeddingSimilarity.set(row.event_id, (cosine(query, vec) + 1) / 2);
          }
        }
      }
    }
    const recommendDeps: RecommendDeps = {
      supabaseUrl,
      anonKey: serviceKey,
      llmConfig: config,
      embeddingSimilarity,
    };
    const stages = await recommendStages({ prefs }, recommendDeps);
    const result = await runRecommend({ prefs }, recommendDeps);

    const now = new Date();
    const final = result.items.slice(0, FINAL_TOP_N);
    const violations: HouseholdReport["violations"] = [];
    for (const item of final) {
      const check = checkConstraints(toConstraintEvent(item), prefs, now);
      if (!check.ok) {
        violations.push({
          event_id: item.event_id,
          violations: check.violations,
        });
      }
    }
    // Independent distance-math check against the home centroid.
    let distanceMismatches = 0;
    if (prefs.fsa && prefs.max_distance_km !== undefined) {
      const home = await homeOf(prefs.fsa);
      if (home) {
        for (const item of final) {
          if (item.venue_lat === null || item.venue_lng === null) continue;
          const recomputed = haversineKm(
            home.lat,
            home.lng,
            item.venue_lat,
            item.venue_lng,
          );
          if (
            item.distance_km === null ||
            Math.abs(item.distance_km - recomputed) > 0.05
          ) {
            distanceMismatches++;
          }
        }
      }
    }

    // Baselines + Wonder grades (model-graded; skipped without a key).
    const dateTop = stages.candidates.slice(0, FINAL_TOP_N);
    const stage2Top = stages.stage2.slice(0, FINAL_TOP_N);
    let ndcgReranked: number | null = null;
    let ndcgDate: number | null = null;
    let ndcgStage2: number | null = null;
    let graded = false;
    if (!noKey && final.length > 0) {
      const union = new Map<string, CandidateRow>();
      for (const row of [...final, ...dateTop, ...stage2Top]) {
        if (!union.has(row.event_id)) union.set(row.event_id, row);
      }
      const grades = await gradeHousehold(prefs, [...union.values()], config);
      if (grades) {
        graded = true;
        const judgments: JudgmentMap = new Map(
          [...grades.entries()].map(([event_id, relevance]) => [
            event_id,
            { event_id, relevance, violates_constraint: false },
          ]),
        );
        ndcgReranked = ndcgAt10(
          final.map((r) => r.event_id),
          judgments,
        );
        ndcgDate = ndcgAt10(
          dateTop.map((r) => r.event_id),
          judgments,
        );
        ndcgStage2 = ndcgAt10(
          stage2Top.map((r) => r.event_id),
          judgments,
        );
      }
    }
    const fallback = result.meta.reranked === false && stages.stage2.length > 0;
    reports.push({
      id: household.id,
      description: household.description,
      candidates: stages.candidates.length,
      violations,
      distanceMismatches,
      ndcgReranked,
      ndcgDate,
      ndcgStage2,
      graded,
      fallback,
    });
    const ndcg =
      graded && ndcgReranked !== null
        ? ` ndcg reranked=${ndcgReranked.toFixed(3)} date=${(ndcgDate as number).toFixed(3)} stage2=${(ndcgStage2 as number).toFixed(3)} (model-graded)`
        : " ndcg=unavailable";
    console.log(
      `  ${household.id}: candidates=${stages.candidates.length} ` +
        `violations=${violations.length} distance_mismatches=${distanceMismatches}${ndcg}` +
        (fallback ? " FALLBACK" : ""),
    );

    // Fallback proof (no-key mode): stage-2 order kept, all templated.
    if (noKey && final.length > 0) {
      const stage2Ids = stages.stage2.slice(0, FINAL_TOP_N).map((r) => r.event_id);
      const finalIds = final.map((r) => r.event_id);
      const orderKept =
        stage2Ids.length === finalIds.length &&
        stage2Ids.every((id, i) => id === finalIds[i]);
      const allTemplated = result.items.every((item) => !item.reasonFromModel);
      console.log(
        `    fallback proof: order_kept=${orderKept} all_templated=${allTemplated}`,
      );
      if (!orderKept || !allTemplated) {
        console.error(`    FALLBACK BROKEN for ${household.id}`);
        return 1;
      }
    }
  }

  // Policy probe (no models involved — runs in both modes): a bare
  // free_only + kids search must surface OPL kids-slice events with the
  // policy label. Zero means scoped policies silently stopped applying.
  const probePrefs = PreferencesSchema.parse({
    members: [{ age_band: "kids", include_adjacent: true }],
    free_only: true,
  });
  const probe = await recommendStages(
    { prefs: probePrefs },
    // Full-width net (SQL clamps to 500): the policy rows must count
    // wherever they fall in soonest-first order, not just the top 200.
    { supabaseUrl, anonKey: serviceKey, llmConfig: config, stage1Limit: 500 },
  );
  const policyRows = probe.candidates.filter(
    (row) => row.price_label === "free (per OPL)",
  );
  console.log(
    `  policy probe: candidates=${probe.candidates.length} ` +
      `free_per_opl=${policyRows.length}`,
  );
  const policyProbeOk = policyRows.length > 0;

  const totalViolations = reports.reduce((n, r) => n + r.violations.length, 0);
  const totalMismatches = reports.reduce((n, r) => n + r.distanceMismatches, 0);
  const gradedReports = reports.filter((r) => r.graded);
  const mean = (pick: (r: HouseholdReport) => number | null): number | null => {
    const values = gradedReports
      .map(pick)
      .filter((v): v is number => v !== null);
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  };
  console.log(
    `eval:recommend: households=${reports.length} ` +
      `violations=${totalViolations} distance_mismatches=${totalMismatches}`,
  );
  const meanReranked = mean((r) => r.ndcgReranked);
  if (meanReranked !== null) {
    console.log(
      `  mean NDCG@10 (model-graded, ${gradedReports.length}/${reports.length} households): ` +
        `reranked=${meanReranked.toFixed(3)} date=${(mean((r) => r.ndcgDate) as number).toFixed(3)} ` +
        `stage2=${(mean((r) => r.ndcgStage2) as number).toFixed(3)}`,
    );
  } else {
    console.log("  NDCG unavailable (no grades: key removed or judge failed)");
  }

  const outPath = path.join(evalDir(), "eval-report.json");
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode,
        grading: noKey ? "none (key removed)" : "model-graded (muse-wonder)",
        households: reports,
        policyProbe: {
          candidates: probe.candidates.length,
          freePerOpl: policyRows.length,
          ok: policyProbeOk,
        },
        totals: {
          violations: totalViolations,
          distanceMismatches: totalMismatches,
          meanNdcgReranked: meanReranked,
          meanNdcgDate: mean((r) => r.ndcgDate),
          meanNdcgStage2: mean((r) => r.ndcgStage2),
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`  wrote ${outPath}`);
  if (totalViolations > 0 || totalMismatches > 0 || !policyProbeOk) {
    console.error(
      "eval:recommend: FAIL — violations, distance mismatches, or policy probe failure",
    );
    return 1;
  }
  console.log(
    "eval:recommend: PASS — zero violations, distances verified, policy probe ok",
  );
  return 0;
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await main().catch((error: unknown) => {
    console.error(
      `eval:recommend failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  });
  process.exit(exitCode);
}
