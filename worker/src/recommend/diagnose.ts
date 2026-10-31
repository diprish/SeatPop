import { relaxationsFor, type Preferences } from "@seatpop/shared";
import { recommendStages, type RecommendDeps } from "./run";

export interface DiagnoseRelaxed {
  id: string;
  label: string;
  candidates: number;
}

export interface DiagnoseResult {
  base: number;
  relaxed: DiagnoseRelaxed[];
}

type StagesFn = (
  input: { prefs: unknown },
  deps: RecommendDeps,
) => Promise<{ candidates: unknown[] }>;

/**
 * Empty-state diagnosis: candidate counts with each constraint group
 * dropped. Stage-1 counts only (SQL RPCs, no LLM), so this stays cheap.
 * runStages is injectable for tests; production passes recommendStages.
 */
export async function diagnoseEmpty(
  prefs: Preferences,
  deps: RecommendDeps,
  runStages: StagesFn = recommendStages,
): Promise<DiagnoseResult> {
  const base = (await runStages({ prefs }, deps)).candidates.length;
  const relaxed: DiagnoseRelaxed[] = [];
  for (const relaxation of relaxationsFor(prefs)) {
    const count = (await runStages({ prefs: relaxation.prefs }, deps)).candidates
      .length;
    relaxed.push({
      id: relaxation.id,
      label: relaxation.label,
      candidates: count,
    });
  }
  return { base, relaxed };
}
