"use client";

import { useState } from "react";
import type { Preferences } from "@seatpop/shared";
// Client-safe entrypoint (pure chips logic; never pulls the LLM client
// or any node-only module into the browser bundle).
import {
  chipsFor,
  removeChip,
  type Chip,
} from "@seatpop/worker/recommend/chips";

interface RecommendItemView {
  event_id: string;
  title: string;
  starts_at: string;
  venue_name: string | null;
  distance_km: number | null;
  price_label: string;
  age_flag: string | null;
  source_url: string;
  reason: string;
  reasonFromModel: boolean;
}

interface RecommendMeta {
  reranked: boolean;
  warnings: string[];
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? `request failed (${response.status})`);
  }
  return json;
}

export default function RecommendPage() {
  const [text, setText] = useState("");
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [items, setItems] = useState<RecommendItemView[]>([]);
  const [meta, setMeta] = useState<RecommendMeta | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"parse" | "recommend" | "save" | null>(null);

  const chips: Chip[] = prefs ? chipsFor(prefs) : [];

  async function parse(): Promise<void> {
    setBusy("parse");
    setNotice("");
    setItems([]);
    setMeta(null);
    try {
      const data = await postJson<{
        prefs: Preferences;
        chips: Chip[];
        fallbackPrefs?: Preferences;
      }>("/api/profile/parse", { text });
      setPrefs(data.prefs);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "parse failed");
    } finally {
      setBusy(null);
    }
  }

  function dropChip(key: string): void {
    if (!prefs) return;
    setPrefs(removeChip(prefs, key));
    setItems([]);
    setMeta(null);
  }

  async function recommend(): Promise<void> {
    if (!prefs) return;
    setBusy("recommend");
    setNotice("");
    try {
      const data = await postJson<{
        items: RecommendItemView[];
        meta: RecommendMeta;
      }>("/api/recommend", { prefs });
      setItems(data.items);
      setMeta(data.meta);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "recommend failed");
    } finally {
      setBusy(null);
    }
  }

  async function save(): Promise<void> {
    if (!prefs) return;
    const jwt =
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem("seatpop_jwt");
    if (!jwt) {
      setNotice(
        "Saving needs sign-in, which is not in the UI yet. Your picks above are ready; the save API works today with a user JWT (see README).",
      );
      return;
    }
    setBusy("save");
    setNotice("");
    try {
      const { members, fsa, ...rest } = prefs;
      const response = await fetch("/api/households", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          home_fsa: fsa ?? null,
          members,
          preferences: rest,
        }),
      });
      const json = (await response.json()) as {
        household_id?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(json.error ?? "save failed");
      setNotice(`Household saved (${json.household_id}).`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "save failed");
    } finally {
      setBusy(null);
    }
  }

  const canRecommend = prefs !== null && prefs.members.length > 0 && busy === null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <a className="text-sm underline" href="/">
        ← SeatPop
      </a>
      <h1 className="mt-2 text-2xl font-bold">Find activities</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Describe your household in your own words — ages, budget, area,
        availability, interests. Don&apos;t include names.
      </p>
      <textarea
        className="mt-4 w-full rounded border p-3 text-sm"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Two kids (7 and 10) who love music, Saturday mornings, under $25, near K1S"
      />
      <div className="mt-2 flex gap-2">
        <button
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
          onClick={() => void parse()}
          disabled={busy !== null || text.trim() === ""}
        >
          {busy === "parse" ? "Parsing…" : "Parse"}
        </button>
      </div>

      {chips.length > 0 && (
        <div className="mt-4">
          <h2 className="text-sm font-semibold">Your preferences (edit before searching)</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {chips.map((chip, index) => (
              <span
                key={`${chip.key}:${index}`}
                className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-3 py-1 text-sm"
              >
                {chip.label}
                <button
                  aria-label={`Remove ${chip.label}`}
                  className="text-neutral-500"
                  onClick={() => dropChip(chip.key)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
              onClick={() => void recommend()}
              disabled={!canRecommend}
            >
              {busy === "recommend" ? "Searching…" : "Find activities"}
            </button>
            <button
              className="rounded border px-4 py-2 text-sm disabled:opacity-40"
              onClick={() => void save()}
              disabled={!canRecommend}
            >
              {busy === "save" ? "Saving…" : "Save household"}
            </button>
          </div>
          {prefs && prefs.members.length === 0 && (
            <p className="mt-2 text-sm text-amber-700">
              Add at least one member to search.
            </p>
          )}
        </div>
      )}

      {notice !== "" && <p className="mt-4 text-sm text-amber-700">{notice}</p>}

      {meta && meta.warnings.length > 0 && (
        <ul className="mt-4 list-disc pl-5 text-sm text-neutral-600">
          {meta.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <div className="mt-4">
          <h2 className="text-sm font-semibold">
            Top picks {meta && !meta.reranked && "(match order)"}
          </h2>
          <ul className="mt-2 space-y-3">
            {items.map((item) => (
              <li key={item.event_id} className="rounded border p-3">
                <a
                  className="font-semibold underline"
                  href={item.source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.title}
                </a>
                <p className="mt-1 text-sm text-neutral-600">
                  {item.starts_at.slice(0, 16).replace("T", " ")}
                  {item.venue_name ? ` · ${item.venue_name}` : ""}
                  {item.distance_km !== null
                    ? ` · ${item.distance_km.toFixed(1)} km`
                    : ""}
                  {` · ${item.price_label}`}
                </p>
                {item.age_flag && (
                  <p className="mt-1 text-sm text-amber-700">{item.age_flag}</p>
                )}
                <p className="mt-1 text-sm">
                  {item.reason}{" "}
                  <span className="text-xs text-neutral-400">
                    {item.reasonFromModel ? "(AI reason)" : "(match)"}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
